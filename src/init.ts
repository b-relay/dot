import { $ } from "bun";
import { mkdir, stat, rename, symlink, lstat, readlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadState, saveState } from "./state";
import { loadConfig, writeConfig } from "./config";
import * as p from '@clack/prompts';
import pc from 'picocolors';
import {
  promptDotfilesLocation,
  scanCommonDotfiles,
  selectItems,
  previewSymlinks,
  confirm,
  buildLinksFromDotfiles,
  resolveUnlinkedFiles,
  scanUnknownRepoFiles,
  configureUnknownFiles,
  listDirectoryContents,
  getAllFilesRecursively,
  printTreeRecursive,
  UserCancelledError,
  intro,
  outro,
  cancel,
  type DetectedDotfile,
  type DotfileStatus,
} from "./wizard";
import type { DotConfig, LinkMap } from "./types";

export type InitOptions = {
  from?: string;      // --from github.com/user/dotfiles
  force?: boolean;    // --force to overwrite existing config
  ignore?: string[];  // --ignore pattern (can be used multiple times)
  dryRun?: boolean;   // --dry-run to preview without making changes
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
    s.start('Scanning for dotfiles and configs...');
    const extraIgnore = [...(config?.ignorePatterns ?? []), ...(options.ignore ?? [])];
    const foundDotfiles = await scanCommonDotfiles(home, dotfilesPath, extraIgnore, config?.customPatterns);
    s.stop('Scan complete');

    // Categorize by status
    const alreadyLinked = foundDotfiles.filter(df => df.status === 'already-linked');
    const brokenLinks = foundDotfiles.filter(df => df.status === 'broken-link');
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

    // Show broken symlinks with warning
    if (brokenLinks.length > 0) {
      p.log.warn(`Broken symlinks (${brokenLinks.length}):`);
      for (const df of brokenLinks) {
        console.log(`  ${df.name} -> ${df.suggested} (target missing)`);
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

      // Separate valuable from low-value files
      const valuable = available.filter(df => !df.isLowValue);
      const lowValue = available.filter(df => df.isLowValue);
      const COLLAPSE_THRESHOLD = 5;

      // Build main selection options - valuable files first
      const mainOptions: Array<{ value: string; label: string; hint?: string }> = [];

      for (const df of valuable) {
        let label = df.name;
        let hint = df.warning ?? `-> ${df.suggested}`;
        if (df.isDirectory && df.fileCount !== undefined) {
          label += `/ (${df.fileCount} ${df.fileCount === 1 ? 'item' : 'items'})`;
          hint = 'select to review contents';
        }
        mainOptions.push({
          value: df.name,
          label,
          hint,
        });
      }

      // Handle low-value files based on count
      if (lowValue.length > COLLAPSE_THRESHOLD) {
        // Add a "show more" option for collapsed low-value files
        mainOptions.push({
          value: '__show_more__',
          label: pc.dim(`Show ${lowValue.length} more files...`),
          hint: pc.dim('cache, history, temp files'),
        });
      } else if (lowValue.length > 0) {
        // Add low-value files directly (dimmed) if <= threshold
        for (const df of lowValue) {
          let label = df.name;
          let hint = df.annotation ?? 'may not be worth tracking';
          if (df.isDirectory && df.fileCount !== undefined) {
            label += `/ (${df.fileCount} ${df.fileCount === 1 ? 'item' : 'items'})`;
          }
          mainOptions.push({
            value: df.name,
            label: pc.dim(label),
            hint: pc.dim(hint),
          });
        }
      }

      // Create a map for quick lookup
      const dfByName = new Map(available.map(df => [df.name, df]));

      // Multi-select which ones to migrate
      const mainSelected = await p.multiselect({
        message: 'Select dotfiles to migrate',
        options: mainOptions,
        required: false,
      });

      if (p.isCancel(mainSelected)) throw new UserCancelledError();

      let initialSelection: DetectedDotfile[] = [];

      // Check if user selected __show_more__
      if ((mainSelected as string[]).includes('__show_more__')) {
        // Get main selections (excluding the marker)
        const mainNames = (mainSelected as string[]).filter(s => s !== '__show_more__');
        initialSelection = mainNames.map(name => dfByName.get(name)!).filter(Boolean);

        // Show second selection for low-value files
        p.log.info('These files are typically caches, history, or temp files:');

        const lowValueOptions = lowValue.map(df => {
          let label = df.name;
          let hint = df.annotation ?? 'may not be worth tracking';
          if (df.isDirectory && df.fileCount !== undefined) {
            label += `/ (${df.fileCount} ${df.fileCount === 1 ? 'item' : 'items'})`;
          }
          return {
            value: df.name,
            label,
            hint,
          };
        });

        const lowValueSelected = await p.multiselect({
          message: 'Select any you want to track anyway:',
          options: lowValueOptions,
          required: false,
        });

        if (!p.isCancel(lowValueSelected)) {
          const lowValueNames = lowValueSelected as string[];
          const selectedLowValue = lowValueNames.map(name => dfByName.get(name)!).filter(Boolean);
          initialSelection = [...initialSelection, ...selectedLowValue];
        }
      } else {
        // No show more selected, just use main selections
        const selectedNames = mainSelected as string[];
        initialSelection = selectedNames.map(name => dfByName.get(name)!).filter(Boolean);
      }

      // Helper to handle a folder selection recursively
      async function handleFolder(df: DetectedDotfile): Promise<DetectedDotfile[]> {
        const results: DetectedDotfile[] = [];
        const contents = await listDirectoryContents(df.path, df.name, df.suggested);

        if (contents.length === 0) {
          return [df]; // Empty folder
        }

        // Show tree view of contents
        console.log(`\n${df.name}/`);
        await printTreeRecursive(df.path, '', 3);
        console.log('');

        const action = await p.select({
          message: `How do you want to handle ${df.name}/?`,
          options: [
            { value: 'all', label: 'Include entire folder', hint: 'symlink the whole folder' },
            { value: 'files', label: 'Include all as individual files', hint: 'separate symlinks for each file' },
            { value: 'pick', label: 'Pick specific items', hint: 'choose which to include' },
            { value: 'skip', label: 'Skip this folder', hint: 'don\'t migrate any of it' },
          ],
        });

        if (p.isCancel(action)) throw new UserCancelledError();

        if (action === 'skip') {
          return [];
        }

        // Ask for custom folder name in dotfiles
        const defaultName = df.suggested;
        const folderName = await p.text({
          message: 'Folder name in dotfiles repo:',
          defaultValue: defaultName,
          placeholder: defaultName,
        });

        if (p.isCancel(folderName)) throw new UserCancelledError();

        const customSuggested = folderName as string;

        if (action === 'all') {
          // Symlink the folder itself with custom name
          results.push({ ...df, suggested: customSuggested });
        } else if (action === 'files') {
          // Get all files recursively
          const allFiles = await getAllFilesRecursively(df.path, df.name, customSuggested);
          if (allFiles.length > 0) {
            p.log.info(`Found ${allFiles.length} files`);
            results.push(...allFiles);
          } else {
            results.push({ ...df, suggested: customSuggested });
          }
        } else if (action === 'pick') {
          // Show items for selection
          const contentItems = contents.map(c => {
            const itemName = c.name.split('/').pop()!;
            let text = c.isDirectory ? `${itemName}/ (${c.fileCount ?? 0} items)` : itemName;
            return {
              text,
              description: c.isDirectory ? 'folder' : 'file',
              ...c,
              // Update suggested path with custom folder name
              suggested: `${customSuggested}/${itemName}`,
            };
          });

          const selectedFiles = await selectItems(contentItems, {
            headerText: `Select items from ${df.name}`,
            multi: true,
          }) as DetectedDotfile[];

          for (const sf of selectedFiles) {
            if (sf.isDirectory && sf.fileCount && sf.fileCount > 0) {
              // Recursively handle subfolder
              const subResults = await handleFolder(sf);
              results.push(...subResults);
            } else {
              results.push(sf);
            }
          }
        }

        return results;
      }

      // Process selected folders
      selectedDotfiles = [];
      for (const df of initialSelection) {
        if (df.isDirectory && df.fileCount && df.fileCount > 0) {
          const folderResults = await handleFolder(df);
          selectedDotfiles.push(...folderResults);
        } else {
          selectedDotfiles.push(df);
        }
      }
    }

    // 4b. Scan for unknown repo files (not in COMMON_DOTFILES)
    // Build set of known sources from what we've already found
    const knownSources = new Set<string>();
    for (const df of [...alreadyLinked, ...resolvedInRepo, ...selectedDotfiles]) {
      if (df.sourcePath) {
        knownSources.add(df.sourcePath);
      }
      knownSources.add(df.suggested);
    }

    const unknownFiles = await scanUnknownRepoFiles(dotfilesPath, knownSources);
    let configuredUnknown: DetectedDotfile[] = [];

    if (unknownFiles.length > 0) {
      configuredUnknown = await configureUnknownFiles(unknownFiles, dotfilesPath);
    }

    // 5. Generate config
    // Include in-repo files (they need symlinks) and already-linked files (preserve existing config)
    const allToLink = [...selectedDotfiles, ...resolvedInRepo, ...alreadyLinked, ...configuredUnknown];

    // Ask about autoCommit
    const autoCommit = await confirm("Enable auto-commit when tracking new files?");

    // Ask about brewfile exclusions
    p.log.info("When running 'dot sync', some package types can be excluded from your brewfile.");
    console.log("  Examples:");
    console.log("    vscode - VS Code extensions (vscode \"extension-name\")");
    console.log("    mas    - Mac App Store apps (mas \"Xcode\")");
    console.log("");

    const configureBrewfile = await confirm("Exclude VS Code extensions from brewfile sync?");

    let brewfileConfig: { path: string; exclude: string[] } | undefined;
    if (configureBrewfile) {
      brewfileConfig = {
        path: "homebrew/brewfile",
        exclude: ["vscode"],
      };
    }

    // Build links from selected + already-tracked dotfiles
    const links = buildLinksFromDotfiles(allToLink, dotfilesPath);

    config = {
      links,
      autoCommit,
      ...(brewfileConfig && { brewfile: brewfileConfig }),
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
      // If autoCommit is enabled, just commit. Otherwise ask.
      const shouldCommit = config?.autoCommit ?? await confirm("Create initial commit?");
      if (shouldCommit) {
        await $`git -C ${dotfilesPath} add -A`.quiet();
        await $`git -C ${dotfilesPath} commit -m "Initial commit via dot init"`.quiet();
        p.log.success("Created initial commit");
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

      // Commit migrated files
      if (selectedDotfiles.length > 0) {
        const statusOutput = await $`git -C ${dotfilesPath} status --porcelain`.text();
        if (statusOutput.trim()) {
          const shouldCommit = config!.autoCommit || await confirm("Commit migrated files?");
          if (shouldCommit) {
            await $`git -C ${dotfilesPath} add -A`.quiet();
            await $`git -C ${dotfilesPath} commit -m "Add migrated dotfiles via dot init"`.quiet();
            p.log.success("Committed migrated files");
          }
        }
      }
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
    } else if (arg === "--ignore" && i + 1 < args.length) {
      options.ignore = options.ignore ?? [];
      options.ignore.push(args[++i]!);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    }
  }

  return options;
}
