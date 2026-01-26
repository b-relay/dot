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

  return {
    force: values.force ?? false,
  };
}

function createConfig(home?: string): Config {
  const resolvedHome = home ?? Bun.env.HOME;
  if (!resolvedHome) {
    throw new Error("HOME environment variable is not set");
  }
  const dotfiles = `${resolvedHome}/.dotfiles`;
  const dotconfig = `${resolvedHome}/.config`;
  return {
    dotfiles,
    dotconfig,
    home: resolvedHome,
    reviewedFile: `${dotfiles}/.doctor-reviewed.json`,
    links: {
      [`${dotfiles}/zsh/zshenv`]: `${resolvedHome}/.zshenv`,
      [`${dotfiles}/zsh/zprofile`]: `${dotconfig}/zsh/.zprofile`,
      [`${dotfiles}/zsh/zshrc`]: `${dotconfig}/zsh/.zshrc`,
      [`${dotfiles}/zsh/starship.toml`]: `${dotconfig}/starship.toml`,
      [`${dotfiles}/git/.gitconfig`]: `${dotconfig}/git/config`,
      [`${dotfiles}/tmux/tmux.conf`]: `${dotconfig}/tmux/tmux.conf`,
      [`${dotfiles}/vscode/settings.json`]: `${resolvedHome}/Library/Application Support/Code/User/settings.json`,
      [`${dotfiles}/jj/config.toml`]: `${dotconfig}/jj/config.toml`,
    },
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
  console.log("Usage: dot <command>");
  console.log("");
  console.log("Commands:");
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
}

// CLI entry point
const config = createConfig();
const command = Bun.argv[2];

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
  case "review":
    await review(config, Bun.argv[3]);
    break;
  default:
    help();
    break;
}

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
  // Constants
  REVIEW_EXPIRY_DAYS,
  DEPENDENCIES,
  // Functions
  createConfig,
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
