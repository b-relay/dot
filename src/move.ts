import {
  stat,
  readdir,
  lstat,
  symlink,
  unlink,
  mkdir,
  cp,
  rm,
  rename,
} from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { saveState } from "./state";
import type { DotConfig } from "./types";

export type MoveOptions = {
  force?: boolean;
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
    return true; // Doesn't exist = effectively empty
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
 * Simple confirmation prompt
 */
async function confirm(message: string): Promise<boolean> {
  process.stdout.write(`${message} [y/N] `);

  // Use stdin for interactive input
  const stdin = process.stdin;
  stdin.setRawMode?.(false);

  return new Promise((resolve) => {
    const readline = require("readline");
    const rl = readline.createInterface({
      input: stdin,
      output: process.stdout,
    });

    rl.question("", (answer: string) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

/**
 * Move dotfiles folder to a new location.
 *
 * Flow:
 * 1. Validate new path (exists, empty, not subdirectory)
 * 2. Preview changes (show symlinks that will be updated)
 * 3. Execute move (rename or copy+delete for cross-device)
 * 4. Update symlinks to point to new location
 * 5. Update state with new path
 *
 * @param newPath Target path for dotfiles folder
 * @param currentPath Current dotfiles path
 * @param config DotConfig with links
 * @param options MoveOptions (force flag)
 */
export async function move(
  newPath: string,
  currentPath: string,
  config: DotConfig,
  options: MoveOptions = {}
): Promise<void> {
  // Resolve paths
  const resolvedNewPath = expandPath(newPath);
  const resolvedCurrentPath = resolve(currentPath);

  // Validate new path
  // 1. Cannot move to subdirectory of itself
  if (isPathInside(resolvedNewPath, resolvedCurrentPath)) {
    throw new Error("Cannot move to subdirectory of itself");
  }

  // 2. Check if destination exists and is not empty
  const destExists = await pathExists(resolvedNewPath);
  if (destExists) {
    const isEmpty = await isDirEmpty(resolvedNewPath);
    if (!isEmpty) {
      if (!options.force) {
        throw new Error(
          "Destination exists and is not empty. Use --force to override."
        );
      }
      console.log(`Warning: Destination ${resolvedNewPath} is not empty`);
    }
  }

  // 3. Compute symlinks to update
  const symlinksToUpdate: { target: string; oldSource: string; newSource: string }[] = [];

  for (const [source, target] of Object.entries(config.links)) {
    // Source paths in config are relative to dotfiles root (e.g., "zsh/zshrc")
    // Target paths use ~ notation (e.g., "~/.config/zsh/.zshrc")
    const oldSource = resolve(resolvedCurrentPath, source);
    const newSource = resolve(resolvedNewPath, source);
    const expandedTarget = expandPath(target);

    symlinksToUpdate.push({ target: expandedTarget, oldSource, newSource });
  }

  // 4. Preview changes
  console.log(`\nWill move: ${resolvedCurrentPath} -> ${resolvedNewPath}`);
  console.log(`\nSymlinks to update (${symlinksToUpdate.length}):`);
  for (const { target, newSource } of symlinksToUpdate) {
    console.log(`  ${target} -> ${newSource}`);
  }

  // 5. Confirmation
  if (!options.force) {
    const confirmed = await confirm("\nProceed with move?");
    if (!confirmed) {
      console.log("Aborted.");
      return;
    }
  }

  // 6. Execute move
  console.log("\nMoving folder...");

  // Create parent directory if needed
  await mkdir(dirname(resolvedNewPath), { recursive: true });

  // If destination exists and we have force, remove it first
  if (destExists && options.force) {
    await rm(resolvedNewPath, { recursive: true, force: true });
  }

  // Try rename first (atomic, fast, same device)
  let moved = false;
  try {
    await rename(resolvedCurrentPath, resolvedNewPath);
    moved = true;
  } catch (err: unknown) {
    // Cross-device link error (EXDEV) or non-empty dir (ENOTEMPTY) - fall back to copy+delete
    if (
      err instanceof Error &&
      "code" in err &&
      (err.code === "EXDEV" || err.code === "ENOTEMPTY")
    ) {
      console.log("Cross-device move, copying...");
      // Remove destination if exists (for ENOTEMPTY case)
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
    throw new Error("Failed to move folder");
  }

  console.log("Folder moved successfully.");

  // 7. Update symlinks
  console.log("\nUpdating symlinks...");
  const failures: { target: string; error: string }[] = [];

  for (const { target, newSource } of symlinksToUpdate) {
    try {
      // Remove old symlink (if exists)
      try {
        const targetStat = await lstat(target);
        if (targetStat.isSymbolicLink()) {
          await unlink(target);
        }
      } catch {
        // Target doesn't exist, that's fine
      }

      // Create parent directory if needed
      await mkdir(dirname(target), { recursive: true });

      // Check if source exists before creating symlink
      if (await pathExists(newSource)) {
        await symlink(newSource, target);
        console.log(`  [updated] ${target}`);
      } else {
        console.log(`  [skipped] ${target} (source ${newSource} does not exist)`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      failures.push({ target, error: errorMsg });
      console.log(`  [error] ${target}: ${errorMsg}`);
    }
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} symlink(s) failed to update.`);
  }

  // 8. Update state
  console.log("\nUpdating state...");
  await saveState({
    dotfilesPath: resolvedNewPath,
    configuredAt: new Date().toISOString(),
  });

  // 9. Verify key symlinks work
  let workingSymlinks = 0;
  for (const { target, newSource } of symlinksToUpdate) {
    if (await pathExists(newSource)) {
      try {
        const targetStat = await lstat(target);
        if (targetStat.isSymbolicLink()) {
          workingSymlinks++;
        }
      } catch {
        // Symlink doesn't exist
      }
    }
  }

  console.log(`\nMove complete!`);
  console.log(`  New location: ${resolvedNewPath}`);
  console.log(`  Symlinks working: ${workingSymlinks}/${symlinksToUpdate.length}`);

  // 10. Warn about cwd
  const cwd = process.cwd();
  if (isPathInside(cwd, resolvedCurrentPath) || cwd === resolvedCurrentPath) {
    console.log(
      `\nWarning: Your current directory was inside the old location.`
    );
    console.log(`Run: cd ${resolvedNewPath}`);
  }
}
