import {
  stat,
  readdir,
  lstat,
  readlink,
  symlink,
  unlink,
  mkdir,
  cp,
  rm,
  rename,
} from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute, basename } from "node:path";
import { saveState } from "./state";
import { updateConfigLinks, removeConfigLink } from "./config";
import { browseForPath, UserCancelledError } from "./wizard";
import type { DotConfig } from "./types";
import * as p from "@clack/prompts";

export type MoveOptions = {
  force?: boolean;
  self?: boolean;  // --self to move the dotfiles folder itself
};

/**
 * Expand ~ to home directory
 */
function expandPath(path: string): string {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME environment variable is not set");
  }
  if (path === "~") {
    return home;
  }
  if (path.startsWith("~/")) {
    return resolve(home, path.slice(2));
  }
  return resolve(path);
}

/**
 * Check if directory exists and is empty
 */
async function isDirEmpty(path: string): Promise<boolean> {
  try {
    const files = await readdir(path);
    return files.length === 0;
  } catch {
    return true;
  }
}

/**
 * Check if path exists
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if path is inside another path
 */
function isPathInside(child: string, parent: string): boolean {
  const relPath = relative(parent, child);
  return !relPath.startsWith("..") && !isAbsolute(relPath);
}

/**
 * Move a symlinked file to a different location.
 * Keeps the file in the dotfiles repo, just changes where the symlink is.
 */
export async function move(
  sourcePath: string | undefined,
  dotfilesPath: string,
  config: DotConfig,
  options: MoveOptions = {}
): Promise<void> {
  p.intro("dot move");

  const home = process.env.HOME || "";

  // 1. Select which symlink to move (from config.links)
  const links = Object.entries(config.links);
  if (links.length === 0) {
    p.log.error("No linked files found in config");
    return;
  }

  let selectedSource: string;
  let selectedTarget: string;

  if (sourcePath) {
    // Find the link that matches the source path
    const resolvedSource = resolve(sourcePath);
    const match = links.find(([src]) => resolve(dotfilesPath, src) === resolvedSource);
    if (!match) {
      // Maybe they provided the target path instead
      const targetMatch = links.find(([, tgt]) => expandPath(tgt) === resolvedSource);
      if (targetMatch) {
        [selectedSource, selectedTarget] = targetMatch;
      } else {
        p.log.error(`${sourcePath} is not a tracked file`);
        return;
      }
    } else {
      [selectedSource, selectedTarget] = match;
    }
  } else {
    // Let user select from list
    const linkOptions = links.map(([src, tgt]) => ({
      value: src,
      label: expandPath(tgt).replace(home, "~"),
      hint: `-> ${src}`,
    }));

    const selected = await p.select({
      message: "Select a linked file to move",
      options: linkOptions,
    });

    if (p.isCancel(selected)) {
      p.log.warn("Cancelled");
      return;
    }

    selectedSource = selected as string;
    selectedTarget = config.links[selectedSource]!;
  }

  const currentTarget = expandPath(selectedTarget);
  const repoFile = resolve(dotfilesPath, selectedSource);

  // Verify the symlink exists and points to our repo
  try {
    const linkStat = await lstat(currentTarget);
    if (!linkStat.isSymbolicLink()) {
      p.log.error(`${currentTarget} is not a symlink`);
      return;
    }
  } catch {
    p.log.warn(`Symlink ${currentTarget} doesn't exist, will create at new location`);
  }

  // 2. Select new location
  p.log.info(`Moving: ${currentTarget.replace(home, "~")}`);
  p.log.info("Select new location for the symlink");

  let newTarget: string;
  try {
    newTarget = await browseForPath(dirname(currentTarget));
  } catch (error) {
    if (error instanceof UserCancelledError) {
      p.log.warn("Cancelled");
      return;
    }
    throw error;
  }

  // If they selected a directory, put the file inside it
  const newTargetStat = await stat(newTarget).catch(() => null);
  if (newTargetStat?.isDirectory()) {
    newTarget = resolve(newTarget, basename(currentTarget));
  }

  if (newTarget === currentTarget) {
    p.log.info("Same location, nothing to do");
    return;
  }

  // 3. Preview and confirm
  p.log.step("Preview:");
  console.log(`  Current: ${currentTarget.replace(home, "~")}`);
  console.log(`  New:     ${newTarget.replace(home, "~")}`);
  console.log(`  Points to: ${repoFile}`);

  if (!options.force) {
    const proceed = await p.confirm({ message: "Proceed?" });
    if (p.isCancel(proceed) || !proceed) {
      p.log.warn("Cancelled");
      return;
    }
  }

  // 4. Execute
  const s = p.spinner();
  s.start("Moving symlink...");

  // Create parent directory if needed
  await mkdir(dirname(newTarget), { recursive: true });

  // If destination exists, handle safely before touching the current symlink.
  try {
    const st = await lstat(newTarget);
    if (st.isSymbolicLink()) {
      await unlink(newTarget);
    } else {
      // Real file/dir exists at destination.
      if (!options.force) {
        const choice = await p.select({
          message: `${newTarget.replace(home, "~")} exists (not a symlink)`,
          options: [
            { value: "backup", label: "Backup and replace", hint: "rename existing to .backup-<timestamp>" },
            { value: "cancel", label: "Cancel" },
          ],
        });
        if (p.isCancel(choice) || choice === "cancel") {
          s.stop("Cancelled");
          return;
        }
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const backupPath = `${newTarget}.backup-${timestamp}`;
      await rename(newTarget, backupPath);
    }
  } catch {
    // newTarget doesn't exist, good
  }

  // Create new symlink (now safe to proceed)
  await symlink(repoFile, newTarget);

  // Remove old symlink after new is in place
  try {
    await unlink(currentTarget);
  } catch {
    // Might not exist
  }

  // Update config
  const newTargetForConfig = newTarget.startsWith(home)
    ? "~" + newTarget.slice(home.length)
    : newTarget;

  // Remove old link and add new one
  await removeConfigLink(dotfilesPath, selectedSource);
  await updateConfigLinks(dotfilesPath, {
    source: selectedSource,
    target: newTargetForConfig,
  });

  s.stop("Moved successfully");

  p.log.success(`Symlink moved to ${newTarget.replace(home, "~")}`);
}

/**
 * Move the dotfiles folder itself to a new location.
 * Updates all symlinks to point to the new location.
 */
export async function moveSelf(
  newPath: string,
  currentPath: string,
  config: DotConfig,
  options: MoveOptions = {}
): Promise<void> {
  p.intro("dot move --self");

  // Resolve paths
  const resolvedNewPath = expandPath(newPath);
  const resolvedCurrentPath = resolve(currentPath);

  // Validate new path
  if (isPathInside(resolvedNewPath, resolvedCurrentPath)) {
    p.log.error("Cannot move to subdirectory of itself");
    return;
  }

  const destExists = await pathExists(resolvedNewPath);
  if (destExists) {
    const isEmpty = await isDirEmpty(resolvedNewPath);
    if (!isEmpty) {
      if (!options.force) {
        p.log.error("Destination exists and is not empty. Use --force to override.");
        return;
      }
      p.log.warn(`Destination ${resolvedNewPath} is not empty`);
    }
  }

  // Compute symlinks to update
  const symlinksToUpdate: { target: string; oldSource: string; newSource: string }[] = [];

  for (const [source, target] of Object.entries(config.links)) {
    const oldSource = resolve(resolvedCurrentPath, source);
    const newSource = resolve(resolvedNewPath, source);
    const expandedTarget = expandPath(target);
    symlinksToUpdate.push({ target: expandedTarget, oldSource, newSource });
  }

  // Preview
  p.log.step("Preview:");
  console.log(`  From: ${resolvedCurrentPath}`);
  console.log(`  To:   ${resolvedNewPath}`);
  console.log(`  Symlinks to update: ${symlinksToUpdate.length}`);

  if (!options.force) {
    const proceed = await p.confirm({ message: "Proceed?" });
    if (p.isCancel(proceed) || !proceed) {
      p.log.warn("Cancelled");
      return;
    }
  }

  // Execute
  const s = p.spinner();
  s.start("Moving dotfiles folder...");

  // Create parent directory
  await mkdir(dirname(resolvedNewPath), { recursive: true });

  // Remove destination if exists and force
  if (destExists && options.force) {
    await rm(resolvedNewPath, { recursive: true, force: true });
  }

  // Try rename first
  let moved = false;
  try {
    await rename(resolvedCurrentPath, resolvedNewPath);
    moved = true;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err.code === "EXDEV" || err.code === "ENOTEMPTY")
    ) {
      s.message("Cross-device move, copying...");
      if (await pathExists(resolvedNewPath)) {
        await rm(resolvedNewPath, { recursive: true, force: true });
      }
      await cp(resolvedCurrentPath, resolvedNewPath, { recursive: true });
      await rm(resolvedCurrentPath, { recursive: true, force: true });
      moved = true;
    } else {
      throw err;
    }
  }

  if (!moved) {
    s.stop("Failed");
    p.log.error("Failed to move folder");
    return;
  }

  s.message("Updating symlinks...");

  // Update symlinks
  let updated = 0;
  for (const { target, newSource } of symlinksToUpdate) {
    try {
      try {
        const targetStat = await lstat(target);
        if (targetStat.isSymbolicLink()) {
          await unlink(target);
        }
      } catch {
        // Target doesn't exist
      }

      await mkdir(dirname(target), { recursive: true });

      if (await pathExists(newSource)) {
        await symlink(newSource, target);
        updated++;
      }
    } catch {
      // Continue on error
    }
  }

  // Update state
  await saveState({
    dotfilesPath: resolvedNewPath,
    configuredAt: new Date().toISOString(),
  });

  s.stop("Done");

  p.log.success(`Dotfiles moved to ${resolvedNewPath}`);
  p.log.info(`Symlinks updated: ${updated}/${symlinksToUpdate.length}`);

  // Warn about cwd
  const cwd = process.cwd();
  if (isPathInside(cwd, resolvedCurrentPath) || cwd === resolvedCurrentPath) {
    p.log.warn(`Your cwd was inside old location. Run: cd ${resolvedNewPath}`);
  }
}

/**
 * Parse move command arguments
 */
export function parseMoveArgs(args: string[]): { path?: string; options: MoveOptions } {
  let path: string | undefined;
  const options: MoveOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--force" || arg === "-f") {
      options.force = true;
    } else if (arg === "--self") {
      options.self = true;
    } else if (!arg.startsWith("-")) {
      path = arg;
    }
  }

  return { path, options };
}
