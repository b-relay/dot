import { lstat, readdir, mkdir, rename, symlink } from "node:fs/promises";
import { dirname, basename, resolve } from "node:path";
import { $ } from "bun";
import { updateConfigLinks } from "./config";
import { browseForPath, UserCancelledError } from "./wizard";
import type { DotConfig } from "./types";
import * as p from "@clack/prompts";

export type LinkOptions = {
  as?: string;  // --as zsh/zshrc
  force?: boolean;
  cwd?: boolean;  // --cwd start browser from cwd
};

/**
 * Select destination folder in dotfiles repo using @clack/prompts
 */
async function selectDestinationFolder(dotfilesPath: string): Promise<string | null> {
  const entries = await readdir(dotfilesPath, { withFileTypes: true });
  const folders = entries
    .filter(e => e.isDirectory() && !e.name.startsWith("."))
    .map(e => e.name)
    .sort();

  const options = [
    ...folders.map(f => ({ value: f, label: f + "/", hint: "existing folder" })),
    { value: "__new__", label: "Create new folder" },
    { value: "__root__", label: "Root of dotfiles", hint: "no subfolder" },
  ];

  const result = await p.select({
    message: "Select destination folder in dotfiles repo",
    options,
  });

  if (p.isCancel(result)) {
    throw new UserCancelledError();
  }

  if (result === "__new__") {
    const folderName = await p.text({
      message: "New folder name:",
      placeholder: "my-config",
      validate: (value) => {
        if (!value?.trim()) return "Folder name is required";
        if (value.includes("/")) return "Cannot contain /";
        return undefined;
      },
    });

    if (p.isCancel(folderName)) {
      throw new UserCancelledError();
    }

    return folderName as string;
  }

  if (result === "__root__") {
    return "";
  }

  return result as string;
}

/**
 * Link a file or directory by moving it to dotfiles repo and creating symlink
 */
export async function link(
  targetPath: string | undefined,
  dotfilesPath: string,
  config: DotConfig,
  options: LinkOptions
): Promise<void> {
  p.intro("dot link");

  // 1. Get target path (browse if not provided)
  let absoluteTarget: string;

  if (targetPath) {
    absoluteTarget = resolve(targetPath);
  } else {
    const startDir = options.cwd ? process.cwd() : (process.env.HOME || "/");
    p.log.info("Select a file or directory to link");

    try {
      absoluteTarget = await browseForPath(startDir);
    } catch (error) {
      if (error instanceof UserCancelledError) {
        p.log.warn("Cancelled");
        return;
      }
      throw error;
    }
  }

  // 2. Validate target
  let targetStat;
  try {
    targetStat = await lstat(absoluteTarget);
  } catch {
    p.log.error(`${absoluteTarget} does not exist`);
    process.exit(1);
  }

  if (targetStat.isSymbolicLink()) {
    p.log.error("Already a symlink. Nothing to link.");
    process.exit(1);
  }

  // 3. Determine destination in dotfiles repo
  let relativeDest: string;
  const defaultName = basename(absoluteTarget);

  if (options.as) {
    relativeDest = options.as;
  } else {
    try {
      // Select folder
      const folder = await selectDestinationFolder(dotfilesPath);
      if (folder === null) {
        p.log.warn("Cancelled");
        return;
      }

      // Always offer to change the filename
      const filename = await p.text({
        message: "Filename in dotfiles repo:",
        defaultValue: defaultName,
        placeholder: defaultName,
      });

      if (p.isCancel(filename)) {
        throw new UserCancelledError();
      }

      relativeDest = folder ? `${folder}/${filename}` : (filename as string);
    } catch (error) {
      if (error instanceof UserCancelledError) {
        p.log.warn("Cancelled");
        return;
      }
      throw error;
    }
  }

  const absoluteDest = resolve(dotfilesPath, relativeDest);

  // 4. Check for conflicts
  try {
    await lstat(absoluteDest);
    // File exists
    if (options.force) {
      p.log.warn(`Backing up existing file to ${absoluteDest}.bak`);
      await rename(absoluteDest, `${absoluteDest}.bak`);
    } else {
      const action = await p.select({
        message: `${relativeDest} already exists in dotfiles repo`,
        options: [
          { value: "replace", label: "Replace", hint: "move existing to .bak" },
          { value: "cancel", label: "Cancel" },
        ],
      });

      if (p.isCancel(action) || action === "cancel") {
        p.log.warn("Cancelled");
        return;
      }

      await rename(absoluteDest, `${absoluteDest}.bak`);
    }
  } catch {
    // File doesn't exist, good to go
  }

  // 5. Preview and confirm
  p.log.step("Preview:");
  console.log(`  Move:    ${absoluteTarget}`);
  console.log(`  To:      ${absoluteDest}`);
  console.log(`  Symlink: ${absoluteTarget} -> ${absoluteDest}`);

  const shouldCommit = config.autoCommit !== false;
  if (shouldCommit) {
    console.log(`  Commit:  "Add ${defaultName}"`);
  }

  if (!options.force) {
    const proceed = await p.confirm({
      message: "Proceed?",
    });

    if (p.isCancel(proceed) || !proceed) {
      p.log.warn("Cancelled");
      return;
    }
  }

  // 6. Execute
  const s = p.spinner();
  s.start("Linking...");

  // Create destination directory if needed
  await mkdir(dirname(absoluteDest), { recursive: true });

  // Move file
  await rename(absoluteTarget, absoluteDest);

  // Create symlink
  await symlink(absoluteDest, absoluteTarget);

  // Update config
  const home = process.env.HOME || "";
  const targetForConfig = absoluteTarget.startsWith(home)
    ? "~" + absoluteTarget.slice(home.length)
    : absoluteTarget;

  await updateConfigLinks(dotfilesPath, {
    source: relativeDest,
    target: targetForConfig,
  });

  // Auto-commit if enabled
  if (shouldCommit) {
    const commitMsg = `Add ${defaultName}`;
    await $`git -C ${dotfilesPath} add ${relativeDest} dot.config.json`.quiet();
    await $`git -C ${dotfilesPath} commit -m ${commitMsg}`.quiet();
  }

  s.stop("Linked successfully");

  p.log.success(`${defaultName} is now tracked in your dotfiles`);
}

/**
 * Parse link command arguments
 */
export function parseLinkArgs(args: string[]): { targetPath?: string; options: LinkOptions } {
  let targetPath: string | undefined;
  const options: LinkOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--as" && i + 1 < args.length) {
      options.as = args[++i];
    } else if (arg === "--force" || arg === "-f") {
      options.force = true;
    } else if (arg === "--cwd") {
      options.cwd = true;
    } else if (!arg.startsWith("-")) {
      targetPath = arg;
    }
  }

  return { targetPath, options };
}
