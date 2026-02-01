# Stack Research: v2.1 Features

**Project:** dot CLI
**Researched:** 2026-02-01
**Confidence:** HIGH

## Executive Summary

The v2.1 feature set (self-update, enhanced diagnostics, interactive brewfile sync) requires **zero new dependencies**. All functionality can be implemented using existing Bun runtime APIs, Node.js built-ins, and the already-included `@clack/prompts` library.

**Key finding:** Bun's built-in `fetch()` API and Node.js file system primitives provide everything needed. The main technical challenge is binary replacement on macOS, which is solved via atomic rename.

---

## Self-Update Stack

### GitHub Releases API

**Use Bun's built-in fetch()** — no library needed.

Bun supports the standard Web Fetch API out of the box. For GitHub releases:

```typescript
// Fetch latest release metadata
const response = await fetch(
  'https://api.github.com/repos/owner/repo/releases/latest'
);
const release = await response.json();

// Extract version and download URL
const latestVersion = release.tag_name; // e.g., "v0.2.0"
const asset = release.assets.find(a =>
  a.name.includes(process.arch) && a.name.includes('darwin')
);
const downloadUrl = asset.browser_download_url;
```

**Pattern:**
1. Fetch `https://api.github.com/repos/{owner}/{repo}/releases/latest`
2. Parse JSON to get `tag_name` (version) and `assets` array
3. Filter assets by platform (`darwin`) and architecture (`arm64` or `x86_64`)
4. Download binary from `browser_download_url`

**No authentication needed** for public repos. GitHub API rate limit: 60 req/hour unauthenticated, which is sufficient for version checks.

**Sources:**
- [GitHub Releases API Documentation](https://docs.github.com/en/rest/releases)
- [One Liner to Download Latest Release](https://gist.github.com/steinwaywhw/a4cd19cda655b8249d908261a62687f8)
- [Bun fetch capabilities](https://bun.sh/docs/api/http)

### Binary Download

**Use Bun's fetch() with arrayBuffer()** to download binary.

```typescript
// Download binary
const binResponse = await fetch(downloadUrl);
const binData = await binResponse.arrayBuffer();

// Write to temp file
const tmpPath = `/tmp/dot-update-${Date.now()}`;
await Bun.write(tmpPath, binData);
```

Bun's `Bun.write()` handles ArrayBuffer directly — no conversion needed.

### Binary Replacement Strategy

**Use atomic rename** via Node.js `fs.rename()`.

On macOS/Unix, `rename(2)` is atomic. The binary replacement pattern:

```typescript
import { rename, chmod } from 'node:fs/promises';

// 1. Download new binary to temp location
const tmpPath = '/tmp/dot-new';
await Bun.write(tmpPath, downloadedBinary);
await chmod(tmpPath, 0o755); // Make executable

// 2. Get current binary path
const currentPath = process.execPath; // e.g., ~/.local/bin/dot

// 3. Create backup
const backupPath = `${currentPath}.backup`;
await rename(currentPath, backupPath);

// 4. Atomically replace binary
try {
  await rename(tmpPath, currentPath);
  // Success - can delete backup
  await unlink(backupPath);
} catch (error) {
  // Rollback on failure
  await rename(backupPath, currentPath);
  throw error;
}
```

**Why this works on macOS:**
- `rename()` is atomic — the file is never in an intermediate state
- Running process holds file descriptor, so replacement doesn't affect current execution
- New invocations use the new binary

**Verification step:** After replacement, spawn new process and check version:
```typescript
const result = await $`${currentPath} --version`;
if (!result.text().includes(expectedVersion)) {
  // Rollback
}
```

**Sources:**
- [Self-upgrade binary in Golang](https://gist.github.com/fenollp/7e31e6462b10c96aef443351bce6aea7) (pattern applies to Bun)
- [Bun upgrade issues](https://github.com/oven-sh/bun/issues/5727) (avoid pitfalls)

### Version Comparison

**Use simple semver comparison** — no library needed for basic `v0.x.y` format.

```typescript
function parseVersion(v: string): number[] {
  return v.replace(/^v/, '').split('.').map(Number);
}

function isNewer(current: string, latest: string): boolean {
  const [c1, c2, c3] = parseVersion(current);
  const [l1, l2, l3] = parseVersion(latest);

  if (l1 > c1) return true;
  if (l1 < c1) return false;
  if (l2 > c2) return true;
  if (l2 < c2) return false;
  return l3 > c3;
}
```

For this project's `v0.x.y` scheme, this is sufficient. If complex pre-release handling is needed later, add `semver` package (2.4KB).

---

## Enhanced Diagnostics Stack

### Tool Version Detection

**Use Bun's shell integration** `$` template literal already in use.

Pattern for getting tool versions:

```typescript
async function getToolVersion(command: string): Promise<string | null> {
  try {
    // Try --version first (most common)
    const result = await $`${command} --version`.quiet().nothrow();
    if (result.exitCode === 0) {
      // Parse first line, extract version number
      const firstLine = result.text().trim().split('\n')[0];
      return firstLine; // or parse further if needed
    }

    // Some tools use -v
    const result2 = await $`${command} -v`.quiet().nothrow();
    if (result2.exitCode === 0) {
      return result2.text().trim().split('\n')[0];
    }

    return null;
  } catch {
    return null;
  }
}

// Usage
const versions = {
  git: await getToolVersion('git'),
  zsh: await getToolVersion('zsh'),
  brew: await getToolVersion('brew'),
  starship: await getToolVersion('starship'),
};
```

**Already in use:** The `isToolInstalled()` function (line 281) uses `which` via Bun shell. Extend this pattern for version detection.

### Homebrew Package Versions

**Use `brew info --json=v2`** for structured version data.

```typescript
async function getBrewPackageInfo(formula: string): Promise<{
  installed: string | null;
  latest: string;
} | null> {
  try {
    const result = await $`brew info --json=v2 ${formula}`.quiet();
    const data = JSON.parse(result.text());

    const pkg = data.formulae?.[0] || data.casks?.[0];
    if (!pkg) return null;

    return {
      installed: pkg.installed?.[0]?.version || null,
      latest: pkg.versions?.stable || pkg.version,
    };
  } catch {
    return null;
  }
}
```

**Sources:**
- [Homebrew JSON API Documentation](https://formulae.brew.sh/docs/api/)
- [Querying Brew](https://docs.brew.sh/Querying-Brew)

### iTerm2 Detection

**Check `TERM_PROGRAM` environment variable** — already available in `Bun.env`.

```typescript
function isITerm2(): boolean {
  // Primary detection
  if (Bun.env.TERM_PROGRAM === 'iTerm.app') {
    return true;
  }

  // Fallback for tmux sessions
  if (Bun.env.ITERM_SESSION_ID !== undefined) {
    return true;
  }

  return false;
}

function getTerminalInfo(): {
  name: string;
  version?: string;
} {
  const program = Bun.env.TERM_PROGRAM || 'unknown';
  const version = Bun.env.TERM_PROGRAM_VERSION;

  return { name: program, version };
}
```

**Known issue:** When using tmux within iTerm2, `TERM_PROGRAM` is set to `tmux`. Use `ITERM_SESSION_ID` as fallback.

**Sources:**
- [Canonical iTerm2 detection](https://groups.google.com/g/iterm2-discuss/c/MpOWDIn6QTs)
- [iTerm2 Variables Documentation](https://iterm2.com/documentation-variables.html)

### macOS Version Detection

**Use `sw_vers` command** — built into macOS.

```typescript
async function getMacOSVersion(): Promise<{
  productName: string;
  productVersion: string;
  buildVersion: string;
}> {
  const name = await $`sw_vers -productName`.text();
  const version = await $`sw_vers -productVersion`.text();
  const build = await $`sw_vers -buildVersion`.text();

  return {
    productName: name.trim(),
    productVersion: version.trim(),
    buildVersion: build.trim(),
  };
}
```

---

## Interactive Brewfile Sync Stack

### Dynamic Type Discovery

**Use `brew bundle dump` to discover package types** instead of hardcoding.

Current approach (line 777) hardcodes `["vscode"]` as default exclusions. For v2.1, dynamically discover what types exist:

```typescript
async function discoverBrewfileTypes(): Promise<string[]> {
  // Dump current state to stdout
  const output = await $`brew bundle dump --describe -f --file=/dev/stdout`.text();

  // Extract unique type prefixes
  const types = new Set<string>();
  for (const line of output.split('\n')) {
    const match = line.match(/^(\w+)\s+"/);
    if (match) {
      types.add(match[1]);
    }
  }

  return Array.from(types).sort();
}
```

This discovers: `brew`, `tap`, `cask`, `mas`, `vscode`, `whalebrew`, etc.

### Interactive Selection UI

**Use `@clack/prompts` multiselect** — already a dependency (line 19, 25).

```typescript
import * as p from '@clack/prompts';

async function selectExclusions(): Promise<string[]> {
  // Discover available types
  const availableTypes = await discoverBrewfileTypes();

  // Filter out core types that shouldn't be excluded
  const excludableTypes = availableTypes.filter(
    t => !['brew', 'tap', 'cask'].includes(t)
  );

  // Build options with descriptions
  const options = excludableTypes.map(type => ({
    value: type,
    label: type,
    hint: getTypeDescription(type),
  }));

  // Show multiselect
  const selected = await p.multiselect({
    message: 'Select package types to exclude:',
    options,
    initialValues: ['vscode'], // current default
    required: false,
  });

  if (p.isCancel(selected)) {
    return [];
  }

  return selected as string[];
}

function getTypeDescription(type: string): string {
  const descriptions: Record<string, string> = {
    vscode: 'VS Code extensions',
    mas: 'Mac App Store apps',
    whalebrew: 'Whalebrew containers',
  };
  return descriptions[type] || `${type} packages`;
}
```

**Already implemented:** `syncConfig()` function (line 808) uses this pattern. Extend it to discover types dynamically.

**Sources:**
- [@clack/prompts npm](https://www.npmjs.com/package/@clack/prompts)
- [Prompts documentation](https://bomb.sh/docs/clack/packages/prompts/)

---

## Recommendations

### Pattern: GitHub Release Check

```typescript
const GITHUB_REPO = 'brendonv/dotfiles'; // or separate dot CLI repo

async function checkForUpdate(): Promise<{
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  downloadUrl?: string;
} | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers: { 'User-Agent': 'dot-cli' } }
    );

    if (!response.ok) return null;

    const release = await response.json();
    const latestVersion = release.tag_name;

    // Filter assets for current platform
    const arch = process.arch; // 'arm64' or 'x64'
    const assetName = `dot-darwin-${arch}`;
    const asset = release.assets.find(a => a.name === assetName);

    return {
      hasUpdate: isNewer(VERSION, latestVersion),
      currentVersion: VERSION,
      latestVersion,
      downloadUrl: asset?.browser_download_url,
    };
  } catch (error) {
    console.warn('Failed to check for updates:', error.message);
    return null;
  }
}
```

### Pattern: Atomic Binary Replacement

```typescript
async function replaceBinary(downloadUrl: string): Promise<boolean> {
  const currentPath = process.execPath;
  const tmpPath = `/tmp/dot-${Date.now()}`;
  const backupPath = `${currentPath}.backup`;

  try {
    // Download
    const response = await fetch(downloadUrl);
    await Bun.write(tmpPath, await response.arrayBuffer());
    await chmod(tmpPath, 0o755);

    // Verify downloaded binary works
    const testResult = await $`${tmpPath} --version`.nothrow();
    if (testResult.exitCode !== 0) {
      throw new Error('Downloaded binary is invalid');
    }

    // Backup current
    await rename(currentPath, backupPath);

    // Replace (atomic)
    await rename(tmpPath, currentPath);

    // Cleanup
    await unlink(backupPath);

    return true;
  } catch (error) {
    // Rollback if backup exists
    if (await pathExists(backupPath)) {
      await rename(backupPath, currentPath);
    }

    // Cleanup temp file
    if (await pathExists(tmpPath)) {
      await unlink(tmpPath);
    }

    throw error;
  }
}
```

### Pattern: Diagnostic Collection

```typescript
type DiagnosticInfo = {
  system: {
    os: string;
    version: string;
    arch: string;
  };
  terminal: {
    program: string;
    version?: string;
    isITerm2: boolean;
  };
  tools: Record<string, {
    installed: boolean;
    version: string | null;
  }>;
  homebrew: {
    version: string | null;
    packages: Record<string, {
      installed: string | null;
      latest: string;
      needsUpdate: boolean;
    }>;
  };
};

async function gatherDiagnostics(): Promise<DiagnosticInfo> {
  const [osInfo, termInfo, toolVersions] = await Promise.all([
    getMacOSVersion(),
    getTerminalInfo(),
    getToolVersions(['git', 'zsh', 'starship', 'tmux']),
  ]);

  return {
    system: {
      os: osInfo.productName,
      version: osInfo.productVersion,
      arch: getArchitecture(),
    },
    terminal: {
      program: termInfo.name,
      version: termInfo.version,
      isITerm2: isITerm2(),
    },
    tools: toolVersions,
    // ... homebrew info
  };
}
```

---

## Anti-Recommendations

### DON'T Add: semver Library

**Why:** For this project's simple `v0.x.y` versioning, a 20-line comparison function is sufficient. The `semver` package adds 15KB for features we don't need (pre-release tags, ranges, coercion).

**When to reconsider:** If the project adopts complex versioning like `v1.2.3-beta.1+build.123`.

### DON'T Add: axios or node-fetch

**Why:** Bun's built-in `fetch()` is Web API compatible and faster than both. Adding `axios` (500KB) or `node-fetch` (70KB) is pure overhead.

**Bun fetch vs alternatives:**
- Native HTTP/2 support
- Automatic gunzip/brotli decompression
- Promise-based (no callback hell)
- Works identically in Bun and modern Node.js

**Source:** [Bun HTTP server documentation](https://bun.sh/docs/api/http)

### DON'T Add: prompts or inquirer

**Why:** Already using `@clack/prompts` (line 25). It's:
- Modern (async/await, not callback-based)
- Lightweight
- Better UX than older alternatives
- Already proven in `syncConfig()` (line 808)

**Avoid:** Mixing prompt libraries. Stick with `@clack/prompts` for consistency.

### DON'T Add: fs-extra

**Why:** Bun's `Bun.write()` and Node.js `fs/promises` provide all needed file operations:
- `Bun.write()` handles strings, buffers, arrays, blobs
- `fs/promises` has `rename`, `unlink`, `chmod`, `mkdir`
- No need for `fs-extra`'s `copy`, `move`, `ensureDir` (too high-level)

**Current usage is correct:** Line 1-12 imports exactly what's needed from `node:fs/promises`.

### DON'T Add: Update Frameworks (update-notifier, etc.)

**Why:** These frameworks are:
- Overweight (update-notifier: 1.2MB)
- Node.js-centric (check on every run, slow)
- Unnecessary for a tool that runs infrequently

**Our approach is better:**
- Explicit `dot update` command (user-initiated)
- Fast check (single GitHub API call)
- No background processes or package.json modifications

---

## Integration Checklist

Existing stack elements to leverage:

- [x] **Bun shell** (`$` template) — Use for all subprocess calls
- [x] **Node.js fs/promises** — Already imported, use `rename` for atomic replacement
- [x] **@clack/prompts** — Already installed, use `multiselect` for type selection
- [x] **Bun.env** — Access environment variables for terminal detection
- [x] **Bun.write()** — Use for binary downloads
- [x] **process.execPath** — Get current binary path
- [x] **process.arch** — Filter GitHub releases by architecture
- [x] **Existing VERSION constant** (line 27) — Use for version comparison

New patterns to implement:

- [ ] GitHub releases fetch with platform/arch filtering
- [ ] Atomic binary replacement with backup/rollback
- [ ] Version comparison logic
- [ ] Tool version detection (extend existing `isToolInstalled`)
- [ ] iTerm2 detection via `TERM_PROGRAM`
- [ ] Dynamic brewfile type discovery
- [ ] Enhanced diagnostics collection

**Zero new dependencies required.**

---

## Sources Summary

**GitHub API & Releases:**
- [GitHub Releases API](https://docs.github.com/en/rest/releases)
- [Download Latest Release Patterns](https://gist.github.com/steinwaywhw/a4cd19cda655b8249d908261a62687f8)
- [Bun HTTP/Fetch API](https://bun.sh/docs/api/http)

**Binary Replacement:**
- [Self-upgrade Binary Pattern (Go)](https://gist.github.com/fenollp/7e31e6462b10c96aef443351bce6aea7)
- [Bun Upgrade Pitfalls](https://github.com/oven-sh/bun/issues/5727)

**Diagnostics:**
- [iTerm2 Detection Methods](https://groups.google.com/g/iterm2-discuss/c/MpOWDIn6QTs)
- [iTerm2 Variables](https://iterm2.com/documentation-variables.html)
- [Homebrew JSON API](https://formulae.brew.sh/docs/api/)
- [Querying Brew](https://docs.brew.sh/Querying-Brew)

**Interactive Prompts:**
- [@clack/prompts npm](https://www.npmjs.com/package/@clack/prompts)
- [Clack Prompts Documentation](https://bomb.sh/docs/clack/packages/prompts/)
