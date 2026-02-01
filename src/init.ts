import { $ } from "bun";
import { mkdir, stat, rename, symlink, lstat, readlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadState, saveState } from "./state";
import { loadConfig, writeConfig } from "./config";
import * as p from '@clack/prompts';
import {
  promptDotfilesLocation,
  scanCommonDotfiles,
  selectItems,
  previewSymlinks,
  confirm,
  buildLinksFromDotfiles,
  resolveUnlinkedFiles,
  UserCancelledError,
  intro,
  outro,
  cancel,
  type DetectedDotfile,
  type DotfileStatus,
} from "./wizard";
import type { DotConfig, LinkMap } from "./types";

export type InitOptions = {
  from?: string;    // --from github.com/user/dotfiles
  force?: boolean;  // --force to overwrite existing config
};

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
 * Clone a git repository
 */
async function cloneRepo(repoUrl: string, destPath: string): Promise<boolean> {
  console.log(`Cloning ${repoUrl}...`);

  // Normalize repo URL
  let url = repoUrl;
  if (!url.includes("://") && !url.startsWith("git@")) {
    // Assume github shorthand: user/repo or github.com/user/repo
    if (url.startsWith("github.com/")) {
      url = `https://${url}.git`;
    } else if (url.includes("/") && !url.includes(".")) {
      url = `https://github.com/${url}.git`;
    }
  }

  try {
    await $`git clone ${url} ${destPath}`.quiet();
    console.log(`Cloned to ${destPath}`);
    return true;
  } catch (error) {
    console.error(`Failed to clone: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

/**
 * Initialize git repository if not already initialized
 */
async function initGitRepo(path: string): Promise<boolean> {
  const gitDir = `${path}/.git`;
  if (await pathExists(gitDir)) {
    return true; // Already initialized
  }

  console.log("Initializing git repository...");
  try {
    await $`git init ${path}`.quiet();
    return true;
  } catch (error) {
    console.error(`Failed to init git: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

/**
 * Execute symlink installation for given links
 */
async function installLinks(links: LinkMap): Promise<void> {
  console.log("\nCreating symlinks...");

  for (const [source, target] of Object.entries(links)) {
    // Ensure parent directory exists
    await mkdir(dirname(target), { recursive: true });

    try {
      // Check if target already exists
      const targetStat = await lstat(target);
      if (targetStat.isSymbolicLink()) {
        const linkTarget = await readlink(target);
        const resolvedTarget = resolve(dirname(target), linkTarget);
        if (resolvedTarget === source) {
          console.log(`  [skip] ${target} (already correct)`);
          continue;
        }
        console.log(`  [warn] ${target} points elsewhere`);
      } else {
        console.log(`  [warn] ${target} exists and is not a symlink`);
      }
    } catch {
      // Target doesn't exist, which is what we want
      // Check if source exists before creating symlink
      if (!(await pathExists(source))) {
        console.log(`  [warn] ${target} skipped (source ${source} does not exist)`);
        continue;
      }
      await symlink(source, target);
      console.log(`  [link] ${target}`);
    }
  }
}

/**
 * Move original dotfiles to repo location (migration)
 */
async function migrateDotfiles(
  dotfiles: DetectedDotfile[],
  dotfilesPath: string
): Promise<void> {
  console.log("\nMigrating dotfiles to repo...");

  for (const df of dotfiles) {
    const destPath = `${dotfilesPath}/${df.suggested}`;

    // Create parent directory
    await mkdir(dirname(destPath), { recursive: true });

    // Check if destination already exists
    if (await pathExists(destPath)) {
      console.log(`  [skip] ${df.name} (${df.suggested} already exists in repo)`);
      continue;
    }

    // Move original file to repo
    try {
      await rename(df.path, destPath);
      console.log(`  [moved] ${df.name} -> ${df.suggested}`);
    } catch (error) {
      console.log(`  [error] ${df.name}: ${error instanceof Error ? error.message : error}`);
    }
  }
}

/**
 * Initialize dot CLI for first-time setup or reconfiguration.
 *
 * Flow:
 * 1. Check existing state
 * 2. Get dotfiles location (prompt or --from clone)
 * 3. Check for existing config
 * 4. Scan for existing dotfiles to migrate
 * 5. Generate config from selections
 * 6. Initialize git if needed
 * 7. Preview symlinks and confirm
 * 8. Execute migration and create symlinks
 * 9. Save state
 */
export async function init(options: InitOptions = {}): Promise<void> {
  intro('dot init - Setup your dotfiles');

  try {
    await initImpl(options);
  } catch (error) {
    if (error instanceof UserCancelledError) {
      cancel('Operation cancelled');
      process.exit(0);
    }
    throw error;
  }
}

/**
 * Internal implementation of init command.
 */
async function initImpl(options: InitOptions): Promise<void> {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME environment variable is not set");
  }

  // 1. Check existing state
  const existingState = await loadState();
  if (existingState?.dotfilesPath && !options.force) {
    console.log(`Dotfiles already configured at: ${existingState.dotfilesPath}`);
    if (!(await confirm("Reconfigure dotfiles?"))) {
      console.log("Keeping existing configuration.");
      return;
    }
  }

  // 2. Get dotfiles location
  let dotfilesPath: string;

  if (options.from) {
    // Clone from URL
    const defaultDest = `${home}/.dotfiles`;
    console.log(`Will clone to: ${defaultDest}`);

    if (await pathExists(defaultDest)) {
      console.log(`Warning: ${defaultDest} already exists`);
      if (!(await confirm("Continue anyway? (existing content may be overwritten)"))) {
        console.log("Aborted.");
        return;
      }
    }

    const success = await cloneRepo(options.from, defaultDest);
    if (!success) {
      console.log("Clone failed. Aborting.");
      return;
    }
    dotfilesPath = defaultDest;
  } else {
    // Prompt for location
    dotfilesPath = await promptDotfilesLocation();
  }

  // Create directory if it doesn't exist
  if (!(await pathExists(dotfilesPath))) {
    console.log(`Creating ${dotfilesPath}...`);
    await mkdir(dotfilesPath, { recursive: true });
  }

  // 3. Check for existing config
  let config = await loadConfig(dotfilesPath);
  let useExistingConfig = false;

  if (config) {
    console.log("\nFound existing dot.config.json");
    if (await confirm("Use existing configuration?")) {
      useExistingConfig = true;
    }
  }

  let selectedDotfiles: DetectedDotfile[] = [];

  if (!useExistingConfig) {
    // 4. Scan for existing dotfiles (with awareness of what's in dotfiles repo)
    const s = p.spinner();
    s.start('Scanning for symlinks (skipping Downloads, node_modules, caches)...');
    const foundDotfiles = await scanCommonDotfiles(home, dotfilesPath);
    s.stop('Scan complete');

    // Categorize by status
    const alreadyLinked = foundDotfiles.filter(df => df.status === 'already-linked');
    const inRepo = foundDotfiles.filter(df => df.status === 'in-repo');
    const available = foundDotfiles.filter(df => df.status === 'available');
    const conflicts = foundDotfiles.filter(df => df.status === 'conflict');

    // Show summary of what's already set up
    if (alreadyLinked.length > 0) {
      p.log.success(`Symlinks found pointing to your dotfiles repo (${alreadyLinked.length}):`);
      for (const df of alreadyLinked) {
        // Show symlink location -> repo file
        console.log(`  ${df.name} -> ${df.suggested}`);
      }
    }

    // Handle in-repo files that appear unlinked
    let resolvedInRepo = inRepo;
    if (inRepo.length > 0) {
      p.log.info(`Available in repo - not yet linked (${inRepo.length}):`);
      console.log("  These files exist in your dotfiles repo but don't have symlinks yet.\n");
      for (const df of inRepo) {
        console.log(`  ${df.suggested} -> ${df.name}`);
      }
      console.log('');

      // Offer to resolve manually if user has symlinks in unusual locations
      resolvedInRepo = await resolveUnlinkedFiles(inRepo, dotfilesPath);

      // Separate out any that were resolved as already-linked
      const nowLinked = resolvedInRepo.filter(df => df.status === 'already-linked');
      const stillUnlinked = resolvedInRepo.filter(df => df.status !== 'already-linked');

      if (nowLinked.length > 0) {
        // Move resolved files to alreadyLinked category
        alreadyLinked.push(...nowLinked);
        resolvedInRepo = stillUnlinked;

        if (stillUnlinked.length > 0) {
          p.log.info(`Still unlinked (${stillUnlinked.length}):`);
          for (const df of stillUnlinked) {
            console.log(`  ${df.suggested} -> ${df.name}`);
          }
        }
      }
    }

    if (conflicts.length > 0) {
      p.log.warn(`Conflicts - file exists in both locations (${conflicts.length}):`);
      for (const df of conflicts) {
        console.log(`  ${df.name} (home) vs ${df.suggested} (repo)`);
      }
    }

    // Only offer to migrate files that are available
    if (available.length === 0) {
      if (foundDotfiles.length === 0) {
        p.log.info("No common dotfiles found.");
      } else if (alreadyLinked.length > 0 || inRepo.length > 0) {
        p.log.info("All detected dotfiles are already in the repo or linked.");
      }
    } else {
      p.log.step(`Available to migrate (${available.length}):`);

      // Convert to selectable items
      const selectableItems = available.map(df => ({
        text: df.name,
        description: df.warning ?? `-> ${df.suggested}`,
        ...df,
      }));

      // Multi-select which ones to migrate
      selectedDotfiles = await selectItems(selectableItems, {
        headerText: "Select dotfiles to migrate",
        multi: true,
      }) as DetectedDotfile[];
    }

    // 5. Generate config
    // Include in-repo files (they need symlinks) and already-linked files (preserve existing config)
    const allToLink = [...selectedDotfiles, ...resolvedInRepo, ...alreadyLinked];

    // Ask about autoCommit
    const autoCommit = await confirm("Enable auto-commit when tracking new files?");

    // Build links from selected + already-tracked dotfiles
    const links = buildLinksFromDotfiles(allToLink, dotfilesPath);

    config = {
      links,
      autoCommit,
    };

    // Write config
    await writeConfig(dotfilesPath, config);
    p.log.success("Created dot.config.json");
  }

  // 6. Initialize git if needed
  await initGitRepo(dotfilesPath);

  // Check if there are uncommitted changes we should offer to commit
  const { exitCode: statusCode } = await $`git -C ${dotfilesPath} status --porcelain`.quiet().nothrow();
  if (statusCode === 0) {
    const statusOutput = await $`git -C ${dotfilesPath} status --porcelain`.text();
    if (statusOutput.trim()) {
      console.log("\nUncommitted changes in repo:");
      console.log(statusOutput);

      if (await confirm("Create initial commit?")) {
        await $`git -C ${dotfilesPath} add -A`.quiet();
        await $`git -C ${dotfilesPath} commit -m "Initial commit via dot init"`.quiet();
        console.log("Created initial commit.");
      }
    }
  }

  // 7. Preview and confirm
  if (Object.keys(config!.links).length > 0) {
    const preview = await previewSymlinks(config!.links, dotfilesPath);

    if (preview.hasConflicts && !options.force) {
      console.log("Resolve conflicts first, or use --force to override.");
      return;
    }

    if (!(await confirm("Create these symlinks?"))) {
      console.log("Skipping symlink creation.");
    } else {
      // 8. Execute
      // First migrate selected dotfiles if any
      if (selectedDotfiles.length > 0) {
        await migrateDotfiles(selectedDotfiles, dotfilesPath);
      }

      // Then create symlinks
      await installLinks(config!.links);
    }
  } else {
    console.log("\nNo symlinks to create (empty configuration).");
  }

  // 9. Save state
  await saveState({
    dotfilesPath,
    configuredAt: new Date().toISOString(),
  });

  // Success message
  outro(`Dotfiles initialized at ${dotfilesPath}. Run 'dot doctor' to verify.`);
}

/**
 * Parse init command arguments
 */
export function parseInitArgs(args: string[]): InitOptions {
  const options: InitOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--from" && i + 1 < args.length) {
      options.from = args[++i];
    } else if (arg === "--force" || arg === "-f") {
      options.force = true;
    }
  }

  return options;
}
