import * as p from '@clack/prompts';
import pc from 'picocolors';
import { createTwoFilesPatch } from 'diff';
import { stat, lstat, readdir, mkdir, readlink } from 'node:fs/promises';
import { resolve, dirname, basename, relative } from 'node:path';
import type { LinkMap, CustomPatterns } from './types';

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
  fileCount?: number;     // For directories: number of files inside
  warning?: string;       // Warning message (e.g., for .ssh/config)
  status?: DotfileStatus; // Status relative to dotfiles repo
  annotation?: string;    // Annotation for low-value files (e.g., "cache file", "history")
  isLowValue?: boolean;   // Flag for grouping (low-value files shown separately)
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
 * Directories to filter from directory browser.
 * These appear as disabled (greyed out) with explanatory hint.
 */
const FILTERED_DIRS = new Set([
  // System directories
  'tmp', 'var', 'private', 'System', 'Volumes',
  // Common caches
  'node_modules', '.git', '.svn', '.hg',
  'Library', // On macOS, too large/not useful
  '__pycache__', '.pytest_cache', '.mypy_cache',
  'target', // Rust/Maven
  'build', 'dist', '.next', '.nuxt',
  // Package manager caches
  '.npm', '.yarn', '.pnpm', '.bun',
]);

/**
 * Default patterns for low-value dotfiles (caches, temp, history).
 * These are shown in "Other files" section with annotation.
 */
const DEFAULT_LOW_VALUE_PATTERNS = [
  // Exact matches
  '.DS_Store', '.localized', 'Thumbs.db', 'desktop.ini',
  '.CFUserTextEncoding',
  // History files
  '.zsh_history', '.bash_history', '.node_repl_history', '.python_history',
  '.lesshst', '.wget-hsts',
  // Sessions
  '.zsh_sessions', '.bash_sessions',
  // Caches
  '.cache', '.tmp',
];

/**
 * Pattern suffixes for low-value files.
 */
const LOW_VALUE_SUFFIXES = ['_history', '.log', '.bak', '.swp', '.swo'];

/**
 * Check if a filename matches low-value patterns.
 * Accepts optional custom patterns from config.
 */
export function isLowValueFile(
  name: string,
  customPatterns?: CustomPatterns
): boolean {
  // High-value overrides take priority
  if (customPatterns?.highValue?.includes(name)) return false;

  // Check custom low-value patterns
  if (customPatterns?.lowValue?.includes(name)) return true;

  // Check default patterns
  if (DEFAULT_LOW_VALUE_PATTERNS.includes(name)) return true;

  return LOW_VALUE_SUFFIXES.some(suffix => name.endsWith(suffix));
}

/**
 * Get annotation for a low-value file based on its name.
 */
export function getLowValueAnnotation(name: string): string {
  if (name.includes('history') || name.endsWith('_history')) return 'history file';
  if (name.includes('cache') || name === '.cache') return 'cache';
  if (name === '.DS_Store' || name === 'Thumbs.db' || name === 'desktop.ini') return 'system file';
  if (name === '.localized' || name === '.CFUserTextEncoding') return 'system file';
  if (name.endsWith('.log')) return 'log file';
  if (name.endsWith('.bak') || name.endsWith('.swp') || name.endsWith('.swo')) return 'backup/swap file';
  if (name.includes('session')) return 'session data';
  return 'temp/cache';
}

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
 * Count files in a directory (non-recursive, excludes hidden).
 */
async function countFiles(dirPath: string): Promise<number> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.filter(e => !e.name.startsWith('.')).length;
  } catch {
    return 0;
  }
}

/**
 * List files in a directory for drill-down selection.
 * Returns DetectedDotfile entries for each file/subfolder.
 */
export async function listDirectoryContents(
  dirPath: string,
  relativeName: string,
  suggestedBase: string
): Promise<DetectedDotfile[]> {
  const results: DetectedDotfile[] = [];
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      // Skip hidden files in drill-down
      if (entry.name.startsWith('.')) continue;

      const fullPath = resolve(dirPath, entry.name);
      const name = `${relativeName}/${entry.name}`;
      const suggested = `${suggestedBase}/${entry.name}`;
      const isDir = entry.isDirectory();

      let fileCount: number | undefined;
      if (isDir) {
        fileCount = await countFiles(fullPath);
      }

      results.push({
        path: fullPath,
        name,
        suggested,
        isDirectory: isDir,
        fileCount,
        status: 'available',
      });
    }
  } catch {
    // Ignore errors
  }
  return results;
}

/**
 * Recursively get all files in a directory (not folders, just files).
 * Used when user wants to symlink all files individually instead of the folder.
 */
export async function getAllFilesRecursively(
  dirPath: string,
  relativeName: string,
  suggestedBase: string
): Promise<DetectedDotfile[]> {
  const results: DetectedDotfile[] = [];

  async function recurse(currentPath: string, currentName: string, currentSuggested: string) {
    try {
      const entries = await readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;

        const fullPath = resolve(currentPath, entry.name);
        const name = `${currentName}/${entry.name}`;
        const suggested = `${currentSuggested}/${entry.name}`;

        if (entry.isDirectory()) {
          // Recurse into subdirectory
          await recurse(fullPath, name, suggested);
        } else {
          // Add file
          results.push({
            path: fullPath,
            name,
            suggested,
            isDirectory: false,
            status: 'available',
          });
        }
      }
    } catch {
      // Ignore errors
    }
  }

  await recurse(dirPath, relativeName, suggestedBase);
  return results;
}

/**
 * Print directory contents in tree format.
 */
export function printTree(items: DetectedDotfile[], indent = ''): void {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const isLast = i === items.length - 1;
    const prefix = isLast ? '└── ' : '├── ';
    const name = item.name.split('/').pop()!;

    if (item.isDirectory) {
      console.log(`${indent}${prefix}${name}/ (${item.fileCount ?? 0} items)`);
    } else {
      console.log(`${indent}${prefix}${name}`);
    }
  }
}

/**
 * Count how many items would be displayed at a given depth.
 * Used to determine optimal tree depth.
 */
async function countTreeItems(
  dirPath: string,
  maxDepth: number,
  currentDepth = 0
): Promise<number> {
  if (currentDepth >= maxDepth) return 0;

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const filtered = entries.filter(e => !e.name.startsWith('.'));
    let count = filtered.length;

    for (const entry of filtered) {
      if (entry.isDirectory() && !FILTERED_DIRS.has(entry.name)) {
        const subPath = resolve(dirPath, entry.name);
        count += await countTreeItems(subPath, maxDepth, currentDepth + 1);
      }
    }

    return count;
  } catch {
    return 0;
  }
}

/**
 * Find optimal depth that keeps total items under threshold.
 */
async function findOptimalDepth(
  dirPath: string,
  maxItems = 25,
  maxDepth = 5
): Promise<number> {
  for (let depth = 1; depth <= maxDepth; depth++) {
    const count = await countTreeItems(dirPath, depth);
    if (count > maxItems) {
      return Math.max(1, depth - 1);
    }
  }
  return maxDepth;
}

/**
 * Print nested directory contents in tree format.
 * Automatically determines depth to keep total items under threshold.
 */
export async function printTreeRecursive(
  dirPath: string,
  indent = '',
  maxDepth?: number,
  currentDepth = 0
): Promise<void> {
  // On first call, determine optimal depth if not specified
  if (currentDepth === 0 && maxDepth === undefined) {
    maxDepth = await findOptimalDepth(dirPath);
  }
  maxDepth = maxDepth ?? 3;

  if (currentDepth >= maxDepth) {
    return;
  }

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const filtered = entries.filter(e => !e.name.startsWith('.'));

    for (let i = 0; i < filtered.length; i++) {
      const entry = filtered[i]!;
      const isLast = i === filtered.length - 1;
      const prefix = isLast ? '└── ' : '├── ';
      const childIndent = indent + (isLast ? '    ' : '│   ');

      if (entry.isDirectory()) {
        const subPath = resolve(dirPath, entry.name);
        const subEntries = await readdir(subPath).catch(() => []);
        const count = subEntries.filter(e => !e.startsWith('.')).length;
        const hasMore = currentDepth + 1 >= maxDepth && count > 0;
        console.log(`${indent}${prefix}${entry.name}/${hasMore ? ` (${count} items)` : ''}`);
        // Don't recurse into filtered directories (tmp, node_modules, etc.)
        if (!FILTERED_DIRS.has(entry.name)) {
          await printTreeRecursive(subPath, childIndent, maxDepth, currentDepth + 1);
        }
      } else {
        console.log(`${indent}${prefix}${entry.name}`);
      }
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Interactive file/directory browser for selecting a path.
 * Can select both files and directories.
 * Returns the selected absolute path.
 * Filtered directories (system/cache) appear greyed out with confirmation required.
 */
export async function browseForPath(startPath: string): Promise<string> {
  let currentPath = startPath;

  while (true) {
    let entries: Array<{ name: string; isDir: boolean }> = [];
    try {
      const dirEntries = await readdir(currentPath, { withFileTypes: true });
      entries = dirEntries
        .map(e => ({ name: e.name, isDir: e.isDirectory() }))
        .sort((a, b) => {
          // Directories first, then files, both alphabetically
          if (a.isDir && !b.isDir) return -1;
          if (!a.isDir && b.isDir) return 1;
          // Hidden items after visible ones
          const aHidden = a.name.startsWith('.');
          const bHidden = b.name.startsWith('.');
          if (aHidden && !bHidden) return 1;
          if (!aHidden && bHidden) return -1;
          // Filtered directories last among dirs
          const aFiltered = FILTERED_DIRS.has(a.name);
          const bFiltered = FILTERED_DIRS.has(b.name);
          if (aFiltered && !bFiltered) return 1;
          if (!aFiltered && bFiltered) return -1;
          return a.name.localeCompare(b.name);
        });
    } catch {
      entries = [];
    }

    const parentPath = dirname(currentPath);
    const canGoUp = parentPath !== currentPath;

    // Build options
    const options: Array<{ value: string; label: string; hint?: string }> = [
      { value: '__select__', label: '✓ Select this directory', hint: formatPath(currentPath) },
    ];

    if (canGoUp) {
      options.push({ value: '__up__', label: '..', hint: 'go up' });
    }

    // Add entries (directories and files)
    for (const entry of entries) {
      const isHidden = entry.name.startsWith('.');
      const isFiltered = entry.isDir && FILTERED_DIRS.has(entry.name);

      if (entry.isDir) {
        if (isFiltered) {
          // Show filtered directories as dimmed with explanatory hint
          options.push({
            value: `dir:${entry.name}`,
            label: pc.dim(`${entry.name}/`),
            hint: pc.dim('skipped (system/cache)'),
          });
        } else {
          options.push({
            value: `dir:${entry.name}`,
            label: entry.name + '/',
            hint: isHidden ? 'hidden' : undefined,
          });
        }
      } else {
        options.push({
          value: `file:${entry.name}`,
          label: entry.name,
          hint: isHidden ? 'hidden' : 'select this file',
        });
      }
    }

    const result = await p.select({
      message: `Browse: ${currentPath}`,
      options,
    });

    checkCancel(result);

    if (result === '__select__') {
      return currentPath;
    }

    if (result === '__up__') {
      currentPath = parentPath;
      continue;
    }

    const selected = result as string;
    if (selected.startsWith('file:')) {
      // Return the selected file
      return resolve(currentPath, selected.slice(5));
    }

    if (selected.startsWith('dir:')) {
      const dirName = selected.slice(4);

      // Check if this is a filtered directory - require confirmation
      if (FILTERED_DIRS.has(dirName)) {
        const override = await p.confirm({
          message: `${dirName} is typically skipped (cache/system dir). Include anyway?`,
          initialValue: false,
        });
        if (p.isCancel(override) || !override) {
          continue; // Stay in current directory
        }
      }

      // Navigate into directory
      currentPath = resolve(currentPath, dirName);
    }
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
 * Filtered directories (system/cache) appear greyed out with confirmation required.
 */
async function browseDirectory(startPath: string): Promise<string> {
  let currentPath = startPath;

  while (true) {
    const subdirs = await getSubdirectories(currentPath);
    const parentPath = dirname(currentPath);
    const canGoUp = parentPath !== currentPath; // Not at root

    // Sort subdirs: non-filtered first, then filtered, both alphabetically
    const sortedSubdirs = [...subdirs].sort((a, b) => {
      const aFiltered = FILTERED_DIRS.has(a);
      const bFiltered = FILTERED_DIRS.has(b);
      if (aFiltered && !bFiltered) return 1;
      if (!aFiltered && bFiltered) return -1;
      return a.localeCompare(b);
    });

    // Build options - navigation first, then selection
    const options: Array<{ value: string; label: string; hint?: string }> = [];

    if (canGoUp) {
      options.push({ value: '__up__', label: '..', hint: 'go up' });
    }

    // Add subdirectories with filtering visual indication
    for (const dir of sortedSubdirs) {
      const isHidden = dir.startsWith('.');
      const isFiltered = FILTERED_DIRS.has(dir);

      if (isFiltered) {
        options.push({
          value: dir,
          label: pc.dim(`${dir}/`),
          hint: pc.dim('skipped (system/cache)'),
        });
      } else {
        options.push({
          value: dir,
          label: dir + '/',
          hint: isHidden ? 'hidden' : undefined,
        });
      }
    }

    // Selection options at the bottom
    const folderName = basename(currentPath) || 'root';
    options.push({ value: '__select__', label: `✓ Select "${folderName}"`, hint: 'use this folder' });
    options.push({ value: '__create__', label: '+ Create new folder here' });

    const result = await p.select({
      message: `Browse: ${currentPath}`,
      options,
    });

    checkCancel(result);

    if (result === '__select__') {
      return currentPath;
    }

    if (result === '__create__') {
      const newFolderName = await p.text({
        message: 'New folder name:',
        placeholder: 'my-dotfiles',
        validate: (value) => {
          if (!value || !value.trim()) return 'Folder name is required';
          if (value.includes('/')) return 'Folder name cannot contain /';
          return undefined;
        },
      });

      checkCancel(newFolderName);

      const newPath = resolve(currentPath, newFolderName as string);

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

    // Check if this is a filtered directory - require confirmation
    const selectedDir = result as string;
    if (FILTERED_DIRS.has(selectedDir)) {
      const override = await p.confirm({
        message: `${selectedDir} is typically skipped (cache/system dir). Include anyway?`,
        initialValue: false,
      });
      if (p.isCancel(override) || !override) {
        continue; // Stay in current directory
      }
    }

    // Navigate into selected directory
    currentPath = resolve(currentPath, selectedDir);
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

  // First ask if they have an existing repo
  const hasExisting = await p.select({
    message: 'Do you have an existing dotfiles repo?',
    options: [
      { value: 'yes', label: 'Yes, use my existing dotfiles', hint: 'browse to find it' },
      { value: 'no', label: 'No, create a new one', hint: 'start fresh' },
    ],
  });

  checkCancel(hasExisting);

  if (hasExisting === 'yes') {
    // Check if default location exists
    const defaultExists = await pathExists(defaultPath);

    if (defaultExists) {
      const useDefault = await p.select({
        message: 'Where is your dotfiles repo?',
        options: [
          { value: 'default', label: defaultPath, hint: 'found existing folder' },
          { value: 'browse', label: 'Somewhere else', hint: 'browse to find it' },
        ],
      });

      checkCancel(useDefault);

      if (useDefault === 'default') {
        return defaultPath;
      }
    }

    p.log.info('Browse to your existing dotfiles folder');
    return browseDirectory(home);
  }

  // Create new - ask where
  const location = await p.select({
    message: 'Where should the new dotfiles repo be created?',
    options: [
      { value: 'default', label: defaultPath, hint: 'recommended' },
      { value: 'browse', label: 'Choose a different location', hint: 'browse or create folder' },
    ],
  });

  checkCancel(location);

  if (location === 'browse') {
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
 * @param customPatterns Optional custom patterns for low-value/high-value classification
 */
export async function scanCommonDotfiles(
  home: string,
  dotfilesPath?: string,
  extraSkipPatterns: string[] = [],
  customPatterns?: CustomPatterns
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

  // Helper to add a detected file with low-value annotation
  const addDetected = async (
    fullPath: string,
    relativePath: string,
    symlinkInfo?: DiscoveredSymlink
  ) => {
    // Check if this is a low-value file (for annotation)
    const fileName = basename(relativePath);
    const lowValue = isLowValueFile(fileName, customPatterns);
    const annotation = lowValue ? getLowValueAnnotation(fileName) : undefined;

    // If it's a symlink to our repo
    if (symlinkInfo) {
      const actualRelativePath = getRelativeRepoPath(symlinkInfo.sourcePath, dotfilesPath!);
      const isDir = symlinkInfo.targetExists ? await isDirectory(symlinkInfo.sourcePath) : false;
      const fileCount = isDir ? await countFiles(symlinkInfo.sourcePath) : undefined;
      found.push({
        path: fullPath,
        name: relativePath,
        suggested: actualRelativePath,
        sourcePath: symlinkInfo.sourcePath,
        isDirectory: isDir,
        fileCount,
        warning: getWarning(relativePath),
        status: symlinkInfo.targetExists ? 'already-linked' : 'broken-link',
        annotation,
        isLowValue: lowValue,
      });
      return;
    }

    // Check if file exists in home
    const homeFileExists = await pathExists(fullPath);
    if (!homeFileExists) return;

    const isDir = await isDirectory(fullPath);
    const fileCount = isDir ? await countFiles(fullPath) : undefined;
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
        fileCount,
        warning: getWarning(relativePath),
        status,
        annotation,
        isLowValue: lowValue,
      });
    } else {
      found.push({
        path: fullPath,
        name: relativePath,
        suggested,
        isDirectory: isDir,
        fileCount,
        warning: getWarning(relativePath),
        status: 'available',
        annotation,
        isLowValue: lowValue,
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

      // Skip the dotfiles repo itself
      if (dotfilesPath && fullPath === dotfilesPath) continue;

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
      const fileName = basename(nameRelativeToHome);
      const lowValue = isLowValueFile(fileName, customPatterns);
      const annotation = lowValue ? getLowValueAnnotation(fileName) : undefined;

      found.push({
        path: symlinkPath,
        name: nameRelativeToHome,
        suggested: suggestedRelativeToRepo,
        sourcePath: info.sourcePath,
        isDirectory: isDir,
        warning: getWarning(nameRelativeToHome),
        status: info.targetExists ? 'already-linked' : 'broken-link',
        annotation,
        isLowValue: lowValue,
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
 * Symlink status for preview display.
 */
export type SymlinkPreviewStatus =
  | 'new'           // Target doesn't exist, source exists
  | 'will-create'   // Neither target nor source exist yet
  | 'already-linked' // Symlink pointing to correct source
  | 'wrong-target'  // Symlink pointing elsewhere
  | 'conflict';     // Real file exists at target

/**
 * Result of symlink preview.
 */
export type PreviewResult = {
  safe: boolean;
  hasConflicts: boolean;
  hasWrongTargets: boolean;
  items: Array<{
    source: string;
    target: string;
    status: SymlinkPreviewStatus;
    actualTarget?: string; // For wrong-target: where it actually points
  }>;
};

/**
 * Preview symlinks that will be created.
 * Shows source -> target with status indicators, grouped by action type.
 * Returns detailed preview result including status of each symlink.
 */
export async function previewSymlinks(
  links: LinkMap,
  dotfilesPath: string,
  options?: { colored?: boolean }
): Promise<PreviewResult> {
  const useColor = options?.colored ?? true;

  // Group items by status
  const groups = {
    new: [] as Array<{ source: string; target: string }>,
    willCreate: [] as Array<{ source: string; target: string }>,
    alreadyLinked: [] as Array<{ source: string; target: string }>,
    wrongTarget: [] as Array<{ source: string; target: string; actual: string }>,
    conflict: [] as Array<{ source: string; target: string }>,
  };

  const items: PreviewResult['items'] = [];

  // First pass: categorize all links
  for (const [source, target] of Object.entries(links)) {
    const expandedTarget = expandPath(target);

    // Check if source exists in dotfiles
    const sourceExists = await pathExists(source);

    // Check if target already exists
    const targetExists = await pathExists(expandedTarget);

    let status: SymlinkPreviewStatus;
    let actualTarget: string | undefined;

    if (!sourceExists) {
      status = 'will-create';
      groups.willCreate.push({ source, target });
    } else if (!targetExists) {
      status = 'new';
      groups.new.push({ source, target });
    } else {
      // Target exists - check if it's a symlink and where it points
      try {
        const targetStat = await lstat(expandedTarget);
        if (targetStat.isSymbolicLink()) {
          // Read where the symlink actually points
          const linkTarget = await readlink(expandedTarget);
          const resolvedTarget = resolve(dirname(expandedTarget), linkTarget);

          // Compare resolved target with expected source (both absolute)
          const absoluteSource = resolve(dotfilesPath, source);
          if (resolvedTarget === absoluteSource) {
            status = 'already-linked';
            groups.alreadyLinked.push({ source, target });
          } else {
            status = 'wrong-target';
            actualTarget = resolvedTarget;
            groups.wrongTarget.push({ source, target, actual: resolvedTarget });
          }
        } else {
          status = 'conflict';
          groups.conflict.push({ source, target });
        }
      } catch {
        status = 'conflict';
        groups.conflict.push({ source, target });
      }
    }

    items.push({ source, target, status, actualTarget });
  }

  // Helper to get display source (relative to dotfiles)
  const getDisplaySource = (source: string) =>
    source.startsWith(dotfilesPath) ? source.slice(dotfilesPath.length + 1) : source;

  // Display grouped output
  console.log('\nSymlink preview:');
  console.log('================\n');

  // New symlinks (green)
  if (groups.new.length > 0 || groups.willCreate.length > 0) {
    console.log(useColor ? pc.green('New symlinks:') : 'New symlinks:');
    for (const item of [...groups.new, ...groups.willCreate]) {
      const displaySource = getDisplaySource(item.source);
      console.log(useColor
        ? `  ${pc.green('+')} ${displaySource} -> ${item.target}`
        : `  [new] ${displaySource} -> ${item.target}`
      );
    }
    console.log('');
  }

  // Already linked (dim)
  if (groups.alreadyLinked.length > 0) {
    console.log(useColor ? pc.dim('Already linked:') : 'Already linked:');
    for (const item of groups.alreadyLinked) {
      const displaySource = getDisplaySource(item.source);
      console.log(useColor
        ? `  ${pc.dim('=')} ${pc.dim(displaySource)}`
        : `  [ok] ${displaySource}`
      );
    }
    console.log('');
  }

  // Wrong target (yellow)
  if (groups.wrongTarget.length > 0) {
    console.log(useColor ? pc.yellow('Would replace (wrong target):') : 'Would replace:');
    for (const item of groups.wrongTarget) {
      const displaySource = getDisplaySource(item.source);
      const displayActual = item.actual.startsWith(dotfilesPath)
        ? item.actual.slice(dotfilesPath.length + 1)
        : item.actual;
      console.log(useColor
        ? `  ${pc.yellow('~')} ${displaySource} (currently -> ${displayActual})`
        : `  [replace] ${displaySource} (currently -> ${displayActual})`
      );
    }
    console.log('');
  }

  // Conflicts (red)
  if (groups.conflict.length > 0) {
    console.log(useColor ? pc.red('Conflicts (file exists, not symlink):') : 'Conflicts:');
    for (const item of groups.conflict) {
      const displaySource = getDisplaySource(item.source);
      console.log(useColor
        ? `  ${pc.red('!')} ${displaySource} at ${item.target}`
        : `  [conflict] ${displaySource} at ${item.target}`
      );
    }
    console.log('');
  }

  const hasConflicts = groups.conflict.length > 0;
  const hasWrongTargets = groups.wrongTarget.length > 0;

  if (hasConflicts) {
    console.log(useColor
      ? pc.red('Warning: Some targets already exist and are not symlinks.')
      : 'Warning: Some targets already exist and are not symlinks.'
    );
    console.log('Use --force to overwrite, or move/remove them first.\n');
  }

  if (hasWrongTargets) {
    console.log(useColor
      ? pc.yellow('Note: Some symlinks point to different targets.')
      : 'Note: Some symlinks point to different targets.'
    );
    console.log('Use --force to update them to the correct targets.\n');
  }

  return { safe: !hasConflicts && !hasWrongTargets, hasConflicts, hasWrongTargets, items };
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
 * Maps source (relative to dotfiles repo) to target (with ~ for home).
 * Using relative paths ensures portability across machines and `dot move --self`.
 */
export function buildLinksFromDotfiles(
  dotfiles: DetectedDotfile[],
  dotfilesPath: string
): LinkMap {
  const links: LinkMap = {};
  const home = process.env.HOME ?? '';

  for (const df of dotfiles) {
    // Store source RELATIVE to dotfiles root for portability
    // e.g., "zsh/zshrc" not "/Users/brendon/.dotfiles/zsh/zshrc"
    const source = df.sourcePath
      ? relative(dotfilesPath, df.sourcePath)
      : df.suggested;

    // Store target with ~ for home directory portability
    // e.g., "~/.config/zsh/.zshrc" not "/Users/brendon/.config/zsh/.zshrc"
    const target = df.path.startsWith(home)
      ? '~' + df.path.slice(home.length)
      : df.path;

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

    // Loop until valid input or skip
    let validPath: string | null = null;
    while (validPath === null) {
      const pathResult = await p.text({
        message: `Symlink path (or press Enter to skip):`,
        placeholder: '~/.config/...',
      });

      checkCancel(pathResult);

      const pathValue = (pathResult as string)?.trim();

      if (!pathValue) {
        // User skipped - keep as in-repo
        resolved.push(df);
        break;
      }

      // Expand ~ and resolve path
      const expandedPath = expandPath(pathValue);

      // Check if it exists and is valid
      try {
        const pathStat = await lstat(expandedPath);
        if (!pathStat.isSymbolicLink()) {
          p.log.error('Path exists but is not a symlink');
          continue;
        }

        // Check if it points to the expected source
        const target = await readlink(expandedPath);
        const resolvedTarget = resolve(dirname(expandedPath), target);
        if (resolvedTarget !== expectedSource) {
          p.log.error(`Symlink points to ${resolvedTarget}, expected ${expectedSource}`);
          continue;
        }

        // Valid - mark as already-linked
        validPath = expandedPath;
        resolved.push({
          ...df,
          path: expandedPath,
          sourcePath: expectedSource,
          status: 'already-linked',
        });
        p.log.success(`Linked: ${df.suggested} <- ${formatPath(expandedPath)}`);
      } catch {
        p.log.error('Path does not exist');
        continue;
      }
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

/**
 * Result of conflict resolution for a single file.
 */
export type ConflictResolution =
  | { action: 'backup'; backupPath: string }
  | { action: 'skip' }
  | { action: 'merge'; markerPath: string };

/**
 * Display diff between existing file and dotfiles source.
 */
async function showDiff(existingFile: string, sourceFile: string): Promise<void> {
  try {
    const existingContent = await Bun.file(existingFile).text();
    const sourceContent = await Bun.file(sourceFile).text();

    const patch = createTwoFilesPatch(
      'existing',
      'dotfiles',
      existingContent,
      sourceContent,
      'Current file',
      'From dotfiles repo'
    );

    console.log('\n' + pc.dim('-'.repeat(60)));
    console.log(pc.bold('Diff:'));
    // Color the diff output
    for (const line of patch.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        console.log(pc.green(line));
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        console.log(pc.red(line));
      } else if (line.startsWith('@@')) {
        console.log(pc.cyan(line));
      } else {
        console.log(line);
      }
    }
    console.log(pc.dim('-'.repeat(60)) + '\n');
  } catch (error) {
    p.log.error(`Could not read files for diff: ${error}`);
  }
}

/**
 * Create merge conflict markers in a .conflict file.
 * Returns the path for user to manually resolve.
 */
async function createMergeMarkers(
  existingFile: string,
  sourceFile: string
): Promise<ConflictResolution> {
  try {
    const existingContent = await Bun.file(existingFile).text();
    const sourceContent = await Bun.file(sourceFile).text();

    const mergedContent = `<<<<<<< EXISTING (${existingFile})
${existingContent}=======
${sourceContent}>>>>>>> DOTFILES (${sourceFile})
`;

    // Write merged content with .conflict extension
    const conflictPath = `${existingFile}.conflict`;
    await Bun.write(conflictPath, mergedContent);

    p.log.info(`Created ${conflictPath}`);
    p.log.info('Edit this file to resolve conflicts, then rename to replace original.');

    return { action: 'merge', markerPath: conflictPath };
  } catch (error) {
    p.log.error(`Could not create merge markers: ${error}`);
    return { action: 'skip' };
  }
}

/**
 * Resolve a single file conflict interactively.
 * Offers 4 options per CONTEXT.md decisions:
 * 1. Backup and replace
 * 2. Show diff first (then choose)
 * 3. Create merge conflict markers
 * 4. Skip this file
 *
 * No "apply to all" - each conflict handled individually.
 */
export async function resolveConflict(
  existingFile: string,
  sourceFile: string,
  dotfilesPath: string
): Promise<ConflictResolution> {
  const displayPath = existingFile.replace(process.env.HOME ?? '', '~');
  const displaySource = sourceFile.startsWith(dotfilesPath)
    ? sourceFile.slice(dotfilesPath.length + 1)
    : sourceFile;

  p.log.warn(`Conflict: ${displayPath}`);
  p.log.info(`  Dotfiles has: ${displaySource}`);
  p.log.info(`  But file already exists (not a symlink)`);

  const choice = await p.select({
    message: `How would you like to resolve ${displayPath}?`,
    options: [
      {
        value: 'backup',
        label: 'Backup and replace',
        hint: 'Move existing file to .backup, create symlink',
      },
      {
        value: 'diff',
        label: 'Show diff first',
        hint: 'See differences, then choose',
      },
      {
        value: 'merge',
        label: 'Create merge markers',
        hint: 'Add git-style conflict markers for manual resolution',
      },
      {
        value: 'skip',
        label: 'Skip this file',
        hint: 'Leave existing file, don\'t create symlink',
      },
    ],
  });

  if (p.isCancel(choice)) {
    return { action: 'skip' };
  }

  if (choice === 'backup') {
    // Create backup with timestamp to avoid collisions
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = `${existingFile}.backup-${timestamp}`;
    return { action: 'backup', backupPath };
  }

  if (choice === 'diff') {
    // Show diff and re-prompt
    await showDiff(existingFile, sourceFile);
    // After viewing diff, offer simplified choice
    const afterDiff = await p.select({
      message: 'After viewing diff, what would you like to do?',
      options: [
        { value: 'backup', label: 'Backup and replace' },
        { value: 'merge', label: 'Create merge markers' },
        { value: 'skip', label: 'Skip this file' },
      ],
    });

    if (p.isCancel(afterDiff) || afterDiff === 'skip') {
      return { action: 'skip' };
    }

    if (afterDiff === 'backup') {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupPath = `${existingFile}.backup-${timestamp}`;
      return { action: 'backup', backupPath };
    }

    // Fall through to merge
    return await createMergeMarkers(existingFile, sourceFile);
  }

  if (choice === 'merge') {
    return await createMergeMarkers(existingFile, sourceFile);
  }

  return { action: 'skip' };
}
