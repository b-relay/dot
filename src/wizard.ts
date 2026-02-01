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
  | 'broken-link'    // Symlink points to dotfiles repo but target doesn't exist
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
 * Suggested repo paths for known dotfiles.
 * Used to provide better defaults when user selects a file.
 */
const SUGGESTED_PATHS: Record<string, string> = {
  // Shell
  '.zshrc': 'zsh/zshrc',
  '.zprofile': 'zsh/zprofile',
  '.zshenv': 'zsh/zshenv',
  '.bashrc': 'bash/bashrc',
  '.bash_profile': 'bash/bash_profile',
  // Git
  '.gitconfig': 'git/.gitconfig',
  '.config/git/config': 'git/config',
  '.config/git': 'git',
  // Editors
  '.vimrc': 'vim/vimrc',
  '.config/nvim': 'nvim',
  // Terminal
  '.tmux.conf': 'tmux/tmux.conf',
  '.config/tmux': 'tmux',
  '.config/starship.toml': 'starship/starship.toml',
  '.config/alacritty': 'alacritty',
  '.config/kitty': 'kitty',
  '.config/wezterm': 'wezterm',
  // SSH
  '.ssh/config': 'ssh/config',
  // Other
  '.npmrc': 'npm/npmrc',
};

/**
 * Paths that should show a warning about sensitive content.
 */
const SENSITIVE_PATHS: Record<string, string> = {
  '.ssh': 'SSH directory may contain private keys. Only track config files.',
  '.ssh/config': 'SSH config may contain sensitive paths. Review before committing.',
  '.gnupg': 'GPG directory contains private keys. Do not track.',
  '.aws': 'AWS directory may contain credentials. Do not track credentials.',
  '.netrc': 'Contains plaintext passwords. Do not track.',
};

/**
 * Dotfiles/folders in $HOME that should never be offered for tracking.
 * These are system files, caches, or known large directories.
 */
const SKIP_HOME_DOTFILES = new Set([
  // System files
  '.DS_Store',
  '.localized',
  '.CFUserTextEncoding',
  '.Trash',
  // Caches and temp
  '.cache',
  '.local',
  '.tmp',
  '.temp',
  // Package managers (large, auto-generated)
  '.npm',
  '.yarn',
  '.pnpm',
  '.bun',
  '.cargo',
  '.rustup',
  '.gradle',
  '.m2',
  '.ivy2',
  '.go',
  // Version managers
  '.nvm',
  '.fnm',
  '.pyenv',
  '.rbenv',
  '.virtualenvs',
  '.conda',
  // IDE state (large, machine-specific)
  '.vscode-server',
  '.cursor-server',
  '.eclipse',
  '.idea',
  // Cloud storage
  '.dropbox',
  // Containers
  '.docker',
  '.vagrant',
  '.minikube',
  // History files (machine-specific, can be large)
  '.zsh_history',
  '.bash_history',
  '.node_repl_history',
  '.python_history',
  '.lesshst',
  '.wget-hsts',
  // Session files
  '.zsh_sessions',
  '.bash_sessions',
  // Secrets (should never track)
  '.gnupg',
  '.password-store',
  '.netrc',
]);

/**
 * Entries in ~/.config that should never be offered for tracking.
 */
const SKIP_CONFIG_ENTRIES = new Set([
  // Large app data
  'google-chrome',
  'chromium',
  'BraveSoftware',
  'firefox',
  'Code',          // VS Code (large)
  'Cursor',        // Cursor (large)
  // Caches
  'cache',
  'Cache',
  // Session/state
  'session',
  'configstore',
  'pulse',         // PulseAudio
  // Package managers
  'yarn',
  'npm',
  'pnpm',
]);

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
 * Result of checking a symlink's status relative to the dotfiles repo.
 */
type SymlinkCheckResult = {
  sourcePath: string;    // Absolute path the symlink points to in the repo
  targetExists: boolean; // Whether the target file actually exists
} | null;

/**
 * Get the resolved symlink target if path is a symlink pointing into dotfiles repo.
 * Returns the absolute path to the source file in the repo and whether it exists,
 * or null if not a symlink to repo.
 */
async function checkSymlinkToRepo(path: string, dotfilesPath: string): Promise<SymlinkCheckResult> {
  try {
    const fileStat = await lstat(path);
    if (!fileStat.isSymbolicLink()) {
      return null;
    }
    const target = await readlink(path);
    const resolvedTarget = resolve(dirname(path), target);

    // Check if it points into the dotfiles repo
    if (resolvedTarget.startsWith(dotfilesPath + '/') || resolvedTarget === dotfilesPath) {
      // Check if target actually exists
      const targetExists = await pathExists(resolvedTarget);
      return { sourcePath: resolvedTarget, targetExists };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get the resolved symlink target if path is a symlink pointing into dotfiles repo.
 * Returns the absolute path to the source file in the repo, or null if not a symlink to repo.
 * @deprecated Use checkSymlinkToRepo for more detailed information
 */
async function getSymlinkSourceInRepo(path: string, dotfilesPath: string): Promise<string | null> {
  const result = await checkSymlinkToRepo(path, dotfilesPath);
  return result?.sourcePath ?? null;
}

/**
 * Get the relative path within the dotfiles repo from an absolute path.
 */
function getRelativeRepoPath(absolutePath: string, dotfilesPath: string): string {
  return relative(dotfilesPath, absolutePath);
}

/**
 * Directories to skip when scanning home directory.
 * These are large directories unlikely to contain dotfile symlinks.
 */
const HOME_SKIP_DIRS = new Set([
  // User data directories (large, not config)
  'Downloads', 'Documents', 'Desktop', 'Pictures', 'Music', 'Movies',
  'Public', 'Applications', 'Dropbox', 'Google Drive', 'OneDrive', 'iCloud Drive',
  // Development directories (can be huge)
  'node_modules', '.npm', '.yarn', '.pnpm', '.bun',
  'go', '.cargo', '.rustup', '.gradle', '.m2', '.ivy2',
  '.virtualenvs', '.pyenv', '.rbenv', '.nvm', '.fnm',
  // Cache and temp directories
  '.cache', '.Trash', '.local', 'tmp', 'temp',
  // Version control
  '.git',
  // IDE and editor directories (large, internal state)
  '.vscode-server', '.cursor-server',
  // macOS specific
  'Library', // We'll scan Library/Application Support separately
  // Common large hidden dirs
  '.docker', '.vagrant', '.minikube',
]);

/**
 * Directories to skip when scanning ~/Library/Application Support/
 */
const APP_SUPPORT_SKIP_DIRS = new Set([
  // Large app data directories
  'Steam', 'Epic', 'GOG.com', 'Battle.net',
  'Google', 'Firefox', 'Chromium', 'Microsoft Edge',
  'Slack', 'Discord', 'Spotify', 'zoom.us',
  'Docker Desktop', 'Parallels',
  'MobileSync', 'Application Support', // nested
  'AddressBook', 'Calendars', 'CallHistoryDB',
  'CloudDocs', 'FaceTime', 'Messages',
]);

/**
 * Info about a discovered symlink pointing to the dotfiles repo.
 */
type DiscoveredSymlink = {
  sourcePath: string;    // Path in repo the symlink points to
  targetExists: boolean; // Whether the target actually exists
};

/**
 * Recursively scan a directory for symlinks pointing into the dotfiles repo.
 * Returns a Map of symlink path -> discovered symlink info.
 *
 * @param dir - Directory to scan
 * @param dotfilesPath - Path to dotfiles repo
 * @param maxDepth - Maximum recursion depth
 * @param currentDepth - Current recursion depth
 * @param skipDirs - Set of directory names to skip
 */
async function scanDirectoryForSymlinks(
  dir: string,
  dotfilesPath: string,
  maxDepth: number = 4,
  currentDepth: number = 0,
  skipDirs: Set<string> = new Set()
): Promise<Map<string, DiscoveredSymlink>> {
  const found = new Map<string, DiscoveredSymlink>();

  if (currentDepth >= maxDepth) return found;

  try {
    const entries = await readdir(dir);
    for (const entry of entries) {
      // Skip directories in the skip list
      if (skipDirs.has(entry)) {
        continue;
      }

      const fullPath = `${dir}/${entry}`;
      try {
        const entryStat = await lstat(fullPath);

        if (entryStat.isSymbolicLink()) {
          const result = await checkSymlinkToRepo(fullPath, dotfilesPath);
          if (result) {
            found.set(fullPath, result);
          }
        } else if (entryStat.isDirectory() && !entry.startsWith('.git')) {
          // Recurse into subdirectory (skip .git directories)
          const subFound = await scanDirectoryForSymlinks(
            fullPath,
            dotfilesPath,
            maxDepth,
            currentDepth + 1,
            skipDirs
          );
          for (const [k, v] of subFound) {
            found.set(k, v);
          }
        }
      } catch {
        // Ignore permission errors on individual entries
      }
    }
  } catch {
    // Ignore permission errors on directory
  }

  return found;
}

/**
 * Get suggested repo path for a dotfile.
 * Uses SUGGESTED_PATHS for known files, otherwise generates from name.
 */
function getSuggestedPath(relativePath: string): string {
  // Check for exact match in suggestions
  if (SUGGESTED_PATHS[relativePath]) {
    return SUGGESTED_PATHS[relativePath];
  }

  // For .config/* entries, use the name without .config prefix
  if (relativePath.startsWith('.config/')) {
    return relativePath.slice('.config/'.length);
  }

  // For dotfiles, remove leading dot and use as folder/name
  // e.g., .vimrc -> vim/vimrc, .tmux.conf -> tmux/tmux.conf
  if (relativePath.startsWith('.')) {
    const name = relativePath.slice(1);
    const dotIndex = name.indexOf('.');
    if (dotIndex > 0) {
      // Has extension: .tmux.conf -> tmux/tmux.conf
      const prefix = name.slice(0, dotIndex);
      return `${prefix}/${name}`;
    }
    // No extension: .vimrc -> vim/vimrc
    return `${name.replace('rc', '')}/${name}`;
  }

  return relativePath;
}

/**
 * Get warning for a path if it contains sensitive content.
 */
function getWarning(relativePath: string): string | undefined {
  // Check exact matches
  if (SENSITIVE_PATHS[relativePath]) {
    return SENSITIVE_PATHS[relativePath];
  }
  // Check prefix matches (e.g., .ssh/anything)
  for (const [path, warning] of Object.entries(SENSITIVE_PATHS)) {
    if (relativePath.startsWith(path + '/')) {
      return warning;
    }
  }
  return undefined;
}

/**
 * Scan home directory for ALL dotfiles and ~/.config entries.
 * If dotfilesPath is provided, determines status of each file relative to the repo.
 * Returns array of detected dotfiles with metadata and status.
 *
 * @param extraSkipPatterns Additional patterns to skip (from config)
 */
export async function scanCommonDotfiles(
  home: string,
  dotfilesPath?: string,
  extraSkipPatterns: string[] = []
): Promise<DetectedDotfile[]> {
  const found: DetectedDotfile[] = [];
  const skipHome = new Set([...SKIP_HOME_DOTFILES, ...extraSkipPatterns]);
  const skipConfig = new Set([...SKIP_CONFIG_ENTRIES, ...extraSkipPatterns]);

  // First pass: collect all symlinks pointing to dotfiles repo
  const allDiscoveredSymlinks = new Map<string, DiscoveredSymlink>();

  if (dotfilesPath) {
    // Deep scan home directory for existing symlinks
    const homeSymlinks = await scanDirectoryForSymlinks(
      home,
      dotfilesPath,
      3,
      0,
      HOME_SKIP_DIRS
    );
    for (const [symlinkPath, info] of homeSymlinks) {
      allDiscoveredSymlinks.set(symlinkPath, info);
    }

    // Deep scan ~/.config for existing symlinks
    const configPath = `${home}/.config`;
    const configSymlinks = await scanDirectoryForSymlinks(configPath, dotfilesPath, 4);
    for (const [symlinkPath, info] of configSymlinks) {
      allDiscoveredSymlinks.set(symlinkPath, info);
    }

    // On macOS, also scan ~/Library/Application Support
    if (process.platform === 'darwin') {
      const appSupportPath = `${home}/Library/Application Support`;
      const appSupportSymlinks = await scanDirectoryForSymlinks(
        appSupportPath,
        dotfilesPath,
        4,
        0,
        APP_SUPPORT_SKIP_DIRS
      );
      for (const [symlinkPath, info] of appSupportSymlinks) {
        allDiscoveredSymlinks.set(symlinkPath, info);
      }
    }
  }

  // Build set of paths already linked (to avoid duplicates)
  const alreadyLinkedSources = new Set(
    Array.from(allDiscoveredSymlinks.values())
      .filter(info => info.targetExists)
      .map(info => info.sourcePath)
  );

  // Helper to add a detected file
  const addDetected = async (
    fullPath: string,
    relativePath: string,
    symlinkInfo?: DiscoveredSymlink
  ) => {
    // If it's a symlink to our repo
    if (symlinkInfo) {
      const actualRelativePath = getRelativeRepoPath(symlinkInfo.sourcePath, dotfilesPath!);
      const isDir = symlinkInfo.targetExists ? await isDirectory(symlinkInfo.sourcePath) : false;
      found.push({
        path: fullPath,
        name: relativePath,
        suggested: actualRelativePath,
        sourcePath: symlinkInfo.sourcePath,
        isDirectory: isDir,
        warning: getWarning(relativePath),
        status: symlinkInfo.targetExists ? 'already-linked' : 'broken-link',
      });
      return;
    }

    // Check if file exists in home
    const homeFileExists = await pathExists(fullPath);
    if (!homeFileExists) return;

    const isDir = await isDirectory(fullPath);
    const suggested = getSuggestedPath(relativePath);

    // If we have a dotfiles repo, check status
    if (dotfilesPath) {
      const suggestedSourcePath = resolve(dotfilesPath, suggested);
      const sourceExists = await pathExists(suggestedSourcePath);

      // Skip if already linked from different location
      if (sourceExists && alreadyLinkedSources.has(suggestedSourcePath)) {
        return;
      }

      let status: DotfileStatus;
      if (sourceExists) {
        status = 'conflict';
      } else {
        status = 'available';
      }

      found.push({
        path: fullPath,
        name: relativePath,
        suggested,
        sourcePath: sourceExists ? suggestedSourcePath : undefined,
        isDirectory: isDir,
        warning: getWarning(relativePath),
        status,
      });
    } else {
      found.push({
        path: fullPath,
        name: relativePath,
        suggested,
        isDirectory: isDir,
        warning: getWarning(relativePath),
        status: 'available',
      });
    }
  };

  // Second pass: scan home directory for dotfiles (starting with .)
  try {
    const homeEntries = await readdir(home, { withFileTypes: true });
    for (const entry of homeEntries) {
      // Only look at dotfiles
      if (!entry.name.startsWith('.')) continue;

      // Skip system/cache entries
      if (skipHome.has(entry.name)) continue;

      // Skip .config (we'll scan it separately)
      if (entry.name === '.config') continue;

      const fullPath = resolve(home, entry.name);
      const symlinkInfo = allDiscoveredSymlinks.get(fullPath);

      await addDetected(fullPath, entry.name, symlinkInfo);
    }
  } catch {
    // Ignore permission errors
  }

  // Third pass: scan ~/.config for all entries
  const configPath = `${home}/.config`;
  try {
    const configEntries = await readdir(configPath, { withFileTypes: true });
    for (const entry of configEntries) {
      // Skip system/cache entries
      if (skipConfig.has(entry.name)) continue;

      const fullPath = resolve(configPath, entry.name);
      const relativePath = `.config/${entry.name}`;
      const symlinkInfo = allDiscoveredSymlinks.get(fullPath);

      await addDetected(fullPath, relativePath, symlinkInfo);
    }
  } catch {
    // Ignore if .config doesn't exist or permission error
  }

  // Fourth pass: add discovered symlinks not already added
  // (symlinks in nested locations pointing to our repo)
  if (dotfilesPath) {
    const alreadyAddedPaths = new Set(found.map(f => f.path));

    for (const [symlinkPath, info] of allDiscoveredSymlinks) {
      if (alreadyAddedPaths.has(symlinkPath)) continue;

      const nameRelativeToHome = relative(home, symlinkPath);
      const suggestedRelativeToRepo = getRelativeRepoPath(info.sourcePath, dotfilesPath);
      const isDir = info.targetExists ? await isDirectory(info.sourcePath) : false;

      found.push({
        path: symlinkPath,
        name: nameRelativeToHome,
        suggested: suggestedRelativeToRepo,
        sourcePath: info.sourcePath,
        isDirectory: isDir,
        warning: getWarning(nameRelativeToHome),
        status: info.targetExists ? 'already-linked' : 'broken-link',
      });
    }
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

/**
 * Prompt user to resolve "in-repo but not linked" files.
 * Offers options to continue (files really are unlinked) or manually specify symlink paths.
 * Returns the resolved dotfiles with updated status and sourcePath.
 */
export async function resolveUnlinkedFiles(
  unlinkedFiles: DetectedDotfile[],
  dotfilesPath: string
): Promise<DetectedDotfile[]> {
  if (unlinkedFiles.length === 0) {
    return [];
  }

  const result = await p.select({
    message: 'Some files appear unlinked. Options:',
    options: [
      { value: 'continue', label: 'Continue', hint: 'these really are not linked yet' },
      { value: 'manual', label: 'Add manual paths', hint: 'I have symlinks in other locations' },
    ],
  });

  checkCancel(result);

  if (result === 'continue') {
    return unlinkedFiles;
  }

  // Manual mode: let user specify symlink path for each file
  const resolved: DetectedDotfile[] = [];

  for (const df of unlinkedFiles) {
    const expectedSource = `${dotfilesPath}/${df.suggested}`;

    p.log.info(`File: ${df.suggested}`);
    console.log(`  Expected to link to: ${df.name}`);

    const pathResult = await p.text({
      message: `Symlink path (or press Enter to skip):`,
      placeholder: '~/.config/...',
      validate: async (value) => {
        if (!value || !value.trim()) {
          return undefined; // Allow empty to skip
        }

        // Expand ~ and resolve path
        const expandedPath = expandPath(value.trim());

        // Check if it exists
        try {
          const pathStat = await lstat(expandedPath);
          if (!pathStat.isSymbolicLink()) {
            return 'Path exists but is not a symlink';
          }

          // Check if it points to the expected source
          const target = await readlink(expandedPath);
          const resolvedTarget = resolve(dirname(expandedPath), target);
          if (resolvedTarget !== expectedSource) {
            return `Symlink points to ${resolvedTarget}, expected ${expectedSource}`;
          }

          return undefined; // Valid
        } catch {
          return 'Path does not exist';
        }
      },
    });

    checkCancel(pathResult);

    const pathValue = (pathResult as string)?.trim();

    if (!pathValue) {
      // User skipped - keep as in-repo
      resolved.push(df);
    } else {
      // User provided valid symlink path - mark as already-linked
      const expandedPath = expandPath(pathValue);
      resolved.push({
        ...df,
        path: expandedPath,
        sourcePath: expectedSource,
        status: 'already-linked',
      });
      p.log.success(`Linked: ${df.suggested} <- ${formatPath(expandedPath)}`);
    }
  }

  return resolved;
}

/**
 * Scan dotfiles repo for files not covered by COMMON_DOTFILES.
 * Returns a list of unknown repo files that could be linked.
 */
export async function scanUnknownRepoFiles(
  dotfilesPath: string,
  knownSources: Set<string>
): Promise<Array<{ repoPath: string; relativePath: string }>> {
  const unknownFiles: Array<{ repoPath: string; relativePath: string }> = [];

  // Directories to skip in the dotfiles repo
  const skipDirs = new Set(['.git', 'node_modules', '.planning', '.claude']);

  async function scanDir(dirPath: string, depth: number = 0): Promise<void> {
    if (depth > 3) return; // Limit depth

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = resolve(dirPath, entry.name);
        const relativePath = relative(dotfilesPath, fullPath);

        // Skip hidden files at root level (like .git, .gitignore)
        if (depth === 0 && entry.name.startsWith('.')) {
          continue;
        }

        // Skip known directories
        if (entry.isDirectory() && skipDirs.has(entry.name)) {
          continue;
        }

        // Skip dot.config.json and similar config files
        if (entry.name === 'dot.config.json' || entry.name === 'dot.config.ts') {
          continue;
        }

        // Skip if this source is already known
        if (knownSources.has(fullPath) || knownSources.has(relativePath)) {
          continue;
        }

        if (entry.isDirectory()) {
          // Recurse into directories
          await scanDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          // Skip common non-config files
          if (entry.name.endsWith('.md') || entry.name === 'README' ||
              entry.name === 'LICENSE' || entry.name === 'package.json' ||
              entry.name === 'package-lock.json' || entry.name === 'bun.lockb' ||
              entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) {
            continue;
          }

          unknownFiles.push({ repoPath: fullPath, relativePath });
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  await scanDir(dotfilesPath);
  return unknownFiles;
}

/**
 * Let user specify link targets for unknown repo files.
 * Returns a list of DetectedDotfile entries for files user wants to link.
 */
export async function configureUnknownFiles(
  unknownFiles: Array<{ repoPath: string; relativePath: string }>,
  dotfilesPath: string
): Promise<DetectedDotfile[]> {
  if (unknownFiles.length === 0) {
    return [];
  }

  p.log.info(`Found ${unknownFiles.length} file(s) in repo not in common dotfiles list:`);
  for (const file of unknownFiles.slice(0, 10)) {
    console.log(`  ${file.relativePath}`);
  }
  if (unknownFiles.length > 10) {
    console.log(`  ... and ${unknownFiles.length - 10} more`);
  }
  console.log('');

  const result = await p.select({
    message: 'Would you like to configure symlinks for these files?',
    options: [
      { value: 'skip', label: 'Skip all', hint: 'use "dot track" later' },
      { value: 'configure', label: 'Configure some', hint: 'choose which files to link' },
    ],
  });

  checkCancel(result);

  if (result === 'skip') {
    return [];
  }

  // Let user select which files to configure
  const selectableFiles = unknownFiles.map(file => ({
    value: file,
    label: file.relativePath,
    hint: inferLinkTarget(file.relativePath),
  }));

  const selectedResult = await p.multiselect({
    message: 'Select files to configure (space to toggle, enter to confirm):',
    options: selectableFiles,
    required: false,
  });

  checkCancel(selectedResult);

  const selectedFiles = selectedResult as Array<{ repoPath: string; relativePath: string }>;

  if (selectedFiles.length === 0) {
    p.log.info('No files selected');
    return [];
  }

  // Configure only selected files
  const configured: DetectedDotfile[] = [];
  const home = process.env.HOME ?? '';

  for (const file of selectedFiles) {
    const suggestedTarget = inferLinkTarget(file.relativePath);

    const pathResult = await p.text({
      message: `${file.relativePath} - link to:`,
      placeholder: suggestedTarget,
      defaultValue: suggestedTarget,
    });

    checkCancel(pathResult);

    const pathValue = (pathResult as string)?.trim();

    if (!pathValue) {
      continue;
    }

    // Expand ~ and resolve
    const targetPath = expandPath(pathValue);

    configured.push({
      path: targetPath,
      name: relative(home, targetPath),
      suggested: file.relativePath,
      sourcePath: file.repoPath,
      isDirectory: false,
      status: 'in-repo',
    });

    p.log.success(`  ${file.relativePath} -> ${formatPath(targetPath)}`);
  }

  return configured;
}

/**
 * Infer a reasonable link target based on repo file path.
 * e.g., "nvim/init.lua" -> "~/.config/nvim/init.lua"
 *       "zsh/aliases" -> "~/.config/zsh/aliases"
 */
function inferLinkTarget(repoPath: string): string {
  // Common patterns
  const configDirFiles = ['nvim', 'alacritty', 'kitty', 'wezterm', 'helix', 'karabiner'];
  const parts = repoPath.split('/');
  const firstDir = parts[0];

  // If first directory is a known config app, suggest ~/.config/...
  if (firstDir && configDirFiles.includes(firstDir)) {
    return `~/.config/${repoPath}`;
  }

  // If it looks like a shell config, suggest home directory
  if (firstDir === 'zsh' || firstDir === 'bash') {
    return `~/.config/${repoPath}`;
  }

  // Default: suggest ~/.config/path
  return `~/.config/${repoPath}`;
}
