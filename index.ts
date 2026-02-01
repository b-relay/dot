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
import { loadConfig, writeConfig, updateConfigLinks } from "./src/config";
import { getDotfilesPath, loadState, saveState } from "./src/state";
import { track, parseTrackArgs } from "./src/track";
import type { TrackOptions } from "./src/track";
import { init, parseInitArgs } from "./src/init";
import type { InitOptions } from "./src/init";
import { move } from "./src/move";
import type { MoveOptions } from "./src/move";
import { update } from "./src/update";
import type { DotConfig, LinkMap, DotState } from "./src/types";

const VERSION = "0.1.0";
const REVIEW_EXPIRY_DAYS = 90;

const DEPENDENCIES: readonly Dependency[] = [
  // Required - shell will error without these
  { name: "brew", required: true, description: "Homebrew package manager" },
  { name: "starship", required: true, brewPackage: "starship", description: "Shell prompt" },
  { name: "cargo", required: true, description: "Rust toolchain (install via rustup)" },
  { name: "fnm", required: true, brewPackage: "fnm", description: "Node version manager" },
  { name: "zoxide", required: true, brewPackage: "zoxide", description: "Smart cd replacement" },

  // Recommended - enhance experience
  { name: "fzf", required: false, brewPackage: "fzf", description: "Fuzzy finder" },
  { name: "vivid", required: false, brewPackage: "vivid", description: "LS_COLORS generator" },
  { name: "eza", required: false, brewPackage: "eza", description: "Modern ls replacement" },
  { name: "bun", required: false, brewPackage: "oven-sh/bun/bun", description: "JavaScript runtime" },
] as const;

// Config type for dependency injection
type Config = {
  dotfiles: string;
  dotconfig: string;
  home: string;
  reviewedFile: string;
  links: Record<string, string>;
};

type Dependency = {
  name: string;
  required: boolean;
  brewPackage?: string;
  description: string;
};

type DependencyStatus = {
  name: string;
  required: boolean;
  installed: boolean;
  brewPackage?: string;
  description: string;
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

type ParsedMoveArgs = {
  targetPath: string | undefined;
  options: MoveOptions;
};

export function parseMoveArgs(args: string[]): ParsedMoveArgs {
  const { values, positionals } = parseArgs({
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

  const force = values.force === true || values.force === "true";

  return {
    targetPath: positionals[0],
    options: { force },
  };
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
  return {
    dotfiles: dotfilesPath,
    dotconfig,
    home: resolvedHome,
    reviewedFile: `${dotfilesPath}/.doctor-reviewed.json`,
    links,
  };
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

async function checkDependencies(): Promise<DependencyStatus[]> {
  return Promise.all(
    DEPENDENCIES.map(async (dep) => ({
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

async function preflightCheck(force: boolean): Promise<boolean> {
  if (force) {
    console.log("Warning: Bypassing dependency check (--force)");
    return true;
  }

  const deps = await checkDependencies();
  const missingRequired = deps.filter(d => d.required && !d.installed);

  if (missingRequired.length === 0) {
    return true;
  }

  console.error("Error: Missing required dependencies:\n");
  for (const dep of missingRequired) {
    const hint = dep.brewPackage
      ? ` (brew install ${dep.brewPackage})`
      : "";
    console.error(`  \u2718 ${dep.name}${hint}`);
  }
  console.error("\nInstall dependencies first, or use --force to bypass this check.");
  return false;
}

// --- End dependency checking helpers ---

// --- Brewfile sync helpers ---

async function parseBrewfile(config: Config): Promise<BrewfilePackage[]> {
  const brewfilePath = `${config.dotfiles}/homebrew/brewfile`;
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

async function checkBrewfileSync(config: Config): Promise<BrewfileSyncStatus> {
  const [brewfilePackages, installedPackages] = await Promise.all([
    parseBrewfile(config),
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

type ReviewedPaths = Record<string, string>; // path -> date reviewed

async function readReviewedPaths(config: Config): Promise<ReviewedPaths> {
  const file = Bun.file(config.reviewedFile);
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

async function writeReviewedPaths(
  config: Config,
  paths: ReviewedPaths,
): Promise<void> {
  // Ensure parent directory exists
  await mkdir(dirname(config.reviewedFile), { recursive: true });
  await Bun.write(config.reviewedFile, JSON.stringify(paths, null, 2) + "\n");
}

function isReviewedRecently(reviewDate: string, now: Date = new Date()): boolean {
  const reviewed = new Date(reviewDate);
  const diffDays = (now.getTime() - reviewed.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays < REVIEW_EXPIRY_DAYS;
}

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

export function filterBrewfile(output: string): string {
  return output
    .split("\n")
    .filter(line => {
      const t = line.trimStart();
      if (t.startsWith('vscode "')) return false;
      if (t.startsWith('cargo "')) return false;
      if (t.startsWith('go "')) return false;
      return true;
    })
    .join("\n");
}

async function sync(config: Config) {
  console.log("Syncing dotfiles...");

  // Update brewfile
  console.log("\nUpdating brewfile...");

  // Run brew bundle dump to stdout
  const output =
    await $`brew bundle dump --describe -f --file=/dev/stdout`.text();

  // Filter out unwanted lines (vscode, cargo, go packages)
  const filtered = filterBrewfile(output);

  // Write filtered output
  await Bun.write(`${config.dotfiles}/homebrew/brewfile`, filtered);

  // Show git status
  console.log("\nGit status:");
  await $`git -C ${config.dotfiles} status -s`;

  console.log("\nDone! Review changes and commit if needed.");
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

// Core logic for marking a path as reviewed, with injectable date for testing
async function markAsReviewed(
  config: Config,
  normalizedPath: string,
  today: string = new Date().toISOString().split("T")[0]!,
): Promise<void> {
  const reviewed = await readReviewedPaths(config);
  reviewed[normalizedPath] = today;
  await writeReviewedPaths(config, reviewed);
}

async function review(config: Config, pathArg: string | undefined) {
  if (!pathArg) {
    console.log("Usage: dot review <path>");
    console.log("");
    console.log(
      "Mark a path as reviewed so doctor won't recommend it for 90 days.",
    );
    console.log("");
    console.log("Examples:");
    console.log("  dot review ~/.config/gh");
    console.log("  dot review ~/.gitignore_global");
    process.exit(1);
  }

  const normalizedPath = normalizePath(config.home, pathArg);
  const today = new Date().toISOString().split("T")[0]!;
  await markAsReviewed(config, normalizedPath, today);

  console.log(`Marked as reviewed: ${normalizedPath}`);
  console.log(
    `This path will be excluded from doctor recommendations until ${getExpiryDate(today)}`,
  );
}

function getExpiryDate(reviewDate: string): string {
  const date = new Date(reviewDate);
  date.setDate(date.getDate() + REVIEW_EXPIRY_DAYS);
  return date.toISOString().split("T")[0]!;
}

async function doctor(config: Config) {
  console.log("Running dotfiles doctor...\n");

  // Check dependencies first (fast, no API calls)
  console.log("Checking dependencies...");
  const [depStatus, fontInstalled] = await Promise.all([
    checkDependencies(),
    checkNerdFont(),
  ]);
  printDependencyStatus(depStatus, fontInstalled);
  printBrewInstallCommand(depStatus);

  console.log("");  // Blank line before next section

  // Check brewfile sync
  console.log("Checking brewfile sync...");
  const brewfileStatus = await checkBrewfileSync(config);
  printBrewfileStatus(brewfileStatus, config);

  console.log("");  // Blank line before next section

  // Check architecture and hardcoded paths
  const architecture = getArchitecture();
  const pathIssues = await scanForHardcodedPaths(config);
  printArchitectureStatus(architecture, pathIssues);

  console.log("");  // Blank line before next section

  // Load reviewed paths
  const reviewedPaths = await readReviewedPaths(config);
  const activeReviewed: Record<string, string> = {};
  const expiredReviewed: string[] = [];

  for (const [path, date] of Object.entries(reviewedPaths)) {
    if (isReviewedRecently(date)) {
      activeReviewed[path] = date;
    } else {
      expiredReviewed.push(path);
    }
  }

  // Clean up expired entries
  if (expiredReviewed.length > 0) {
    await writeReviewedPaths(config, activeReviewed);
  }

  // Gather state
  console.log("Gathering symlink status...");
  const symlinkStatus = await getSymlinkStatus(config);

  console.log("Gathering repo files...");
  const repoFiles = await getRepoFiles(config);

  console.log("Scanning dotfiles...");
  const dotfiles = await getDotfiles(config);

  console.log("Checking git status...");
  const gitStatus = await getGitStatus(config);

  console.log("\nAnalyzing with Claude...\n");

  // Build context string
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

Focus on:
1. Symlink problems (broken, missing, wrong-target, or not-symlink status)
2. Uncommitted git changes
3. Dotfiles that might be worth tracking (look at entries with isManaged: false)
4. Cleanup suggestions (old configs, orphaned files, unused app data, backup files, etc.)
5. Architecture-specific issues (hardcoded Homebrew paths that won't work on other Mac architectures)

IMPORTANT: The "reviewedPaths" field contains paths the user has already reviewed and decided not to track. Do NOT recommend these paths again unless there's a specific issue with them (not just "consider tracking"). These paths have been intentionally left untracked.

Format your response as a brief, actionable report. Group cleanup suggestions separately from tracking recommendations. If everything looks good, say so.

Data:`;

  try {
    await $`claude -p ${prompt + "\n\n" + context} --model haiku`;
  } catch (error) {
    console.error(
      "Failed to run claude CLI. Make sure it's installed and configured.",
    );
    process.exit(1);
  }
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
  console.log("  install         Create symlinks for all configs (blocks if deps missing)");
  console.log("    --force, -f   Bypass dependency check");
  console.log("  uninstall       Remove symlinks");
  console.log("  sync            Update brewfile and show git status");
  console.log(
    "  doctor          Analyze dotfiles with Claude and suggest fixes",
  );
  console.log(
    "  review <path>   Mark a path as reviewed (excludes from doctor for 90 days)",
  );
  console.log("  track <path>    Add file to dotfiles repo and create symlink");
  console.log("    --as <path>   Specify destination path in repo (e.g., --as zsh/aliases)");
  console.log("    --force, -f   Skip confirmations");
  console.log("  move <path>     Relocate dotfiles folder to new location");
  console.log("    --force, -f   Override if destination exists");
  console.log("  update          Check for and install updates");
  console.log("  --version       Show version number");
}

// CLI entry point
async function main() {
  const globalOptions = parseGlobalArgs();

  // Find the command (first positional arg after global flags)
  // parseArgs with allowPositionals will put the command in positionals
  const args = Bun.argv.slice(2);
  let command: string | undefined;
  for (const arg of args) {
    if (!arg.startsWith("-") && !arg.startsWith("--")) {
      // Check if previous arg was --dotfiles (needs value)
      const prevIdx = args.indexOf(arg) - 1;
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

  const { dotfilesPath, config: dotConfig } = initResult;
  const config = createConfig(dotfilesPath, dotConfig.links);

  switch (command) {
    case "install": {
      const { force } = parseInstallArgs();
      if (await preflightCheck(force)) {
        await install(config);
      } else {
        process.exit(1);
      }
      break;
    }
    case "uninstall":
      await uninstall(config);
      break;
    case "sync":
      await sync(config);
      break;
    case "doctor":
      await doctor(config);
      break;
    case "review": {
      // Find the path argument (after "review")
      const reviewIdx = args.indexOf("review");
      const pathArg = reviewIdx >= 0 ? args[reviewIdx + 1] : undefined;
      await review(config, pathArg);
      break;
    }
    case "track": {
      // Parse track-specific args (everything after "track")
      const trackIdx = args.indexOf("track");
      const trackArgs = trackIdx >= 0 ? args.slice(trackIdx + 1) : [];
      const { targetPath, options: trackOptions } = parseTrackArgs(trackArgs);

      if (!targetPath) {
        console.log("Usage: dot track <path> [--as <dest>] [--force]");
        console.log("");
        console.log("Add a file or directory to your dotfiles repo.");
        console.log("");
        console.log("Options:");
        console.log("  --as <path>   Destination path in repo (e.g., --as zsh/aliases)");
        console.log("  --force, -f   Skip confirmations and auto-backup on conflict");
        process.exit(1);
      }

      await track(targetPath, dotfilesPath, dotConfig, trackOptions);
      break;
    }
    case "move": {
      // Parse move-specific args (everything after "move")
      const moveIdx = args.indexOf("move");
      const moveArgs = moveIdx >= 0 ? args.slice(moveIdx + 1) : [];
      const { targetPath: newPath, options: moveOptions } = parseMoveArgs(moveArgs);

      if (!newPath) {
        console.log("Usage: dot move <path> [--force]");
        console.log("");
        console.log("Relocate dotfiles folder to a new location.");
        console.log("All symlinks will be updated to point to the new location.");
        console.log("");
        console.log("Options:");
        console.log("  --force, -f   Override if destination exists");
        console.log("");
        console.log("Examples:");
        console.log("  dot move ~/dotfiles");
        console.log("  dot move /path/to/new/location --force");
        process.exit(1);
      }

      // Check if running from inside dotfiles folder
      const cwd = process.cwd();
      if (cwd.startsWith(dotfilesPath) || cwd === dotfilesPath) {
        console.log("Warning: You are running this command from inside the dotfiles folder.");
        console.log("After the move, your current directory will become invalid.");
        console.log("");
      }

      await move(newPath, dotfilesPath, dotConfig, moveOptions);
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
};

// Re-export config and state modules
export { loadConfig, writeConfig, updateConfigLinks } from "./src/config";
export { getDotfilesPath, loadState, saveState } from "./src/state";
export { track, parseTrackArgs } from "./src/track";
export { move } from "./src/move";
export { update } from "./src/update";
export { VERSION };
export type { DotConfig, LinkMap, DotState } from "./src/types";
export type { TrackOptions } from "./src/track";
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
  // Constants
  REVIEW_EXPIRY_DAYS,
  DEPENDENCIES,
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
  isReviewedRecently,
  getExpiryDate,
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
