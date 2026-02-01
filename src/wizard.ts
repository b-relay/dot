import { createPrompt, createSelection } from 'bun-promptx';
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
 * Prompt user for dotfiles location with arrow-key selection.
 * Returns absolute path.
 */
export function promptDotfilesLocation(): string {
  const home = process.env.HOME ?? '';
  const defaultPath = `${home}/.dotfiles`;

  const items = [
    { text: defaultPath, description: 'Default location' },
    { text: '[Enter custom path]', description: 'Specify a different location' },
  ];

  const result = createSelection(items, {
    headerText: 'Where are your dotfiles?',
  });

  if (result.error) {
    throw new Error('Selection cancelled');
  }

  if (result.selectedIndex === 1) {
    const promptResult = createPrompt('Enter path: ');
    if (promptResult.error || promptResult.value === null) {
      throw new Error('Input cancelled');
    }
    return expandPath(promptResult.value);
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
 * Select items using arrow-key navigation.
 * Supports single or multi-select mode.
 */
export function selectItems<T extends SelectableItem>(
  items: T[],
  options?: { headerText?: string; multi?: boolean }
): T[] {
  if (items.length === 0) {
    return [];
  }

  const selectionItems = items.map(i => ({
    text: i.text,
    description: i.description,
  }));

  // Note: bun-promptx createSelection doesn't have built-in multi-select
  // For multi-select, we'll use a different approach: show checkboxes and loop
  if (options?.multi) {
    // For multi-select, we'll present items with "Done" option
    // User selects items one by one, "Done" finishes selection
    const selected: T[] = [];
    const remaining = [...items];

    while (remaining.length > 0) {
      const menuItems = [
        { text: '[Done selecting]', description: `${selected.length} selected` },
        { text: '[Select all]', description: 'Add all remaining items' },
        ...remaining.map(i => ({ text: i.text, description: i.description })),
      ];

      const result = createSelection(menuItems, {
        headerText: options.headerText ?? 'Select items (press Enter to toggle)',
      });

      if (result.error) {
        // User cancelled, return what we have
        return selected;
      }

      const selectedIdx = result.selectedIndex;
      if (selectedIdx === null || selectedIdx === 0) {
        // Done selecting or null
        break;
      }

      if (selectedIdx === 1) {
        // Select all
        selected.push(...remaining);
        break;
      }

      // User selected an item (offset by 2 for Done and Select all)
      const itemIndex = selectedIdx - 2;
      const item = remaining[itemIndex];
      if (item) {
        selected.push(item);
        remaining.splice(itemIndex, 1);
      }
    }

    return selected;
  }

  // Single select mode
  const result = createSelection(selectionItems, {
    headerText: options?.headerText,
  });

  if (result.error || result.selectedIndex === null) {
    return [];
  }

  const selectedItem = items[result.selectedIndex];
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
 * Confirmation prompt using selection UI.
 * Default focus is on 'No' for safety.
 */
export function confirm(message: string): boolean {
  const items = [
    { text: 'No', description: 'Cancel' },
    { text: 'Yes', description: 'Proceed' },
  ];

  const result = createSelection(items, {
    headerText: message,
  });

  if (result.error) {
    return false;
  }

  // Yes is at index 1
  return result.selectedIndex === 1;
}

/**
 * Prompt for a text input value.
 */
export function promptText(message: string): string | null {
  const result = createPrompt(message);
  if (result.error) {
    return null;
  }
  return result.value;
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
