import * as p from '@clack/prompts';
import { stat, lstat, readdir, mkdir, readlink } from 'node:fs/promises';
import { resolve, dirname, basename, relative } from 'node:path';
import type { LinkMap } from './types';

/**
 * Status of a detected dotfile relative to the dotfiles repo.
 */
export type DotfileStatus =
  | 'available'      // File exists in home, not yet tracked
  | 'already-linked' // File is a symlink pointing to dotfiles repo
  | 'in-repo'        // File exists in dotfiles repo, not yet linked from home
  | 'conflict';      // File exists in both places but not linked

/**
 * Detected dotfile with metadata for migration wizard.
 */
export type DetectedDotfile = {
  path: string;           // Full path to the file (e.g., /Users/user/.config/git/config)
  name: string;           // Display name (e.g., .config/git/config)
  suggested: string;      // Suggested location in repo (e.g., git/.gitconfig)
  sourcePath?: string;    // Actual source path in repo (for already-linked files)
  isDirectory: boolean;   // Whether it's a directory
  warning?: string;       // Warning message (e.g., for .ssh/config)
  status?: DotfileStatus; // Status relative to dotfiles repo
};

/**
 * Common dotfiles to scan for during init.
 * Maps file paths relative to home to suggested repo locations.
 */
const COMMON_DOTFILES: Array<{
  path: string;             // Path relative to home (e.g., ".gitconfig")
  suggested: string;        // Suggested location in repo
  warning?: string;         // Warning to show user
}> = [
  // Shell
  { path: '.zshrc', suggested: 'zsh/zshrc' },
  { path: '.zprofile', suggested: 'zsh/zprofile' },
  { path: '.zshenv', suggested: 'zsh/zshenv' },
  { path: '.bashrc', suggested: 'bash/bashrc' },
  { path: '.bash_profile', suggested: 'bash/bash_profile' },

  // Git
  { path: '.gitconfig', suggested: 'git/.gitconfig' },
  { path: '.config/git/config', suggested: 'git/config' },

  // Editors
  { path: '.vimrc', suggested: 'vim/vimrc' },
  { path: '.config/nvim', suggested: 'nvim' },

  // Terminal
  { path: '.tmux.conf', suggested: 'tmux/tmux.conf' },
  { path: '.config/tmux/tmux.conf', suggested: 'tmux/tmux.conf' },
  { path: '.config/starship.toml', suggested: 'starship/starship.toml' },
  { path: '.config/alacritty', suggested: 'alacritty' },

  // SSH (with warning)
  {
    path: '.ssh/config',
    suggested: 'ssh/config',
    warning: 'SSH config may contain sensitive paths. Review before committing.',
  },

  // Other common
  { path: '.npmrc', suggested: 'npm/npmrc' },
];

/**
 * Expand ~ to home directory and resolve to absolute path.
 */
export function expandPath(inputPath: string): string {
  const home = process.env.HOME ?? '';
  if (inputPath === '~') {
    return home;
  }
  if (inputPath.startsWith('~/')) {
    return resolve(home, inputPath.slice(2));
  }
  return resolve(inputPath);
}

/**
 * Check if a path exists.
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
 * Check if a path is a directory.
 */
async function isDirectory(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Custom error class for user cancellation (Ctrl+C).
 * This allows callers to distinguish between errors and user abort.
 */
export class UserCancelledError extends Error {
  constructor(message = 'User cancelled') {
    super(message);
    this.name = 'UserCancelledError';
  }
}

/**
 * Check if result is a cancellation and throw if so.
 */
function checkCancel<T>(result: T | symbol): T {
  if (p.isCancel(result)) {
    throw new UserCancelledError();
  }
  return result;
}

/**
 * Get subdirectories of a path, sorted alphabetically.
 * Excludes hidden directories (starting with .) except for common dotfile locations.
 */
async function getSubdirectories(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort((a, b) => {
        // Sort hidden dirs after visible ones
        const aHidden = a.startsWith('.');
        const bHidden = b.startsWith('.');
        if (aHidden && !bHidden) return 1;
        if (!aHidden && bHidden) return -1;
        return a.localeCompare(b);
      });
  } catch {
    return [];
  }
}

/**
 * Format a path for display, replacing home with ~
 */
function formatPath(path: string): string {
  const home = process.env.HOME ?? '';
  if (path === home) return '~';
  if (path.startsWith(home + '/')) {
    return '~' + path.slice(home.length);
  }
  return path;
}

/**
 * Interactive directory browser.
 * Allows navigation through directories with options to select or create.
 * Returns the selected absolute path.
 * Throws UserCancelledError if user presses Ctrl+C.
 */
async function browseDirectory(startPath: string): Promise<string> {
  let currentPath = startPath;

  while (true) {
    const subdirs = await getSubdirectories(currentPath);
    const parentPath = dirname(currentPath);
    const canGoUp = parentPath !== currentPath; // Not at root

    // Build options
    const options: Array<{ value: string; label: string; hint?: string }> = [
      { value: '__select__', label: 'Use this directory', hint: formatPath(currentPath) },
      { value: '__create__', label: 'Create new folder here' },
    ];

    if (canGoUp) {
      options.push({ value: '__up__', label: '..', hint: 'Go up' });
    }

    // Add subdirectories
    for (const dir of subdirs) {
      const isHidden = dir.startsWith('.');
      options.push({
        value: dir,
        label: dir + '/',
        hint: isHidden ? 'hidden' : undefined,
      });
    }

    const result = await p.select({
      message: `Browse: ${formatPath(currentPath)}`,
      options,
    });

    checkCancel(result);

    if (result === '__select__') {
      return currentPath;
    }

    if (result === '__create__') {
      const folderName = await p.text({
        message: 'New folder name:',
        placeholder: 'my-dotfiles',
        validate: (value) => {
          if (!value || !value.trim()) return 'Folder name is required';
          if (value.includes('/')) return 'Folder name cannot contain /';
          return undefined;
        },
      });

      checkCancel(folderName);

      const newPath = resolve(currentPath, folderName as string);

      // Create the directory
      try {
        await mkdir(newPath, { recursive: true });
        return newPath;
      } catch (error) {
        // If creation fails, show error and continue browsing
        p.log.error(`Failed to create directory: ${error instanceof Error ? error.message : error}`);
        continue;
      }
    }

    if (result === '__up__') {
      currentPath = parentPath;
      continue;
    }

    // Navigate into selected directory
    currentPath = resolve(currentPath, result as string);
  }
}

/**
 * Prompt user for dotfiles location with arrow-key selection.
 * Returns absolute path.
 * Throws UserCancelledError if user presses Ctrl+C.
 */
export async function promptDotfilesLocation(): Promise<string> {
  const home = process.env.HOME ?? '';
  const defaultPath = `${home}/.dotfiles`;

  const result = await p.select({
    message: 'Where are your dotfiles?',
    options: [
      { value: 'default', label: defaultPath, hint: 'default location' },
      { value: 'browse', label: 'Browse for location', hint: 'navigate directories' },
    ],
  });

  checkCancel(result);

  if (result === 'browse') {
    return browseDirectory(home);
  }

  return defaultPath;
}

/**
 * Get the resolved symlink target if path is a symlink pointing into dotfiles repo.
 * Returns the absolute path to the source file in the repo, or null if not a symlink to repo.
 */
async function getSymlinkSourceInRepo(path: string, dotfilesPath: string): Promise<string | null> {
  try {
    const fileStat = await lstat(path);
    if (!fileStat.isSymbolicLink()) {
      return null;
    }
    const target = await readlink(path);
    const resolvedTarget = resolve(dirname(path), target);

    // Check if it points into the dotfiles repo
    if (resolvedTarget.startsWith(dotfilesPath + '/') || resolvedTarget === dotfilesPath) {
      return resolvedTarget;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get the relative path within the dotfiles repo from an absolute path.
 */
function getRelativeRepoPath(absolutePath: string, dotfilesPath: string): string {
  return relative(dotfilesPath, absolutePath);
}

/**
 * Scan home directory for common dotfiles.
 * If dotfilesPath is provided, determines status of each file relative to the repo.
 * Returns array of detected dotfiles with metadata and status.
 */
export async function scanCommonDotfiles(
  home: string,
  dotfilesPath?: string
): Promise<DetectedDotfile[]> {
  const found: DetectedDotfile[] = [];

  // First pass: collect all symlinks pointing to dotfiles repo
  // This lets us know which repo files are already linked from ANY location
  const alreadyLinkedSources = new Set<string>();

  if (dotfilesPath) {
    // Scan COMMON_DOTFILES paths
    for (const entry of COMMON_DOTFILES) {
      const fullPath = resolve(home, entry.path);
      const actualSourcePath = await getSymlinkSourceInRepo(fullPath, dotfilesPath);
      if (actualSourcePath) {
        alreadyLinkedSources.add(actualSourcePath);
      }
    }

    // Also scan ~/.config subdirectories for symlinks
    // This catches symlinks like ~/.config/zsh/.zshrc that aren't in COMMON_DOTFILES
    const configPath = `${home}/.config`;
    try {
      const configDirs = await readdir(configPath);
      for (const dir of configDirs) {
        const subDirPath = `${configPath}/${dir}`;
        try {
          const subDirStat = await lstat(subDirPath);
          if (subDirStat.isDirectory()) {
            // Scan files in this subdirectory
            const subFiles = await readdir(subDirPath);
            for (const file of subFiles) {
              const fullPath = `${subDirPath}/${file}`;
              const actualSourcePath = await getSymlinkSourceInRepo(fullPath, dotfilesPath);
              if (actualSourcePath) {
                alreadyLinkedSources.add(actualSourcePath);
              }
            }
          } else if (subDirStat.isSymbolicLink()) {
            // The directory entry itself might be a symlink
            const actualSourcePath = await getSymlinkSourceInRepo(subDirPath, dotfilesPath);
            if (actualSourcePath) {
              alreadyLinkedSources.add(actualSourcePath);
            }
          }
        } catch {
          // Ignore errors reading subdirectory
        }
      }
    } catch {
      // Ignore if .config doesn't exist
    }
  }

  // Second pass: categorize each entry
  for (const entry of COMMON_DOTFILES) {
    const fullPath = resolve(home, entry.path);
    const homeFileExists = await pathExists(fullPath);

    // If no dotfiles path provided, just check if file exists
    if (!dotfilesPath) {
      if (homeFileExists) {
        const isDir = await isDirectory(fullPath);
        found.push({
          path: fullPath,
          name: entry.path,
          suggested: entry.suggested,
          isDirectory: isDir,
          warning: entry.warning,
          status: 'available',
        });
      }
      continue;
    }

    // Check if it's already a symlink to our dotfiles - get ACTUAL source path
    const actualSourcePath = await getSymlinkSourceInRepo(fullPath, dotfilesPath);

    if (actualSourcePath) {
      // It's a symlink pointing into our repo - get the real relative path
      const actualRelativePath = getRelativeRepoPath(actualSourcePath, dotfilesPath);
      const isDir = await isDirectory(actualSourcePath);

      found.push({
        path: fullPath,
        name: entry.path,
        suggested: actualRelativePath, // Use actual path, not assumed
        sourcePath: actualSourcePath,
        isDirectory: isDir,
        warning: entry.warning,
        status: 'already-linked',
      });
      continue;
    }

    // Check if source exists in dotfiles repo at the suggested location
    const suggestedSourcePath = resolve(dotfilesPath, entry.suggested);
    const sourceExists = await pathExists(suggestedSourcePath);

    // If this repo file is already linked from a DIFFERENT location, skip it
    if (sourceExists && alreadyLinkedSources.has(suggestedSourcePath)) {
      continue;
    }

    // Determine status
    let status: DotfileStatus;

    if (homeFileExists) {
      if (sourceExists) {
        // Both exist but not linked - conflict
        status = 'conflict';
      } else {
        // Home file exists, source doesn't - available to migrate
        status = 'available';
      }
    } else if (sourceExists) {
      // Source exists in repo but no home file - in repo, can be linked
      status = 'in-repo';
    } else {
      // Neither exists, skip
      continue;
    }

    const isDir = homeFileExists
      ? await isDirectory(fullPath)
      : await isDirectory(suggestedSourcePath);

    found.push({
      path: fullPath,
      name: entry.path,
      suggested: entry.suggested,
      sourcePath: sourceExists ? suggestedSourcePath : undefined,
      isDirectory: isDir,
      warning: entry.warning,
      status,
    });
  }

  return found;
}

/**
 * Item type for selectItems function.
 */
export type SelectableItem = {
  text: string;
  description?: string;
};

/**
 * Select items using multi-select checkboxes.
 * Throws UserCancelledError if user presses Ctrl+C.
 */
export async function selectItems<T extends SelectableItem>(
  items: T[],
  options?: { headerText?: string; multi?: boolean }
): Promise<T[]> {
  if (items.length === 0) {
    return [];
  }

  if (options?.multi) {
    // Multi-select with checkboxes
    const result = await p.multiselect({
      message: options.headerText ?? 'Select items',
      options: items.map((item, index) => ({
        value: index,
        label: item.text,
        hint: item.description,
      })),
      required: false,
    });

    checkCancel(result);

    // Map indices back to items
    return (result as number[]).map(index => items[index]!);
  }

  // Single select
  const result = await p.select({
    message: options?.headerText ?? 'Select an item',
    options: items.map((item, index) => ({
      value: index,
      label: item.text,
      hint: item.description,
    })),
  });

  checkCancel(result);

  const selectedItem = items[result as number];
  return selectedItem ? [selectedItem] : [];
}

/**
 * Preview symlinks that will be created.
 * Shows source -> target with status indicators.
 * Returns true if safe to proceed (no conflicts without force).
 */
export async function previewSymlinks(
  links: LinkMap,
  dotfilesPath: string
): Promise<{ safe: boolean; hasConflicts: boolean }> {
  console.log('\nSymlink preview:');
  console.log('================\n');

  let hasNew = false;
  let hasConflicts = false;

  for (const [source, target] of Object.entries(links)) {
    // Check if source exists in dotfiles
    const sourceExists = await pathExists(source);

    // Check if target already exists
    const targetExists = await pathExists(target);

    let status: string;
    if (!sourceExists) {
      status = '[will create]';
      hasNew = true;
    } else if (!targetExists) {
      status = '[new]';
      hasNew = true;
    } else {
      // Check if it's already a symlink pointing to our source
      try {
        const targetStat = await lstat(target);
        if (targetStat.isSymbolicLink()) {
          // It's a symlink - would need to check if it points to right place
          status = '[exists]';
        } else {
          status = '[conflict]';
          hasConflicts = true;
        }
      } catch {
        status = '[conflict]';
        hasConflicts = true;
      }
    }

    // Display relative to dotfiles for cleaner output
    const displaySource = source.startsWith(dotfilesPath)
      ? source.slice(dotfilesPath.length + 1)
      : source;

    console.log(`  ${status.padEnd(14)} ${displaySource}`);
    console.log(`                 -> ${target}`);
  }

  console.log('');

  if (hasConflicts) {
    console.log('Warning: Some targets already exist and are not symlinks.');
    console.log('Use --force to overwrite, or move/remove them first.\n');
  }

  return { safe: !hasConflicts, hasConflicts };
}

/**
 * Confirmation prompt.
 * Throws UserCancelledError if user presses Ctrl+C.
 */
export async function confirm(message: string): Promise<boolean> {
  const result = await p.confirm({
    message,
    initialValue: false, // Default to No for safety
  });

  checkCancel(result);
  return result as boolean;
}

/**
 * Prompt for a text input value.
 * Throws UserCancelledError if user presses Ctrl+C.
 */
export async function promptText(message: string, placeholder?: string): Promise<string | null> {
  const result = await p.text({
    message,
    placeholder,
  });

  checkCancel(result);
  return result as string;
}

/**
 * Build a LinkMap from selected dotfiles.
 * Maps source (in dotfiles repo) to target (original location).
 */
export function buildLinksFromDotfiles(
  dotfiles: DetectedDotfile[],
  dotfilesPath: string
): LinkMap {
  const links: LinkMap = {};

  for (const df of dotfiles) {
    // Use actual sourcePath if available (for already-linked files),
    // otherwise build from suggested path
    const source = df.sourcePath ?? `${dotfilesPath}/${df.suggested}`;
    // Target is where the symlink will be created (original location)
    const target = df.path;
    links[source] = target;
  }

  return links;
}

/**
 * Display intro message for the wizard.
 */
export function intro(message: string): void {
  p.intro(message);
}

/**
 * Display outro message for the wizard.
 */
export function outro(message: string): void {
  p.outro(message);
}

/**
 * Cancel the wizard with a message.
 */
export function cancel(message: string): void {
  p.cancel(message);
}
