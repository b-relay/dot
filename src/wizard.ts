import * as p from '@clack/prompts';
import { stat, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { LinkMap } from './types';

/**
 * Detected dotfile with metadata for migration wizard.
 */
export type DetectedDotfile = {
  path: string;           // Full path to the file (e.g., /Users/user/.gitconfig)
  name: string;           // Filename (e.g., .gitconfig)
  suggested: string;      // Suggested location in repo (e.g., git/.gitconfig)
  isDirectory: boolean;   // Whether it's a directory
  warning?: string;       // Warning message (e.g., for .ssh/config)
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
      { value: 'custom', label: 'Enter custom path' },
    ],
  });

  checkCancel(result);

  if (result === 'custom') {
    const customPath = await p.text({
      message: 'Enter dotfiles path:',
      placeholder: '~/my-dotfiles',
      validate: (value) => {
        if (!value || !value.trim()) return 'Path is required';
        return undefined;
      },
    });

    checkCancel(customPath);
    return expandPath(customPath as string);
  }

  return defaultPath;
}

/**
 * Scan home directory for common dotfiles.
 * Returns array of detected dotfiles with metadata.
 */
export async function scanCommonDotfiles(home: string): Promise<DetectedDotfile[]> {
  const found: DetectedDotfile[] = [];

  for (const entry of COMMON_DOTFILES) {
    const fullPath = resolve(home, entry.path);
    if (await pathExists(fullPath)) {
      const isDir = await isDirectory(fullPath);
      found.push({
        path: fullPath,
        name: entry.path,
        suggested: entry.suggested,
        isDirectory: isDir,
        warning: entry.warning,
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
    // Source is where file will live in the repo
    const source = `${dotfilesPath}/${df.suggested}`;
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
