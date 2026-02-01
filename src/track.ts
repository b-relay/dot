import { lstat, readdir, mkdir, rename, symlink } from "node:fs/promises";
import { dirname, basename, resolve, relative } from "node:path";
import { $ } from "bun";
import { updateConfigLinks } from "./config";
import type { DotConfig } from "./types";

export type TrackOptions = {
  as?: string;  // --as zsh/zshrc
  force?: boolean;
};

/**
 * Prompt user to select from options using numbered menu
 */
async function prompt(question: string): Promise<string> {
  process.stdout.write(question);
  for await (const line of console) {
    return line.trim();
  }
  return "";
}

/**
 * Select destination folder interactively
 */
async function selectDestinationFolder(dotfilesPath: string): Promise<string | null> {
  // Get top-level directories in dotfiles repo
  const entries = await readdir(dotfilesPath, { withFileTypes: true });
  const folders = entries
    .filter(e => e.isDirectory() && !e.name.startsWith("."))
    .map(e => e.name)
    .sort();

  console.log("\nSelect destination folder:");
  folders.forEach((f, i) => {
    console.log(`  ${i + 1}. ${f}/`);
  });
  console.log(`  ${folders.length + 1}. [new folder]`);
  console.log(`  ${folders.length + 2}. [root]`);

  const answer = await prompt("\nChoice (number or folder name): ");

  // Handle numeric selection
  const num = parseInt(answer, 10);
  if (!isNaN(num)) {
    if (num >= 1 && num <= folders.length) {
      return folders[num - 1]!;
    }
    if (num === folders.length + 1) {
      // New folder
      const folderName = await prompt("New folder name: ");
      if (!folderName) return null;
      return folderName;
    }
    if (num === folders.length + 2) {
      // Root
      return "";
    }
    console.error("Invalid selection");
    return null;
  }

  // Handle folder name typed directly
  if (folders.includes(answer)) {
    return answer;
  }

  // Treat as new folder name
  if (answer) {
    return answer;
  }

  console.error("Invalid selection");
  return null;
}

/**
 * Track a file or directory by moving it to dotfiles repo and creating symlink
 */
export async function track(
  targetPath: string,
  dotfilesPath: string,
  config: DotConfig,
  options: TrackOptions
): Promise<void> {
  // 1. Validate target
  const absoluteTarget = resolve(targetPath);

  // Check if target exists
  let targetStat;
  try {
    targetStat = await lstat(absoluteTarget);
  } catch {
    console.error(`Error: ${absoluteTarget} does not exist`);
    process.exit(1);
  }

  // If it's already a symlink, nothing to track
  if (targetStat.isSymbolicLink()) {
    console.error("Already a symlink. Nothing to track.");
    process.exit(1);
  }

  // 2. Determine destination
  let relativeDest: string;

  if (options.as) {
    // Use provided path
    relativeDest = options.as;
  } else {
    // Interactive selection
    const folder = await selectDestinationFolder(dotfilesPath);
    if (folder === null) {
      console.log("Cancelled.");
      return;
    }

    // Ask for filename
    const defaultName = basename(absoluteTarget);
    const filenameAnswer = await prompt(`Filename (default: ${defaultName}): `);
    const filename = filenameAnswer || defaultName;

    relativeDest = folder ? `${folder}/${filename}` : filename;
  }

  const absoluteDest = resolve(dotfilesPath, relativeDest);

  // 3. Check for conflicts
  try {
    await lstat(absoluteDest);
    // File exists
    if (options.force) {
      // Backup existing file
      console.log(`Backing up existing file to ${absoluteDest}.bak`);
      await rename(absoluteDest, `${absoluteDest}.bak`);
    } else {
      console.log(`\nConflict: ${relativeDest} already exists in dotfiles repo.`);
      console.log("  1. Replace (move existing to .bak)");
      console.log("  2. Cancel");
      const choice = await prompt("\nChoice: ");

      if (choice === "1") {
        await rename(absoluteDest, `${absoluteDest}.bak`);
      } else {
        console.log("Cancelled.");
        return;
      }
    }
  } catch {
    // File doesn't exist, good to go
  }

  // 4. Preview and confirm
  console.log(`\nWill move:   ${absoluteTarget}`);
  console.log(`         ->  ${absoluteDest}`);
  console.log(`Will create symlink: ${absoluteTarget} -> ${absoluteDest}`);

  const shouldCommit = config.autoCommit !== false;
  if (shouldCommit) {
    console.log(`Will commit: "Add ${basename(absoluteTarget)}"`);
  }

  if (!options.force) {
    const confirm = await prompt("\nProceed? (y/N): ");
    if (confirm.toLowerCase() !== "y" && confirm.toLowerCase() !== "yes") {
      console.log("Cancelled.");
      return;
    }
  }

  // 5. Execute
  // Create destination directory if needed
  await mkdir(dirname(absoluteDest), { recursive: true });

  // Move file
  await rename(absoluteTarget, absoluteDest);
  console.log(`Moved: ${absoluteTarget} -> ${absoluteDest}`);

  // Create symlink
  await symlink(absoluteDest, absoluteTarget);
  console.log(`Symlink created: ${absoluteTarget} -> ${absoluteDest}`);

  // Update config with new link
  // Convert to tilde path for target (more portable)
  const home = process.env.HOME || "";
  const targetForConfig = absoluteTarget.startsWith(home)
    ? "~" + absoluteTarget.slice(home.length)
    : absoluteTarget;

  await updateConfigLinks(dotfilesPath, {
    source: relativeDest,
    target: targetForConfig,
  });
  console.log(`Config updated: ${relativeDest} -> ${targetForConfig}`);

  // Auto-commit if enabled
  if (shouldCommit) {
    const commitMsg = `Add ${basename(absoluteTarget)}`;
    await $`git -C ${dotfilesPath} add ${relativeDest} dot.config.json`.quiet();
    await $`git -C ${dotfilesPath} commit -m ${commitMsg}`.quiet();
    console.log(`Committed: "${commitMsg}"`);
  }

  // 6. Success message
  console.log(`\nDone! ${basename(absoluteTarget)} is now tracked in your dotfiles.`);
}

/**
 * Parse track command arguments
 */
export function parseTrackArgs(args: string[]): { targetPath?: string; options: TrackOptions } {
  let targetPath: string | undefined;
  const options: TrackOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--as" && i + 1 < args.length) {
      options.as = args[++i];
    } else if (arg === "--force" || arg === "-f") {
      options.force = true;
    } else if (!arg.startsWith("-")) {
      targetPath = arg;
    }
  }

  return { targetPath, options };
}
