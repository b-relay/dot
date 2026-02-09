import { $ } from "bun";
import { parseArgs } from "util";
import {
  lstat,
  readlink,
  readdir,
  symlink,
  unlink,
  mkdir,
  realpath,
  stat,
} from "node:fs/promises";
import { dirname, resolve, isAbsolute } from "node:path";
import { loadConfig, updateConfigLinks } from "./src/config";
import { getDotfilesPath, loadState, saveState } from "./src/state";
import { link, parseLinkArgs } from "./src/link";
import type { LinkOptions } from "./src/link";
import { init, parseInitArgs } from "./src/init";
import type { InitOptions } from "./src/init";
import { move, moveSelf, parseMoveArgs } from "./src/move";
import type { MoveOptions } from "./src/move";
import { update } from "./src/update";
import type { DotConfig, LinkMap, DotState, Dependency, BrewfileConfig } from "./src/types";
import { browseForPath, UserCancelledError } from "./src/wizard";
import { EXCLUDE_DESCRIPTIONS } from "./src/brewfile-config";
import { detectConfigFileKind, runBrewfileConfigFlow, runConfigWizard } from "./src/config-ui";
import * as p from '@clack/prompts';

const VERSION = "0.1.0";

// Discriminated union for reviewed path entries
type ReviewedEntry =
  | { type: 'timed'; expiresAt: string }  // YYYY-MM-DD format
  | { type: 'forever' };

type ReviewedPaths = Record<string, ReviewedEntry>;

// Config type for internal use (resolved paths)
type Config = {
  dotfiles: string;
  dotconfig: string;
  home: string;
  links: Record<string, string>;
};

type DependencyStatus = {
  name: string;
  required: boolean;
  installed: boolean;
  brewPackage?: string;
  description?: string;
};

type BrewfilePackage = {
  name: string;
  type: 'formula' | 'cask';
  description?: string;
};

type BrewfileSyncStatus = {
  inBrewfileNotInstalled: BrewfilePackage[];
  installedNotInBrewfile: BrewfilePackage[];
};

type HardcodedPathIssue = {
  file: string;
  line: number;
  path: string;
  issue: 'wrong-arch' | 'hardcoded';
  suggestion: string;
};

type InstallOptions = {
  force: boolean;
};

type GlobalOptions = {
  dotfiles?: string;
};

function parseGlobalArgs(): GlobalOptions {
  // Bun.argv: [bun-path, script-path, ...args]
  // Look for global flags before the command
  const args = Bun.argv.slice(2);

  const { values } = parseArgs({
    args,
    options: {
      dotfiles: {
        type: "string",
      },
    },
    strict: false,
    allowPositionals: true,
  });

  return {
    dotfiles: values.dotfiles as string | undefined,
  };
}

function parseInstallArgs(): InstallOptions {
  // Bun.argv: [bun-path, script-path, command, ...args]
  // Slice to get just the args after "install"
  const args = Bun.argv.slice(3);

  const { values } = parseArgs({
    args,
    options: {
      force: {
        type: "boolean",
        short: "f",
        default: false,
      },
    },
    strict: false,
    allowPositionals: true,
  });

  const force =
    values.force === true || values.force === "true";

  return { force };
}

type InitResult = {
  dotfilesPath: string;
  config: DotConfig;
};

/**
 * Initialize dot CLI by discovering dotfiles path and loading config.
 *
 * Priority for dotfiles path:
 * 1. --dotfiles flag
 * 2. DOT_HOME env var
 * 3. State file (~/.config/dot/state.json)
 * 4. Default to ~/.dotfiles if it exists (backward compat)
 *
 * @returns Config and dotfiles path, or null if not configured
 */
async function initializeDot(options: GlobalOptions): Promise<InitResult | null> {
  const home = Bun.env.HOME;
  if (!home) {
    throw new Error("HOME environment variable is not set");
  }
  const dotconfig = `${home}/.config`;

  // Get dotfiles path from priority chain
  let dotfilesPath = await getDotfilesPath({ dotfiles: options.dotfiles });

  // Check if the configured path actually exists
  if (dotfilesPath && !(await pathExists(dotfilesPath))) {
    console.warn(`Warning: Previously configured dotfiles folder no longer exists: ${dotfilesPath}`);
    console.warn("Run 'dot init' to reconfigure.");
    dotfilesPath = null;
  }

  // Backward compatibility: if no path found, check if ~/.dotfiles exists
  if (!dotfilesPath) {
    const defaultPath = `${home}/.dotfiles`;
    // Use pathExists which works for both files and directories
    if (await pathExists(defaultPath)) {
      dotfilesPath = defaultPath;
    }
  }

  if (!dotfilesPath) {
    return null;
  }

  // Try to load config from dotfiles repo
  let config = await loadConfig(dotfilesPath);

  // Backward compatibility: if no config, use legacy links
  if (!config) {
    const legacyLinks = getLegacyLinks(dotfilesPath, home, dotconfig);
    console.warn("No dot.config found. Using legacy links. Create dot.config.json to customize.");
    config = {
      links: legacyLinks,
      autoCommit: true,
    };
  }

  return { dotfilesPath, config };
}

// Legacy links definition for backward compatibility
// Used when no dot.config.json exists in the dotfiles repo
function getLegacyLinks(dotfiles: string, home: string, dotconfig: string): LinkMap {
  return {
    [`${dotfiles}/zsh/zshenv`]: `${home}/.zshenv`,
    [`${dotfiles}/zsh/zprofile`]: `${dotconfig}/zsh/.zprofile`,
    [`${dotfiles}/zsh/zshrc`]: `${dotconfig}/zsh/.zshrc`,
    [`${dotfiles}/zsh/starship.toml`]: `${dotconfig}/starship.toml`,
    [`${dotfiles}/git/.gitconfig`]: `${dotconfig}/git/config`,
    [`${dotfiles}/tmux/tmux.conf`]: `${dotconfig}/tmux/tmux.conf`,
    [`${dotfiles}/vscode/settings.json`]: `${home}/Library/Application Support/Code/User/settings.json`,
    [`${dotfiles}/jj/config.toml`]: `${dotconfig}/jj/config.toml`,
  };
}

function createConfig(dotfilesPath: string, links: LinkMap, home?: string): Config {
  const resolvedHome = home ?? Bun.env.HOME;
  if (!resolvedHome) {
    throw new Error("HOME environment variable is not set");
  }
  const dotconfig = `${resolvedHome}/.config`;

  // Resolve link paths: source relative to dotfiles, target with ~ expanded
  const resolvedLinks: Record<string, string> = {};
  for (const [source, target] of Object.entries(links)) {
    // Resolve source path relative to dotfiles root
    const resolvedSource = isAbsolute(source) ? source : resolve(dotfilesPath, source);
    // Expand ~ in target path
    const resolvedTarget = target.startsWith("~/")
      ? resolve(resolvedHome, target.slice(2))
      : target.startsWith("~")
        ? resolvedHome
        : target;
    resolvedLinks[resolvedSource] = resolvedTarget;
  }

  return {
    dotfiles: dotfilesPath,
    dotconfig,
    home: resolvedHome,
    links: resolvedLinks,
  };
}

// --- Reviewed paths helpers ---

/**
 * Get the path to the reviewed paths file.
 * Uses XDG Base Directory pattern: ~/.config/dot/reviewed.json
 */
function getReviewedFilePath(): string {
  const home = Bun.env.HOME;
  if (!home) throw new Error("HOME environment variable not set");
  return `${home}/.config/dot/reviewed.json`;
}

// --- Core symlink helpers ---

// Resolve symlink target to absolute path (always normalized)
async function resolveSymlinkTarget(linkPath: string): Promise<string> {
  const raw = await readlink(linkPath);
  // Always use resolve() to normalize paths (removes .., ., etc.)
  return resolve(dirname(linkPath), raw);
}

// Try to get realpath, return null if doesn't exist
async function tryRealpath(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

// Check if resolved symlink destination matches expected source
// (canonicalize each side independently)
// Note: resolvedDest is already absolute from resolveSymlinkTarget()
async function linksToExpectedResolved(
  resolvedDest: string,
  expectedSource: string,
): Promise<boolean> {
  // expectedSource needs resolve() since it comes from config (already absolute, but normalize)
  const expectedAbs = resolve(expectedSource);

  // Try to canonicalize each side independently
  const realDest = await tryRealpath(resolvedDest);
  const realSource = await tryRealpath(expectedAbs);

  // If both exist, compare real paths
  if (realDest !== null && realSource !== null) {
    return realDest === realSource;
  }

  // Fall back to comparing absolute paths
  return resolvedDest === expectedAbs;
}

// Check if path exists (use stat, not Bun.file)
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// --- End symlink helpers ---

// --- Dependency checking helpers ---

async function isToolInstalled(name: string): Promise<boolean> {
  const { exitCode } = await $`which ${name}`.nothrow().quiet();
  return exitCode === 0;
}

async function checkDependencies(deps: Dependency[]): Promise<DependencyStatus[]> {
  if (deps.length === 0) {
    return [];
  }
  return Promise.all(
    deps.map(async (dep) => ({
      name: dep.name,
      required: dep.required,
      installed: await isToolInstalled(dep.name),
      brewPackage: dep.brewPackage,
      description: dep.description,
    }))
  );
}

async function checkNerdFont(): Promise<boolean> {
  const home = Bun.env.HOME ?? '';
  const fontDirs = [
    `${home}/Library/Fonts`,
    '/Library/Fonts',
  ];

  for (const dir of fontDirs) {
    try {
      const files = await readdir(dir);
      if (files.some(f => f.includes('JetBrainsMono') && f.includes('Nerd'))) {
        return true;
      }
    } catch {
      // Directory doesn't exist or not readable
    }
  }
  return false;
}

function printDependencyStatus(deps: DependencyStatus[], fontInstalled: boolean): void {
  const required = deps.filter(d => d.required);
  const recommended = deps.filter(d => !d.required);

  console.log("Required dependencies:");
  for (const dep of required) {
    const status = dep.installed ? "\u2714" : "\u2718";
    const hint = !dep.installed && dep.brewPackage
      ? ` (brew install ${dep.brewPackage})`
      : "";
    console.log(`  ${status} ${dep.name}${hint}`);
  }

  console.log("\nRecommended dependencies:");
  for (const dep of recommended) {
    const status = dep.installed ? "\u2714" : "\u2718";
    const hint = !dep.installed && dep.brewPackage
      ? ` (brew install ${dep.brewPackage})`
      : "";
    console.log(`  ${status} ${dep.name}${hint}`);
  }

  console.log("\nRecommended fonts:");
  if (fontInstalled) {
    console.log("  \u2714 JetBrains Mono Nerd Font");
  } else {
    console.log("  \u2718 JetBrains Mono Nerd Font (brew install font-jetbrains-mono-nerd-font)");
  }
}

function printBrewInstallCommand(deps: DependencyStatus[]): void {
  const missing = deps
    .filter(d => !d.installed && d.brewPackage)
    .map(d => d.brewPackage!);

  if (missing.length > 0) {
    console.log(`\nInstall missing with: brew install ${missing.join(" ")}`);
  }
}

async function preflightCheck(force: boolean, dotConfig: DotConfig): Promise<boolean> {
  if (force) {
    p.log.warn('Bypassing dependency check (--force)');
    return true;
  }

  const configDeps = dotConfig.dependencies ?? [];
  const requiredDeps = configDeps.filter(d => d.required);

  if (requiredDeps.length === 0) {
    return true; // No required deps configured
  }

  const deps = await checkDependencies(requiredDeps);
  const missingRequired = deps.filter(d => !d.installed);

  if (missingRequired.length === 0) {
    return true;
  }

  p.log.error('Missing required dependencies:');
  for (const dep of missingRequired) {
    const hint = dep.brewPackage ? ` (brew install ${dep.brewPackage})` : '';
    console.error(`  ✗ ${dep.name}${hint}`);
  }
  p.log.info('Install dependencies first, or use --force to bypass.');
  return false;
}

// --- End dependency checking helpers ---

// --- Brewfile sync helpers ---

async function parseBrewfile(config: Config, brewfileConfig?: BrewfileConfig): Promise<BrewfilePackage[]> {
  const relativePath = brewfileConfig?.path ?? "homebrew/brewfile";
  const brewfilePath = `${config.dotfiles}/${relativePath}`;
  const file = Bun.file(brewfilePath);

  if (!(await file.exists())) {
    return [];
  }

  const content = await file.text();
  const lines = content.split('\n');
  const packages: BrewfilePackage[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const prevLine = i > 0 ? lines[i - 1]!.trim() : '';

    // Extract description from comment on previous line
    let description: string | undefined;
    if (prevLine.startsWith('# ')) {
      description = prevLine.slice(2);
    }

    // Parse brew "package" lines (formulae)
    const brewMatch = line.match(/^brew\s+"([^"]+)"/);
    if (brewMatch) {
      packages.push({
        name: brewMatch[1]!,
        type: 'formula',
        description,
      });
      continue;
    }

    // Parse cask "package" lines
    const caskMatch = line.match(/^cask\s+"([^"]+)"/);
    if (caskMatch) {
      packages.push({
        name: caskMatch[1]!,
        type: 'cask',
        description,
      });
    }
    // Ignore tap lines - not packages to install
  }

  return packages;
}

async function getInstalledPackages(): Promise<BrewfilePackage[]> {
  const packages: BrewfilePackage[] = [];

  // Get installed formulae
  const formulaResult = await $`brew list --formula -1`.nothrow().quiet();
  if (formulaResult.exitCode === 0) {
    const formulae = formulaResult.text().trim().split('\n').filter(Boolean);
    for (const name of formulae) {
      packages.push({ name, type: 'formula' });
    }
  }

  // Get installed casks
  const caskResult = await $`brew list --cask -1`.nothrow().quiet();
  if (caskResult.exitCode === 0) {
    const casks = caskResult.text().trim().split('\n').filter(Boolean);
    for (const name of casks) {
      packages.push({ name, type: 'cask' });
    }
  }

  return packages;
}

// Extract package name from tap path (e.g., "oven-sh/bun/bun" -> "bun")
function getPackageBaseName(name: string): string {
  const parts = name.split('/');
  return parts[parts.length - 1]!;
}

async function checkBrewfileSync(config: Config, brewfileConfig?: BrewfileConfig): Promise<BrewfileSyncStatus> {
  const [brewfilePackages, installedPackages] = await Promise.all([
    parseBrewfile(config, brewfileConfig),
    getInstalledPackages(),
  ]);

  // Create lookup sets for comparison
  // For installed packages, use the name directly (already just package name)
  const installedFormulae = new Set(
    installedPackages.filter(p => p.type === 'formula').map(p => p.name)
  );
  const installedCasks = new Set(
    installedPackages.filter(p => p.type === 'cask').map(p => p.name)
  );

  // For brewfile packages, need to handle tap paths
  const brewfileFormulaNames = new Set(
    brewfilePackages.filter(p => p.type === 'formula').map(p => getPackageBaseName(p.name))
  );
  const brewfileCaskNames = new Set(
    brewfilePackages.filter(p => p.type === 'cask').map(p => p.name)
  );

  // Find packages in brewfile but not installed
  const inBrewfileNotInstalled: BrewfilePackage[] = [];
  for (const pkg of brewfilePackages) {
    const baseName = getPackageBaseName(pkg.name);
    if (pkg.type === 'formula' && !installedFormulae.has(baseName)) {
      inBrewfileNotInstalled.push(pkg);
    } else if (pkg.type === 'cask' && !installedCasks.has(pkg.name)) {
      inBrewfileNotInstalled.push(pkg);
    }
  }

  // Find installed packages not in brewfile
  const installedNotInBrewfile: BrewfilePackage[] = [];
  for (const pkg of installedPackages) {
    if (pkg.type === 'formula' && !brewfileFormulaNames.has(pkg.name)) {
      installedNotInBrewfile.push(pkg);
    } else if (pkg.type === 'cask' && !brewfileCaskNames.has(pkg.name)) {
      installedNotInBrewfile.push(pkg);
    }
  }

  return {
    inBrewfileNotInstalled,
    installedNotInBrewfile,
  };
}

function printBrewfileStatus(status: BrewfileSyncStatus, config: Config): void {
  console.log("Brewfile sync:");

  if (status.inBrewfileNotInstalled.length > 0) {
    console.log("  Not installed (in brewfile):");
    for (const pkg of status.inBrewfileNotInstalled) {
      console.log(`    \u2718 ${pkg.name} (${pkg.type})`);
    }
    console.log(`\n  Install missing with: brew bundle install --file=${config.dotfiles}/homebrew/brewfile`);
  }

  if (status.installedNotInBrewfile.length > 0) {
    if (status.inBrewfileNotInstalled.length > 0) {
      console.log(""); // Add spacing between sections
    }
    console.log("  Untracked (not in brewfile):");
    for (const pkg of status.installedNotInBrewfile) {
      console.log(`    - ${pkg.name} (${pkg.type})`);
    }
  }

  if (status.inBrewfileNotInstalled.length === 0 && status.installedNotInBrewfile.length === 0) {
    console.log("  \u2714 All synced");
  }
}

// --- End brewfile sync helpers ---

// --- Architecture detection helpers ---

function getArchitecture(): 'arm64' | 'x86_64' {
  return process.arch === 'arm64' ? 'arm64' : 'x86_64';
}

async function scanForHardcodedPaths(config: Config): Promise<HardcodedPathIssue[]> {
  const architecture = getArchitecture();
  const issues: HardcodedPathIssue[] = [];

  // Files to scan for hardcoded paths
  const filesToScan = [
    `${config.dotfiles}/zsh/zprofile`,
    `${config.dotfiles}/zsh/zshrc`,
  ];

  // Add config/*.zsh and plugins/*.zsh
  try {
    const configFiles = await readdir(`${config.dotfiles}/zsh/config`);
    filesToScan.push(...configFiles.filter(f => f.endsWith('.zsh')).map(f => `${config.dotfiles}/zsh/config/${f}`));
  } catch {
    // Directory doesn't exist
  }

  try {
    const pluginFiles = await readdir(`${config.dotfiles}/zsh/plugins`);
    filesToScan.push(...pluginFiles.filter(f => f.endsWith('.zsh')).map(f => `${config.dotfiles}/zsh/plugins/${f}`));
  } catch {
    // Directory doesn't exist
  }

  // Patterns to detect
  // NOTE: This simple regex matching doesn't distinguish between:
  // - Hardcoded usage: export PATH="/opt/homebrew/bin:$PATH" (SHOULD flag)
  // - Conditional detection: if [[ -f /opt/homebrew/bin/brew ]] (should NOT flag)
  // Current behavior: flags ALL occurrences on wrong architecture.
  // This is acceptable because:
  // 1. Our portable zprofile uses /opt/homebrew/bin/brew and /usr/local/bin/brew
  //    for detection, which don't match the /usr/local/(Cellar|opt) pattern
  // 2. False positives only occur on Intel Macs with our portable conditionals
  // Future improvement: Add context-aware detection to recognize conditional patterns
  const appleOnlyPattern = /\/opt\/homebrew/;
  const intelOnlyPattern = /\/usr\/local\/(Cellar|opt)/;

  for (const filePath of filesToScan) {
    try {
      const content = await Bun.file(filePath).text();
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const trimmed = line.trimStart();

        // Skip comment lines
        if (trimmed.startsWith('#')) continue;

        // Check for Apple Silicon paths
        const appleMatch = line.match(appleOnlyPattern);
        if (appleMatch) {
          // On Intel, /opt/homebrew is wrong
          if (architecture === 'x86_64') {
            issues.push({
              file: filePath,
              line: i + 1,
              path: '/opt/homebrew',
              issue: 'wrong-arch',
              suggestion: 'Use $(brew --prefix) for portability',
            });
          }
        }

        // Check for Intel paths
        const intelMatch = line.match(intelOnlyPattern);
        if (intelMatch) {
          // On Apple Silicon, /usr/local/Cellar or /usr/local/opt is wrong
          if (architecture === 'arm64') {
            issues.push({
              file: filePath,
              line: i + 1,
              path: intelMatch[0],
              issue: 'wrong-arch',
              suggestion: 'Use $(brew --prefix) for portability',
            });
          }
        }
      }
    } catch {
      // File doesn't exist or can't be read
    }
  }

  return issues;
}

function printArchitectureStatus(architecture: 'arm64' | 'x86_64', issues: HardcodedPathIssue[]): void {
  console.log(`Architecture: ${architecture} \u2714`);

  if (issues.length > 0) {
    console.log("\n  Hardcoded architecture-specific paths:");
    for (const issue of issues) {
      // Get relative path from dotfiles for cleaner output
      const displayPath = issue.file.includes('.dotfiles')
        ? issue.file.split('.dotfiles/')[1]
        : issue.file;
      console.log(`    \u2718 ${displayPath}:${issue.line} - ${issue.path}`);
      console.log(`      ${issue.suggestion}`);
    }
  }
}

// --- End architecture detection helpers ---

async function readReviewedPaths(): Promise<ReviewedPaths> {
  const filePath = getReviewedFilePath();
  const file = Bun.file(filePath);
  if (await file.exists()) {
    try {
      return await file.json();
    } catch {
      // Return empty if JSON parse fails (corrupted file)
      return {};
    }
  }
  return {};
}

async function writeReviewedPaths(paths: ReviewedPaths): Promise<void> {
  const filePath = getReviewedFilePath();
  // Ensure parent directory exists
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, JSON.stringify(paths, null, 2) + "\n");
}

/**
 * Check if a reviewed entry is currently ignored (not expired).
 * Forever entries are always ignored. Timed entries are ignored until their expiry date.
 */
function isIgnored(entry: ReviewedEntry, now: Date = new Date()): boolean {
  if (entry.type === 'forever') {
    return true;
  }
  // Compare date strings (YYYY-MM-DD format is lexicographically sortable)
  const today = now.toISOString().split('T')[0]!;
  return entry.expiresAt > today;
}

/**
 * Filter reviewed paths to only include active (non-expired) entries.
 */
function getActiveReviewed(paths: ReviewedPaths): ReviewedPaths {
  const now = new Date();
  const active: ReviewedPaths = {};
  for (const [path, entry] of Object.entries(paths)) {
    if (isIgnored(entry, now)) {
      active[path] = entry;
    }
  }
  return active;
}

/**
 * Get paths that have expired (came back from review).
 */
function getExpiredPaths(paths: ReviewedPaths): string[] {
  const now = new Date();
  const expired: string[] = [];
  for (const [path, entry] of Object.entries(paths)) {
    if (!isIgnored(entry, now)) {
      expired.push(path);
    }
  }
  return expired;
}

// --- Ignore duration helpers ---

/**
 * Calculate expiry date from number of days in the future.
 * Returns YYYY-MM-DD format string.
 */
function calculateExpiryDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0]!;
}

/**
 * Format a YYYY-MM-DD date string for display (e.g., "Mar 15").
 */
function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const month = date.toLocaleString('en-US', { month: 'short' });
  const day = date.getDate();
  return `${month} ${day}`;
}

type IgnoreChoice =
  | { type: '1-month' }
  | { type: 'forever' }
  | { type: 'custom'; days: number }
  | { type: 'skip' };

/**
 * Prompt user to select ignore duration for a path.
 */
async function promptIgnoreDuration(path: string): Promise<IgnoreChoice> {
  const oneMonthExpiry = calculateExpiryDate(30);

  const choice = await p.select({
    message: `Ignore ${path}?`,
    options: [
      { value: '1-month', label: '1 month', hint: `until ${formatDateShort(oneMonthExpiry)}` },
      { value: 'forever', label: 'Forever', hint: 'permanent' },
      { value: 'custom', label: 'Custom', hint: 'enter days' },
      { value: 'skip', label: "Don't ignore" },
    ],
  });

  if (p.isCancel(choice)) {
    return { type: 'skip' };
  }

  if (choice === 'custom') {
    const daysInput = await p.text({
      message: 'Number of days:',
      validate: (value) => {
        if (!value) return 'Enter a positive number';
        const num = parseInt(value, 10);
        if (isNaN(num) || num <= 0) return 'Enter a positive number';
        return undefined;
      },
    });

    if (p.isCancel(daysInput)) {
      return { type: 'skip' };
    }

    const days = parseInt(daysInput as string, 10);

    // Confirm if > 999 days (catches typos)
    if (days > 999) {
      const years = Math.round(days / 365);
      const confirm = await p.confirm({
        message: `Ignore for ${days} days (~${years} years)?`,
        initialValue: false,
      });

      if (p.isCancel(confirm) || !confirm) {
        return { type: 'skip' };
      }
    }

    return { type: 'custom', days };
  }

  return { type: choice as '1-month' | 'forever' | 'skip' };
}

/**
 * Convert an IgnoreChoice to a ReviewedEntry (or null if skipped).
 */
function choiceToEntry(choice: IgnoreChoice): ReviewedEntry | null {
  switch (choice.type) {
    case '1-month':
      return { type: 'timed', expiresAt: calculateExpiryDate(30) };
    case 'forever':
      return { type: 'forever' };
    case 'custom':
      return { type: 'timed', expiresAt: calculateExpiryDate(choice.days) };
    case 'skip':
      return null;
  }
}

/**
 * Format a confirmation message for an ignore entry.
 */
function formatIgnoreConfirmation(entry: ReviewedEntry): string {
  if (entry.type === 'forever') {
    return 'Ignored permanently';
  }
  return `Ignored until ${formatDateShort(entry.expiresAt)}`;
}

// --- End ignore duration helpers ---

// --- Ignore management commands ---

/**
 * List all ignored paths with their expiry status.
 */
async function listIgnored(): Promise<void> {
  const paths = await readReviewedPaths();
  const entries = Object.entries(paths);

  if (entries.length === 0) {
    p.log.info('No ignored paths');
    return;
  }

  // Separate active and expired
  const now = new Date();
  const active: [string, ReviewedEntry][] = [];
  const expired: [string, ReviewedEntry][] = [];

  for (const [path, entry] of entries) {
    if (isIgnored(entry, now)) {
      active.push([path, entry]);
    } else {
      expired.push([path, entry]);
    }
  }

  if (active.length > 0) {
    p.log.step(`Ignored paths (${active.length}):`);
    for (const [path, entry] of active) {
      if (entry.type === 'forever') {
        console.log(`  ${path} (permanent)`);
      } else {
        console.log(`  ${path} (until ${entry.expiresAt})`);
      }
    }
  }

  if (expired.length > 0) {
    p.log.step(`Expired (${expired.length}):`);
    for (const [path] of expired) {
      console.log(`  ${path}`);
    }
  }
}

/**
 * Remove a path from the ignore list.
 */
async function unignorePath(inputPath: string, home: string): Promise<void> {
  const normalizedPath = normalizePath(home, inputPath);
  const paths = await readReviewedPaths();

  if (!(normalizedPath in paths)) {
    p.log.warn(`Path not in ignore list: ${normalizedPath}`);
    return;
  }

  delete paths[normalizedPath];
  await writeReviewedPaths(paths);
  p.log.success(`Removed from ignore list: ${normalizedPath}`);
}

// --- End ignore management commands ---

function normalizePath(home: string, inputPath: string): string {
  // Expand ~ and ~/ to home
  if (inputPath === "~") {
    return home;
  }
  if (inputPath.startsWith("~/")) {
    return resolve(home, inputPath.slice(2));
  }
  // Resolve relative paths against home (not cwd) for stability
  if (!isAbsolute(inputPath)) {
    return resolve(home, inputPath);
  }
  // Already absolute
  return resolve(inputPath);
}

async function install(config: Config) {
  console.log("Installing dotfiles...");

  for (const [source, target] of Object.entries(config.links)) {
    await mkdir(dirname(target), { recursive: true });

    try {
      const linkStat = await lstat(target);
      if (linkStat.isSymbolicLink()) {
        const dest = await resolveSymlinkTarget(target);
        if (await linksToExpectedResolved(dest, source)) {
          console.log(`  [skip] ${target} (already correct)`);
        } else {
          console.log(`  [warn] ${target} points to ${dest}, expected ${source}`);
        }
      } else {
        console.log(`  [warn] ${target} exists and is not a symlink`);
      }
    } catch {
      // Target doesn't exist - check source exists before creating symlink
      if (!(await pathExists(source))) {
        console.log(`  [warn] ${target} skipped (source ${source} does not exist)`);
        continue;
      }
      await symlink(source, target);
      console.log(`  [link] ${target} -> ${source}`);
    }
  }

  console.log("Done!");
  console.log("\nTo apply changes, run: exec zsh");
  console.log("Or open a new terminal window.");
}

async function uninstall(config: Config) {
  console.log("Removing dotfiles symlinks...");

  for (const [source, target] of Object.entries(config.links)) {
    try {
      const linkStat = await lstat(target);
      if (!linkStat.isSymbolicLink()) {
        console.log(`  [skip] ${target} (not a symlink)`);
        continue;
      }

      const dest = await resolveSymlinkTarget(target);
      if (await linksToExpectedResolved(dest, source)) {
        await unlink(target);
        console.log(`  [removed] ${target}`);
      } else {
        console.log(`  [skip] ${target} (points to ${dest}, not ours)`);
      }
    } catch {
      console.log(`  [skip] ${target} (does not exist)`);
    }
  }

  console.log("Done!");
}

/**
 * Filter brewfile output to exclude certain package types.
 * Matches brew bundle dump format: vscode "ext", mas "app", whalebrew "pkg"
 *
 * @param output - Raw output from `brew bundle dump`
 * @param exclude - Package type prefixes to exclude (e.g., ["vscode", "mas"])
 * @returns Filtered brewfile content
 */
export function filterBrewfile(output: string, exclude: string[] = ["vscode"]): string {
  if (exclude.length === 0) {
    return output;
  }

  // Build regex to match lines like: vscode "extension", brew "go", etc.
  // Format: <type> "<package>"
  const excludePattern = new RegExp(`^(${exclude.join('|')})\\s+"`, 'i');

  return output
    .split("\n")
    .filter(line => {
      const t = line.trimStart();
      return !excludePattern.test(t);
    })
    .join("\n");
}

/**
 * Parse args after `dot sync`.
 * We disallow configuration entrypoints here; config lives under `dot config`.
 */
export function parseSyncArgs(syncArgs: string[]): { ok: true } | { ok: false; error: string } {
  if (syncArgs.length === 0) return { ok: true };

  // Disallow legacy entrypoints explicitly with a helpful message.
  if (syncArgs.includes("--config") || syncArgs[0] === "config") {
    return { ok: false, error: "Sync config has moved. Use: dot config brewfile" };
  }

  // Reject any other args (flags or positionals) for now to avoid silent no-ops.
  const bad = syncArgs[0]!;
  if (bad.startsWith("-")) {
    return { ok: false, error: `Unknown option for dot sync: ${bad}` };
  }
  return { ok: false, error: `dot sync does not accept subcommands (got: ${bad}). Use: dot config brewfile` };
}

async function sync(config: Config, dotConfig: DotConfig) {
  p.intro('dot sync');

  const brewfileConfig = dotConfig.brewfile;
  const relativePath = brewfileConfig?.path ?? "homebrew/brewfile";
  const exclude = brewfileConfig?.exclude ?? ["vscode"];

  // Show exclusion info
  if (exclude.length > 0) {
    const excludeList = exclude.map(e => EXCLUDE_DESCRIPTIONS[e] ? `${e}` : e).join(', ');
    p.log.info(`Excluding: ${excludeList}`);
    console.log("  Run 'dot config brewfile' to change settings");
  } else {
    p.log.info('No exclusions - including all packages');
    console.log("  Run 'dot config brewfile' to exclude package types");
  }

  const s = p.spinner();
  s.start('Dumping Homebrew packages...');

  // Run brew bundle dump to stdout
  let output: string;
  try {
    output = await $`brew bundle dump --describe -f --file=/dev/stdout`.text();
  } catch (error) {
    s.stop('Failed');
    p.log.error('Failed to dump Homebrew packages. Is brew installed?');
    process.exit(1);
  }

  // Filter out unwanted lines
  const filtered = filterBrewfile(output, exclude);

  // Write filtered output
  const brewfilePath = `${config.dotfiles}/${relativePath}`;
  await mkdir(dirname(brewfilePath), { recursive: true });
  await Bun.write(brewfilePath, filtered);

  s.stop('Brewfile updated');

  // Show git status
  const statusOutput = await $`git -C ${config.dotfiles} status -s`.text();
  if (statusOutput.trim()) {
    p.log.step('Changes:');
    console.log(statusOutput);
  } else {
    p.log.success('No changes');
  }

  p.outro('Review changes and commit if needed');
}

type SymlinkStatus = {
  source: string;
  target: string;
  status: "valid" | "broken" | "missing" | "wrong-target" | "not-symlink";
  actualTarget?: string;
};

async function getSymlinkStatus(config: Config): Promise<SymlinkStatus[]> {
  const entries = Object.entries(config.links);

  const results = await Promise.all(
    entries.map(async ([source, target]): Promise<SymlinkStatus> => {
      try {
        const linkStat = await lstat(target);
        if (!linkStat.isSymbolicLink()) {
          return { source, target, status: "not-symlink" };
        }

        const dest = await resolveSymlinkTarget(target);
        if (await linksToExpectedResolved(dest, source)) {
          // Correct link - check if RESOLVED DESTINATION exists
          if (await pathExists(dest)) {
            return { source, target, status: "valid" };
          }
          return { source, target, status: "broken" };
        }
        return { source, target, status: "wrong-target", actualTarget: dest };
      } catch {
        return { source, target, status: "missing" };
      }
    }),
  );

  return results;
}

async function getRepoFiles(config: Config): Promise<string[]> {
  const output = await $`git -C ${config.dotfiles} ls-files`.text();
  return output.trim().split("\n").filter(Boolean);
}

// Check if a path is managed (either a direct target or parent of a managed target)
function isPathManaged(path: string, managedTargets: Set<string>): boolean {
  // Direct match
  if (managedTargets.has(path)) return true;
  // Check if any managed target is under this path
  for (const target of managedTargets) {
    if (target.startsWith(path + "/")) return true;
  }
  return false;
}

async function getDotfiles(config: Config): Promise<Dotfile[]> {
  // Names to skip entirely
  const skipNames = new Set([
    ".DS_Store",
    ".CFUserTextEncoding",
    ".Trash",
    ".cache",
    ".npm",
    ".bun",
    ".local",
    ".nvm",
    ".cargo",
    ".rustup",
    ".vscode",
    ".cursor",
    ".zsh_sessions",
    ".dotfiles",
  ]);

  // Patterns to skip
  const skipPatterns = [
    /history$/i,
    /^\.lesshst$/,
    /^\.python_history$/,
    /^\.node_repl_history$/,
    /^\.zcompdump/,
    /^\.zsh_history$/,
  ];

  const shouldExclude = (name: string) =>
    skipNames.has(name) || skipPatterns.some(p => p.test(name));

  // Managed targets (what we already track)
  const managedTargets = new Set(Object.values(config.links));

  const results: Dotfile[] = [];

  // Scan home directory for dotfiles
  try {
    const homeFiles = await readdir(config.home);
    const homeResults = await Promise.all(
      homeFiles.map(async (file): Promise<Dotfile | null> => {
        if (!file.startsWith(".")) return null;
        if (shouldExclude(file)) return null;

        const fullPath = `${config.home}/${file}`;
        try {
          const fileStat = await lstat(fullPath);
          const entry: Dotfile = {
            path: fullPath,
            type: fileStat.isSymbolicLink()
              ? "symlink"
              : fileStat.isDirectory()
                ? "directory"
                : "file",
            isManaged: isPathManaged(fullPath, managedTargets),
          };

          if (fileStat.isSymbolicLink()) {
            try {
              entry.symlinkTarget = await readlink(fullPath);
            } catch {
              entry.symlinkTarget = "(broken)";
            }
          }

          if (fileStat.isFile()) {
            entry.size = fileStat.size;
          }

          entry.lastModified = fileStat.mtime.toISOString().split("T")[0];
          return entry;
        } catch {
          // Skip files we can't stat (permission denied, etc.)
          return null;
        }
      }),
    );
    results.push(...homeResults.filter((x): x is Dotfile => x !== null));
  } catch {
    // Skip if home directory is unreadable
  }

  // Scan ~/.config directory
  try {
    const configDirs = await readdir(config.dotconfig);
    const configResults = await Promise.all(
      configDirs.map(async (name): Promise<Dotfile | null> => {
        if (shouldExclude(name)) return null;

        const fullPath = `${config.dotconfig}/${name}`;
        try {
          const fileStat = await lstat(fullPath);
          const entry: Dotfile = {
            path: fullPath,
            type: fileStat.isSymbolicLink()
              ? "symlink"
              : fileStat.isDirectory()
                ? "directory"
                : "file",
            isManaged: isPathManaged(fullPath, managedTargets),
          };

          if (fileStat.isSymbolicLink()) {
            try {
              entry.symlinkTarget = await readlink(fullPath);
            } catch {
              entry.symlinkTarget = "(broken)";
            }
          }

          if (fileStat.isFile()) {
            entry.size = fileStat.size;
          }

          entry.lastModified = fileStat.mtime.toISOString().split("T")[0];
          return entry;
        } catch {
          return null;
        }
      }),
    );
    results.push(...configResults.filter((x): x is Dotfile => x !== null));
  } catch {
    // Skip if .config directory doesn't exist or is unreadable
  }

  return results.sort((a, b) => a.path.localeCompare(b.path));
}

async function getGitStatus(
  config: Config,
): Promise<{ status: string; branch: string }> {
  const [status, branch] = await Promise.all([
    $`git -C ${config.dotfiles} status --porcelain`.text(),
    $`git -C ${config.dotfiles} branch --show-current`.text(),
  ]);
  return { status: status.trim(), branch: branch.trim() };
}

type Dotfile = {
  path: string;
  type: "file" | "directory" | "symlink";
  isManaged: boolean;
  size?: number;
  lastModified?: string;
  symlinkTarget?: string;
};

/**
 * Mark a path as reviewed with the given entry type.
 */
async function markAsReviewed(
  normalizedPath: string,
  entry: ReviewedEntry,
): Promise<void> {
  const reviewed = await readReviewedPaths();
  reviewed[normalizedPath] = entry;
  await writeReviewedPaths(reviewed);
}

type DoctorIgnoreOptions = {
  path?: string;
  cwd?: boolean;
};

async function doctorIgnore(config: Config, options: DoctorIgnoreOptions) {
  p.intro('dot doctor ignore');

  let targetPath: string;

  if (options.path) {
    // Path provided directly
    targetPath = normalizePath(config.home, options.path);
  } else {
    // Browse for path
    const startDir = options.cwd ? process.cwd() : config.home;
    p.log.info(`Select a file or directory to ignore (starting from ${startDir})`);

    try {
      targetPath = await browseForPath(startDir);
    } catch (error) {
      if (error instanceof UserCancelledError) {
        p.log.warn('Cancelled');
        return;
      }
      throw error;
    }
  }

  // Prompt for duration
  const choice = await promptIgnoreDuration(targetPath);
  const entry = choiceToEntry(choice);

  if (!entry) {
    // User chose "Don't ignore" - silent exit per CONTEXT.md
    return;
  }

  await markAsReviewed(targetPath, entry);
  p.log.success(formatIgnoreConfirmation(entry));
}

async function doctor(config: Config, dotConfig: DotConfig) {
  p.intro('dot doctor');

  // Load reviewed paths and check for expired (show notification at top)
  const allReviewedPaths = await readReviewedPaths();
  const expiredPaths = getExpiredPaths(allReviewedPaths);
  const activeReviewed = getActiveReviewed(allReviewedPaths);

  // Show expired paths notification at top if any came back
  if (expiredPaths.length > 0) {
    const pathWord = expiredPaths.length === 1 ? 'path' : 'paths';
    p.log.info(`${expiredPaths.length} ${pathWord} came back from review`);
    for (const path of expiredPaths.slice(0, 3)) {
      console.log(`  ${path}`);
    }
    if (expiredPaths.length > 3) {
      console.log(`  ... and ${expiredPaths.length - 3} more`);
    }
    console.log('');  // Blank line before rest of output

    // Clean up expired entries from file
    await writeReviewedPaths(activeReviewed);
  }

  const s = p.spinner();

  // Check dependencies if configured
  const deps = dotConfig.dependencies ?? [];
  let depStatus: DependencyStatus[] = [];

  if (deps.length > 0) {
    s.start('Checking dependencies...');
    const [status, fontInstalled] = await Promise.all([
      checkDependencies(deps),
      checkNerdFont(),
    ]);
    depStatus = status;
    s.stop('Dependencies checked');

    // Show dependency status
    const required = depStatus.filter(d => d.required);
    const recommended = depStatus.filter(d => !d.required);

    if (required.length > 0) {
      p.log.step('Required:');
      for (const dep of required) {
        const icon = dep.installed ? '✓' : '✗';
        const hint = !dep.installed && dep.brewPackage ? ` (brew install ${dep.brewPackage})` : '';
        console.log(`  ${icon} ${dep.name}${hint}`);
      }
    }

    if (recommended.length > 0) {
      p.log.step('Recommended:');
      for (const dep of recommended) {
        const icon = dep.installed ? '✓' : '○';
        const hint = !dep.installed && dep.brewPackage ? ` (brew install ${dep.brewPackage})` : '';
        console.log(`  ${icon} ${dep.name}${hint}`);
      }
    }

    // Nerd font
    if (fontInstalled) {
      console.log(`  ✓ JetBrains Mono Nerd Font`);
    } else {
      console.log(`  ○ JetBrains Mono Nerd Font (brew install font-jetbrains-mono-nerd-font)`);
    }
  } else {
    p.log.info('No dependencies configured (add "dependencies" to dot.config.json)');
  }

  // Check brewfile sync if configured
  const brewfileConfig = dotConfig.brewfile;
  if (brewfileConfig) {
    s.start('Checking brewfile sync...');
    const brewfileStatus = await checkBrewfileSync(config, brewfileConfig);
    s.stop('Brewfile checked');

    if (brewfileStatus.inBrewfileNotInstalled.length > 0) {
      p.log.warn(`Not installed (${brewfileStatus.inBrewfileNotInstalled.length}):`);
      for (const pkg of brewfileStatus.inBrewfileNotInstalled.slice(0, 5)) {
        console.log(`  ✗ ${pkg.name}`);
      }
      if (brewfileStatus.inBrewfileNotInstalled.length > 5) {
        console.log(`  ... and ${brewfileStatus.inBrewfileNotInstalled.length - 5} more`);
      }
    }

    if (brewfileStatus.installedNotInBrewfile.length > 0) {
      p.log.info(`Untracked (${brewfileStatus.installedNotInBrewfile.length}):`);
      for (const pkg of brewfileStatus.installedNotInBrewfile.slice(0, 5)) {
        console.log(`  - ${pkg.name}`);
      }
      if (brewfileStatus.installedNotInBrewfile.length > 5) {
        console.log(`  ... and ${brewfileStatus.installedNotInBrewfile.length - 5} more`);
      }
    }

    if (brewfileStatus.inBrewfileNotInstalled.length === 0 && brewfileStatus.installedNotInBrewfile.length === 0) {
      p.log.success('Brewfile in sync');
    }
  }

  // Check architecture
  const architecture = getArchitecture();
  const pathIssues = await scanForHardcodedPaths(config);

  p.log.step(`Architecture: ${architecture}`);
  if (pathIssues.length > 0) {
    p.log.warn(`Hardcoded paths (${pathIssues.length}):`);
    for (const issue of pathIssues.slice(0, 3)) {
      const displayPath = issue.file.includes('.dotfiles')
        ? issue.file.split('.dotfiles/')[1]
        : issue.file;
      console.log(`  ${displayPath}:${issue.line} - ${issue.path}`);
    }
  }

  // Gather state with spinner
  s.start('Gathering system state...');
  const [symlinkStatus, repoFiles, dotfiles, gitStatus] = await Promise.all([
    getSymlinkStatus(config),
    getRepoFiles(config),
    getDotfiles(config),
    getGitStatus(config),
  ]);
  s.stop('State gathered');

  // Build context for Claude
  const context = JSON.stringify(
    {
      architecture,
      hardcodedPaths: pathIssues,
      symlinks: symlinkStatus,
      repoFiles,
      dotfiles,
      gitStatus,
      linksDefinition: config.links,
      reviewedPaths: activeReviewed,
    },
    null,
    2,
  );

  const homebrewPath = architecture === 'arm64' ? '/opt/homebrew' : '/usr/local';
  const prompt = `You are analyzing a dotfiles repository setup. Review the data below and provide a concise report of issues and recommendations.

This Mac is running on ${architecture} architecture. Homebrew is at ${homebrewPath}.

IMPORTANT: Output plain text only, no markdown formatting. This will be displayed directly in a terminal.

Focus on:
1. Symlink problems (broken, missing, wrong-target, or not-symlink status)
2. Uncommitted git changes
3. Dotfiles that might be worth tracking (look at entries with isManaged: false)
4. Cleanup suggestions (old configs, orphaned files, unused app data, backup files, etc.)
5. Architecture-specific issues (hardcoded Homebrew paths that won't work on other Mac architectures)

IMPORTANT: The "reviewedPaths" field contains paths the user has already reviewed and decided not to track. Do NOT recommend these paths again unless there's a specific issue with them (not just "consider tracking"). These paths have been intentionally left untracked.

Format your response as a brief, actionable report. Group cleanup suggestions separately from tracking recommendations. If everything looks good, say so.

Data:`;

  s.start('Analyzing with Claude...');
  try {
    s.stop('');
    await $`claude -p ${prompt + "\n\n" + context} --model haiku`;
  } catch (error) {
    s.stop('Analysis failed');
    p.log.error('Failed to run claude CLI. Make sure it\'s installed and configured.');
    process.exit(1);
  }

  p.outro('Doctor complete');
}

function help() {
  console.log(`dot v${VERSION}`);
  console.log("");
  console.log("Usage: dot <command>");
  console.log("");
  console.log("Commands:");
  console.log("  init            First-time setup wizard");
  console.log("    --from <url>  Clone from GitHub repo");
  console.log("    --force, -f   Overwrite existing config");
  console.log("    --ignore <p>  Skip pattern during scan (repeatable)");
  console.log("    --dry-run     Preview changes without making them");
  console.log("  install         Create symlinks for all configs (blocks if deps missing)");
  console.log("    --force, -f   Bypass dependency check");
  console.log("  uninstall       Remove symlinks");
  console.log("  sync            Update brewfile from installed packages");
  console.log("  config          Review and update dot settings");
  console.log(
    "  doctor          Analyze dotfiles with Claude and suggest fixes",
  );
  console.log("  ignore [path]   Ignore path from doctor analysis");
  console.log("    --list        List all ignored paths");
  console.log("    --unignore <path>  Remove path from ignore list");
  console.log("    --cwd         Start browser from current directory");
  console.log("  link [path]     Add file to dotfiles repo and create symlink");
  console.log("    --as <path>   Destination in repo (e.g., --as zsh/aliases)");
  console.log("    --cwd         Start browser from current directory");
  console.log("    --force, -f   Skip confirmations");
  console.log("  move [source]   Move a linked file to different location");
  console.log("    --self        Move the dotfiles folder itself");
  console.log("    --force, -f   Skip confirmations");
  console.log("  update          Check for and install updates");
  console.log("  help            Show this help message");
  console.log("");
  console.log("Global options:");
  console.log("  --dotfiles <path>  Override dotfiles location");
  console.log("  --version, -v      Show version number");
  console.log("  --help, -h         Show this help message");
}

// CLI entry point
async function main() {
  const globalOptions = parseGlobalArgs();

  // Find the command (first positional arg after global flags)
  // parseArgs with allowPositionals will put the command in positionals
  const args = Bun.argv.slice(2);
  let command: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("-") && !arg.startsWith("--")) {
      // Check if previous arg was --dotfiles (needs value)
      const prevIdx = i - 1;
      if (prevIdx >= 0 && args[prevIdx] === "--dotfiles") {
        continue; // This is the value for --dotfiles, not the command
      }
      command = arg;
      break;
    }
  }

  // Handle --version flag
  if (args.includes("--version") || args.includes("-v")) {
    console.log(`dot v${VERSION}`);
    return;
  }

  // Handle --help flag
  if (args.includes("--help") || args.includes("-h")) {
    help();
    return;
  }

  // Handle commands that don't require initialization
  if (command === "help" || command === undefined) {
    help();
    return;
  }

  // Update command doesn't require initialization
  if (command === "update") {
    await update();
    return;
  }

  // Init command runs before initialization check
  if (command === "init") {
    const initIdx = args.indexOf("init");
    const initArgs = initIdx >= 0 ? args.slice(initIdx + 1) : [];
    const initOptions = parseInitArgs(initArgs);
    await init(initOptions);
    return;
  }

  // Initialize dot (get dotfiles path and config)
  const initResult = await initializeDot(globalOptions);

  // All other commands require initialization
  if (!initResult) {
    console.error("Error: Could not find dotfiles location.");
    console.error("Run 'dot init' to set up, or use --dotfiles <path> to specify.");
    process.exit(1);
  }

  const { dotfilesPath } = initResult;
  let dotConfig = initResult.config;
  const config = createConfig(dotfilesPath, dotConfig.links);

  switch (command) {
    case "install": {
      const { force } = parseInstallArgs();
      if (await preflightCheck(force, dotConfig)) {
        await install(config);
      } else {
        process.exit(1);
      }
      break;
    }
    case "uninstall":
      await uninstall(config);
      break;
    case "config": {
      const configIdx = args.indexOf("config");
      const configArgs = configIdx >= 0 ? args.slice(configIdx + 1) : [];
      const sub = configArgs[0];

      let section: "brewfile" | "auto-commit" | "patterns" | "deps" | undefined;
      if (sub === undefined) {
        section = undefined;
      } else if (sub === "brewfile") {
        section = "brewfile";
      } else if (sub === "auto-commit" || sub === "autocommit") {
        section = "auto-commit";
      } else if (sub === "patterns") {
        section = "patterns";
      } else if (sub === "deps" || sub === "dependencies") {
        section = "deps";
      } else {
        console.error(`Unknown config section: ${sub}`);
        console.error("Usage: dot config [brewfile|auto-commit|patterns|deps]");
        process.exit(1);
      }

      const home = Bun.env.HOME;
      if (!home) throw new Error("HOME environment variable is not set");

      const kind = await detectConfigFileKind(dotfilesPath);
      await runConfigWizard({
        dotfilesPath,
        dotConfig,
        home,
        configFileKind: kind,
        section,
      });
      break;
    }
    case "sync": {
      // Check for flag/subcommand
      const syncIdx = args.indexOf("sync");
      const syncArgs = syncIdx >= 0 ? args.slice(syncIdx + 1) : [];

      const parsed = parseSyncArgs(syncArgs);
      if (!parsed.ok) {
        console.error(parsed.error);
        console.error("Use: dot config brewfile");
        process.exit(1);
      }

      // If brewfile sync isn't configured yet, offer to configure on first sync.
      if (!dotConfig.brewfile) {
        const proceed = await p.confirm({
          message: "Brewfile sync is not configured. Configure now?",
          initialValue: true,
        });
        if (p.isCancel(proceed) || proceed === false) {
          p.outro("Cancelled");
          return;
        }

        const home = Bun.env.HOME;
        if (!home) throw new Error("HOME environment variable is not set");
        const kind = await detectConfigFileKind(dotfilesPath);
        const r = await runBrewfileConfigFlow({
          dotfilesPath,
          dotConfig,
          configFileKind: kind,
          home,
          intro: true,
        });
        if (r !== "written") {
          // User cancelled or chose not to write; don't run sync.
          return;
        }
        dotConfig = (await loadConfig(dotfilesPath)) ?? dotConfig;
      }

      await sync(config, dotConfig);
      break;
    }
    case "ignore": {
      const ignoreIdx = args.indexOf("ignore");

      // Check for --list flag
      if (args.includes("--list")) {
        await listIgnored();
        break;
      }

      // Check for --unignore flag
      const unignoreIdx = args.indexOf("--unignore");
      if (unignoreIdx !== -1) {
        const pathArg = args[unignoreIdx + 1];
        if (!pathArg || pathArg.startsWith("--")) {
          p.log.error("Usage: dot ignore --unignore <path>");
          process.exit(1);
        }
        await unignorePath(pathArg, config.home);
        break;
      }

      // Default: ignore a path (same as doctor ignore)
      const ignoreOptions: DoctorIgnoreOptions = {};

      if (args.includes("--cwd")) {
        ignoreOptions.cwd = true;
      }

      // Path is argument after "ignore" if not a flag
      const pathArg = args[ignoreIdx + 1];
      if (pathArg && !pathArg.startsWith("--")) {
        ignoreOptions.path = pathArg;
      }

      await doctorIgnore(config, ignoreOptions);
      break;
    }
    case "doctor": {
      // Check for subcommand
      const doctorIdx = args.indexOf("doctor");
      const subcommand = doctorIdx >= 0 ? args[doctorIdx + 1] : undefined;

      if (subcommand === "ignore") {
        // Parse ignore options (backward compatibility)
        const ignoreOptions: DoctorIgnoreOptions = {};
        const pathArg = args[doctorIdx + 2];

        // Check for --cwd flag
        if (args.includes("--cwd")) {
          ignoreOptions.cwd = true;
        }

        // Path is the argument after "ignore" if it doesn't start with --
        if (pathArg && !pathArg.startsWith("--")) {
          ignoreOptions.path = pathArg;
        }

        await doctorIgnore(config, ignoreOptions);
      } else {
        await doctor(config, dotConfig);
      }
      break;
    }
    case "link": {
      // Parse link-specific args (everything after "link")
      const linkIdx = args.indexOf("link");
      const linkArgs = linkIdx >= 0 ? args.slice(linkIdx + 1) : [];
      const { targetPath, options: linkOptions } = parseLinkArgs(linkArgs);

      // No path required - will open browser if not provided
      await link(targetPath, dotfilesPath, dotConfig, linkOptions);
      break;
    }
    case "move": {
      // Parse move-specific args (everything after "move")
      const moveIdx = args.indexOf("move");
      const moveArgs = moveIdx >= 0 ? args.slice(moveIdx + 1) : [];
      const { path: movePath, options: moveOptions } = parseMoveArgs(moveArgs);

      if (moveOptions.self) {
        // Move the dotfiles folder itself
        if (!movePath) {
          p.log.error("Usage: dot move --self <destination>");
          process.exit(1);
        }
        await moveSelf(movePath, dotfilesPath, dotConfig, moveOptions);
      } else {
        // Move a symlinked file to a different location
        await move(movePath, dotfilesPath, dotConfig, moveOptions);
      }
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      help();
      process.exit(1);
      break;
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});

// Internal test exports - not part of public API
export const __test = {
  pathExists,
  tryRealpath,
  resolveSymlinkTarget,
  linksToExpectedResolved,
  readReviewedPaths,
  writeReviewedPaths,
  markAsReviewed,
  isIgnored,
  getActiveReviewed,
  getExpiredPaths,
  getReviewedFilePath,
};

// Re-export config and state modules
export { loadConfig, writeConfig, updateConfigLinks, removeConfigLink } from "./src/config";
export { getDotfilesPath, loadState, saveState } from "./src/state";
export { link, parseLinkArgs } from "./src/link";
export { move, moveSelf, parseMoveArgs } from "./src/move";
export { update } from "./src/update";
export { VERSION };
export type { DotConfig, LinkMap, DotState } from "./src/types";
export type { LinkOptions } from "./src/link";
export type { MoveOptions } from "./src/move";

// Exports for testing
export {
  // Types
  type Config,
  type SymlinkStatus,
  type Dotfile,
  type Dependency,
  type DependencyStatus,
  type BrewfilePackage,
  type BrewfileSyncStatus,
  type HardcodedPathIssue,
  type GlobalOptions,
  type ReviewedEntry,
  type ReviewedPaths,
  // Functions
  createConfig,
  getLegacyLinks,
  parseGlobalArgs,
  initializeDot,
  install,
  uninstall,
  getSymlinkStatus,
  getDotfiles,
  isPathManaged,
  getRepoFiles,
  getGitStatus,
  normalizePath,
  isIgnored,
  getActiveReviewed,
  getExpiredPaths,
  getReviewedFilePath,
  isToolInstalled,
  checkDependencies,
  parseBrewfile,
  getInstalledPackages,
  checkBrewfileSync,
  parseInstallArgs,
  preflightCheck,
  getArchitecture,
  scanForHardcodedPaths,
  checkNerdFont,
};
