# Architecture Research: v2.1 Features

**Project:** dot CLI
**Researched:** 2026-02-01
**Confidence:** MEDIUM (industry patterns verified, implementation details need prototyping)

## Executive Summary

v2.1 adds three enhancement features to the existing dot CLI: self-update, enhanced diagnostics, and brewfile sync improvements. All three integrate with the existing single-entry-point architecture (index.ts) while following the established pattern of extracting complex logic to `src/` modules.

**Key architectural decisions:**
1. **Self-update:** New `src/update.ts` module handles GitHub API interaction and binary replacement
2. **Diagnostics:** Extend existing doctor infrastructure with version extraction utilities in `src/diagnostics.ts`
3. **Brewfile sync:** Enhance existing brewfile code in index.ts with improved config storage and exclusion UI

## Current Architecture Summary

### Entry Point: index.ts
- Single-file command dispatch via switch statement
- All commands registered in main() function
- Helper functions inline for simple operations
- Complex operations extracted to `src/` modules

### Module Structure
```
dot/
├── index.ts          # Entry point, command dispatch, inline helpers
├── src/
│   ├── types.ts      # Zod schemas and type definitions
│   ├── config.ts     # Load/write dot.config.json
│   ├── state.ts      # Load/write ~/.config/dot/state.json
│   ├── init.ts       # init command implementation
│   ├── wizard.ts     # Interactive UI primitives
│   ├── link.ts       # link command implementation
│   ├── move.ts       # move command implementation
│   └── update.ts     # update command (currently stub)
└── tests/
    └── index.test.ts # Unit tests
```

### State Management
- **Global state:** `~/.config/dot/state.json` (dotfiles path, configured date)
- **Per-repo config:** `{dotfiles}/dot.config.json` (links, dependencies, brewfile config)
- **Doctor reviewed:** `{dotfiles}/.doctor-reviewed.json` (paths + review dates)

### Existing Patterns
- Bun APIs for all file operations (Bun.file, Bun.write, fs/promises)
- @clack/prompts for all interactive UI (spinner, select, multiselect)
- Bun.$ for subprocess execution (git, brew commands)
- Zod validation for all config and state files
- Export functions for testing (explicit export list at end of files)

---

## Self-Update Integration

### New Components

#### `src/update.ts` (replacing current stub)

**Purpose:** Fetch latest release from GitHub and replace current binary

**Responsibilities:**
- Check current version vs latest GitHub release
- Download appropriate binary for architecture (arm64/x86_64)
- Verify download integrity (checksum validation)
- Replace current binary atomically
- Handle rollback on failure

**Exports:**
```typescript
export async function update(): Promise<void>;
export async function checkForUpdates(): Promise<UpdateCheckResult>;
export async function downloadRelease(version: string, arch: string): Promise<string>;
export async function replaceBinary(newPath: string): Promise<void>;

export type UpdateCheckResult = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  downloadUrl?: string;
  checksumUrl?: string;
};
```

**Key patterns:**
- Use Bun.$ for self-replacement (mv with backup)
- Use Bun.file for download and checksum verification
- Use @clack/prompts spinner for download progress
- Store backup at ~/.config/dot/dot.backup for rollback

### Modified Components

#### `index.ts`
- Update VERSION constant when releases happen
- Keep existing switch case for "update" command
- No other changes needed (update() already imported)

### Data Flow

```
User runs: dot update
    ↓
main() dispatches to update()
    ↓
update() in src/update.ts:
    1. Fetch GitHub API: latest release metadata
    2. Compare versions (semver)
    3. Show update available (y/n prompt)
    4. Download binary for current arch
    5. Verify checksum
    6. Backup current binary → ~/.config/dot/dot.backup
    7. Replace binary atomically
    8. Verify new binary works (run --version)
    9. Delete backup OR rollback on failure
    ↓
Exit with success message
```

### GitHub Release Requirements

**Prerequisite:** GitHub Actions workflow to build and publish releases

**Binary naming convention:**
```
dot-v{version}-{os}-{arch}
dot-v0.2.0-darwin-arm64
dot-v0.2.0-darwin-x86_64
```

**Checksums:**
```
dot-v{version}-checksums.txt
```

**API endpoints used:**
- `GET /repos/{owner}/{repo}/releases/latest` - get latest version
- Download assets from release asset URLs

### Security Considerations

1. **Checksum validation:** SHA256 hash verification before replacement
2. **Atomic replacement:** Use rename() not copy to avoid partial writes
3. **Backup strategy:** Keep previous binary until new one verified
4. **Rollback mechanism:** If new binary fails --version check, restore backup

### Error Handling

| Error | Recovery |
|-------|----------|
| Network failure during download | Abort, keep current binary |
| Checksum mismatch | Abort, delete downloaded file |
| Binary replacement fails | Keep backup, show error |
| New binary doesn't work | Auto-rollback to backup |

---

## Diagnostics Integration

### New Components

#### `src/diagnostics.ts`

**Purpose:** Extract version information from command output

**Responsibilities:**
- Run commands with --version or -V flags
- Parse semver from output (first match)
- Handle non-standard version formats
- Return structured version info

**Exports:**
```typescript
export async function getToolVersion(command: string): Promise<ToolVersion | null>;
export async function getToolVersions(commands: string[]): Promise<ToolVersionMap>;
export function parseVersion(output: string): string | null;

export type ToolVersion = {
  tool: string;
  version: string;
  raw: string;  // Full output for debugging
};

export type ToolVersionMap = Record<string, ToolVersion | null>;
```

**Version detection strategy:**
1. Try `{command} --version` first (most common)
2. Try `{command} -V` if --version fails
3. Parse first semver-like string from output
4. Return null if no version found

**Regex pattern:**
```typescript
// Match: v1.2.3, 1.2.3, 1.2.3-beta, 1.2.3+build
const VERSION_REGEX = /v?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?)/;
```

### Modified Components

#### `index.ts` - doctor() function

**Enhancement:** Show version numbers alongside dependency status

**Before:**
```
Required:
  ✓ starship
  ✗ cargo (brew install rust)
```

**After:**
```
Required:
  ✓ starship (v1.18.2)
  ✗ cargo (install rust toolchain)
  ○ fnm (v1.37.0, update available: v1.38.0)
```

**Changes:**
```typescript
async function doctor(config: Config, dotConfig: DotConfig) {
  // ... existing code ...

  if (deps.length > 0) {
    s.start('Checking dependencies...');
    const [status, fontInstalled, versions] = await Promise.all([
      checkDependencies(deps),
      checkNerdFont(),
      getToolVersions(deps.map(d => d.name)),  // NEW
    ]);

    // ... print with versions ...
    for (const dep of required) {
      const icon = dep.installed ? '✓' : '✗';
      const versionInfo = versions[dep.name]
        ? ` (${versions[dep.name].version})`
        : '';
      const hint = !dep.installed && dep.brewPackage
        ? ` (brew install ${dep.brewPackage})`
        : '';
      console.log(`  ${icon} ${dep.name}${versionInfo}${hint}`);
    }
  }
}
```

### Data Flow

```
doctor() command runs
    ↓
Parallel execution:
  - checkDependencies() - installed status (existing)
  - checkNerdFont() - font detection (existing)
  - getToolVersions() - version extraction (NEW)
    ↓
getToolVersions() in src/diagnostics.ts:
    For each tool:
      1. Try: {tool} --version
      2. If fails, try: {tool} -V
      3. Parse semver from stdout
      4. Return { tool, version, raw } or null
    ↓
doctor() merges results:
  - DependencyStatus (installed bool)
  - ToolVersion (version string)
    ↓
Print enhanced status with versions
```

### Edge Cases

| Tool | Version Command | Output Format | Parse Strategy |
|------|----------------|---------------|----------------|
| starship | starship --version | starship 1.18.2 | First semver match |
| cargo | cargo --version | cargo 1.76.0 (c84b36747 2024-01-18) | First semver match |
| fnm | fnm --version | fnm 1.37.0 | First semver match |
| bun | bun --version | 1.0.26 | First semver match |
| brew | brew --version | Homebrew 4.2.5-48-ga9a7... | First semver match |

**Non-standard formats:**
- `git version 2.43.0` → extract "2.43.0"
- `tmux 3.3a` → extract "3.3" (ignore letter suffix)
- `Python 3.12.1` → extract "3.12.1"

### Performance Considerations

- Run version checks in parallel (Promise.all)
- Cache results within single doctor run (no repeated calls)
- Short timeout (2s) for unresponsive commands
- Don't block on version fetch failures (show tool as installed but version unknown)

---

## Brewfile Sync Integration

### New Components

**None required** - all changes in existing code

### Modified Components

#### `index.ts` - Brewfile sync functions

**Current implementation:**
- `parseBrewfile()` - parses brew/cask/tap lines
- `getInstalledPackages()` - gets installed formulae/casks
- `checkBrewfileSync()` - compares installed vs brewfile
- `filterBrewfile()` - excludes vscode extensions
- `sync()` - dumps brewfile with exclusions

**Enhancement 1: Config storage for exclusions**

**Currently:** Exclusions hardcoded in filterBrewfile() to ["vscode"]

**Proposed:** Use brewfile.exclude from dot.config.json

**Changes:**
```typescript
// Already exists in types.ts:
export const BrewfileConfigSchema = z.object({
  path: z.string().default("homebrew/brewfile"),
  exclude: z.array(z.string()).default(["vscode"]),
});

// Already exists in index.ts:
async function sync(config: Config, dotConfig: DotConfig) {
  const brewfileConfig = dotConfig.brewfile;
  const exclude = brewfileConfig?.exclude ?? ["vscode"];
  // ... use exclude array in filterBrewfile()
}
```

**Status:** Already implemented! Just needs UI to configure.

**Enhancement 2: Interactive exclusion configuration**

**New function:**
```typescript
async function syncConfig(dotfilesPath: string, dotConfig: DotConfig): Promise<void> {
  const currentExclude = dotConfig.brewfile?.exclude ?? ['vscode'];

  const selected = await p.multiselect({
    message: 'Select package types to exclude:',
    options: [
      { value: 'vscode', label: 'vscode', hint: 'VS Code extensions (vscode "...")' },
      { value: 'mas', label: 'mas', hint: 'Mac App Store apps (mas "...")' },
      { value: 'whalebrew', label: 'whalebrew', hint: 'Whalebrew containers (whalebrew "...")' },
    ],
    initialValues: currentExclude,
  });

  // Update config
  const newConfig = {
    ...dotConfig,
    brewfile: {
      ...dotConfig.brewfile,
      path: dotConfig.brewfile?.path ?? 'homebrew/brewfile',
      exclude: selected as string[],
    },
  };

  await writeConfig(dotfilesPath, newConfig);
}
```

**Command dispatch:**
```typescript
case "sync": {
  const syncIdx = args.indexOf("sync");
  const syncSubcommand = syncIdx >= 0 ? args[syncIdx + 1] : undefined;

  if (syncSubcommand === "config") {
    await syncConfig(dotfilesPath, dotConfig);
  } else {
    await sync(config, dotConfig);
  }
  break;
}
```

### Data Flow

```
User runs: dot sync config
    ↓
main() dispatches to syncConfig()
    ↓
syncConfig():
    1. Load current exclusions from dot.config.json
    2. Show multiselect UI with options
    3. Update dot.config.json with new exclusions
    ↓
User runs: dot sync
    ↓
sync():
    1. Read exclusions from config
    2. Run brew bundle dump
    3. Filter out excluded types
    4. Write to brewfile
```

### Brewfile Format Patterns

**From Homebrew documentation:**
```ruby
tap "homebrew/bundle"
tap "homebrew/cask"
brew "git"
brew "node"
cask "visual-studio-code"
mas "Xcode", id: 497799835
vscode "dbaeumer.vscode-eslint"
whalebrew "whalebrew/wget"
```

**Exclusion examples:**
- `exclude: ["vscode"]` → skip lines starting with `vscode "`
- `exclude: ["mas"]` → skip lines starting with `mas "`
- `exclude: ["vscode", "mas"]` → skip both

**Current regex in filterBrewfile():**
```typescript
const excludePattern = new RegExp(`^(${exclude.join('|')})\\s+"`, 'i');
return output.split("\n").filter(line => !excludePattern.test(line.trimStart()));
```

### Configuration UI

**Available exclusion types:**

| Type | Description | Example |
|------|-------------|---------|
| vscode | VS Code extensions | `vscode "dbaeumer.vscode-eslint"` |
| mas | Mac App Store apps | `mas "Xcode", id: 497799835` |
| whalebrew | Whalebrew containers | `whalebrew "whalebrew/wget"` |

**User experience:**
```
$ dot sync config

┌  dot sync config
│
◆  Select package types to exclude:
│  ◻ vscode (VS Code extensions)
│  ◼ mas (Mac App Store apps)
│  ◻ whalebrew (Whalebrew containers)
└
```

---

## Doctor-Reviewed Migration

### Current State

**Location:** `{dotfiles}/.doctor-reviewed.json`
**Purpose:** Track paths user has reviewed and decided not to track
**Format:**
```json
{
  "/Users/brendon/.config/nvim": "2026-01-15",
  "/Users/brendon/.ssh": "2026-01-20"
}
```

### Issue

Storing in dotfiles repo causes it to be committed and shared across machines. Reviewed paths are machine-specific (one Mac might have files another doesn't).

### Proposed Solution

**New location:** `~/.config/dot/doctor-reviewed.json`

**Migration path:**
1. Check for old location on first doctor run
2. If exists, move to new location
3. Update reviewedFile path in Config type

### Changes Required

#### `index.ts` - Config type

**Current:**
```typescript
type Config = {
  dotfiles: string;
  dotconfig: string;
  home: string;
  reviewedFile: string;  // Currently: {dotfiles}/.doctor-reviewed.json
  links: Record<string, string>;
};

function createConfig(dotfilesPath: string, links: LinkMap): Config {
  return {
    // ...
    reviewedFile: `${dotfilesPath}/.doctor-reviewed.json`,
  };
}
```

**Proposed:**
```typescript
function createConfig(dotfilesPath: string, links: LinkMap): Config {
  return {
    // ...
    reviewedFile: `${home}/.config/dot/doctor-reviewed.json`,
  };
}
```

#### Migration logic

**Add to doctor() function:**
```typescript
async function doctor(config: Config, dotConfig: DotConfig) {
  // ... existing code ...

  // Migrate reviewed paths from old location
  const oldReviewedPath = `${config.dotfiles}/.doctor-reviewed.json`;
  const newReviewedPath = config.reviewedFile;

  if (await pathExists(oldReviewedPath) && !await pathExists(newReviewedPath)) {
    const oldData = await Bun.file(oldReviewedPath).json();
    await writeReviewedPaths(config, oldData);
    // Optionally delete old file (or leave for backward compat)
  }

  // Continue with existing doctor logic...
}
```

---

## Suggested Build Order

Based on dependencies and risk, recommended phase order:

### Phase 1: Doctor-Reviewed Migration (LOW risk, foundational)
**Why first:** Simple move, no new logic, enables testing other features without mixing concerns

**Tasks:**
1. Update Config type reviewedFile path
2. Add migration logic to doctor()
3. Update tests for new path
4. Verify migration works

**Estimated effort:** 1 task, ~30 minutes

### Phase 2: Brewfile Sync UI (MEDIUM risk, self-contained)
**Why second:** No new APIs, just UI for existing functionality

**Tasks:**
1. Add syncConfig() function with multiselect UI
2. Add "sync config" subcommand dispatch
3. Update help text
4. Test exclusion persistence

**Estimated effort:** 1-2 tasks, ~1 hour

### Phase 3: Enhanced Diagnostics (MEDIUM risk, new module)
**Why third:** New module but well-defined scope, minimal integration

**Tasks:**
1. Create src/diagnostics.ts with version parsing
2. Add getToolVersions() integration to doctor()
3. Update output formatting with versions
4. Add tests for version parsing edge cases

**Estimated effort:** 2-3 tasks, ~2 hours

### Phase 4: Self-Update (HIGH risk, requires external setup)
**Why last:** Depends on GitHub Actions, binary releases, most complex

**Prerequisites:**
- GitHub Actions workflow for building binaries
- First release published with binaries
- Checksum generation in CI

**Tasks:**
1. Implement src/update.ts with GitHub API integration
2. Add binary download and verification
3. Add atomic replacement with backup
4. Add rollback on failure
5. Test manually with real releases

**Estimated effort:** 4-5 tasks, ~4-6 hours

### Dependency Graph

```
Phase 1 (Doctor migration)
    ↓ (no dependencies)
Phase 2 (Brewfile UI)
    ↓ (no dependencies)
Phase 3 (Diagnostics)
    ↓ (no dependencies)
Phase 4 (Self-update)
    ↓ (requires external: GitHub releases)
```

**Parallel execution possible:** Phases 1-3 can be developed in parallel after requirements finalized.

---

## Integration Points Summary

### With Existing Code

| Feature | Touches | Integration Type |
|---------|---------|-----------------|
| Self-update | src/update.ts (replace stub), index.ts VERSION | Module replacement |
| Diagnostics | src/diagnostics.ts (new), index.ts doctor() | Function call addition |
| Brewfile UI | index.ts sync functions, switch case | Inline enhancement |
| Doctor migration | index.ts Config type, doctor() | Data structure change |

### With External Systems

| Feature | External Dependency | API Used |
|---------|-------------------|----------|
| Self-update | GitHub Releases | GET /repos/{owner}/{repo}/releases/latest |
| Diagnostics | Tool binaries | Subprocess --version output |
| Brewfile sync | Homebrew | brew bundle dump stdout |

### State Changes

| Feature | State File | Change Type |
|---------|-----------|-------------|
| Self-update | None (stateless) | N/A |
| Diagnostics | None (ephemeral) | N/A |
| Brewfile UI | dot.config.json | Add brewfile.exclude array |
| Doctor migration | doctor-reviewed.json | Move to ~/.config/dot/ |

---

## Risk Assessment

### Self-Update Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Corrupt download | Binary won't run | Checksum validation before replacement |
| Network interruption | Partial download | Verify file size, checksum before use |
| Binary won't execute | User stuck | Auto-rollback on --version failure |
| Permissions issue | Can't replace binary | Check write permissions before download |

**Overall risk:** MEDIUM-HIGH (binary replacement is inherently risky)

### Diagnostics Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Command hangs | Doctor freezes | 2s timeout on all subprocess calls |
| Non-standard version format | Can't parse | Return null, show "unknown" in UI |
| Command not in PATH | subprocess fails | Handle error, show as not installed |

**Overall risk:** LOW (failures are graceful)

### Brewfile Sync Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Invalid exclusion pattern | Filtering broken | Validate against known types |
| Config write fails | Changes lost | Validate before writing |
| User removes critical exclusions | Brewfile bloated | Document what each exclusion does |

**Overall risk:** LOW (config-only changes)

---

## Architecture Patterns Applied

### From Research

**Self-update pattern (from go-github-selfupdate):**
- ✓ GitHub Releases API for version discovery
- ✓ Platform/arch-specific binary downloads
- ✓ Checksum validation
- ✓ Atomic replacement with backup

**Version parsing pattern (from semver-cli):**
- ✓ Try --version first, fall back to -V
- ✓ Extract first semver match from output
- ✓ Handle non-standard formats gracefully

**Brewfile pattern (from Homebrew documentation):**
- ✓ Use brew bundle dump stdout
- ✓ Filter by line prefix (type-based exclusion)
- ✓ Store exclusions in config for persistence

### Existing Patterns Continued

**Module extraction:**
- ✓ Complex logic → src/ modules
- ✓ Simple helpers → inline in index.ts

**State management:**
- ✓ Global state → ~/.config/dot/
- ✓ Per-repo config → {dotfiles}/dot.config.json

**Error handling:**
- ✓ Try/catch with graceful degradation
- ✓ User-facing messages via @clack/prompts
- ✓ null returns for "not found" cases

**Testing:**
- ✓ Export internal functions for unit tests
- ✓ Inject dependencies (config, paths) for testability

---

## Open Questions for Planner

1. **Self-update version strategy:**
   - Should we check for updates automatically on every command?
   - Or only when user runs `dot update`?
   - **Recommendation:** Manual only (avoid network calls on every invocation)

2. **Diagnostics verbosity:**
   - Show versions for all tools always?
   - Or only when --verbose flag provided?
   - **Recommendation:** Always show (valuable context, low cost)

3. **Brewfile exclusion defaults:**
   - Keep vscode as default exclusion?
   - Or start with empty exclusions?
   - **Recommendation:** Keep vscode default (matches current behavior)

4. **Doctor-reviewed migration:**
   - Delete old file after migration?
   - Or keep for backward compatibility?
   - **Recommendation:** Keep (allows rollback to older dot versions)

5. **GitHub release automation:**
   - Build releases manually initially?
   - Or set up GitHub Actions first?
   - **Recommendation:** Manual first (validates process), automate after v2.1

---

## Sources

### Self-Update Architecture
- [GitHub - rhysd/go-github-selfupdate](https://github.com/rhysd/go-github-selfupdate) - Binary self-update pattern for CLI tools
- [GitHub - mitsuhiko/self-replace](https://github.com/mitsuhiko/self-replace) - Utility for binary self-replacement
- [GitHub - jaemk/self_update](https://github.com/jaemk/self_update) - Rust implementation with rollback support

### Version Detection
- [Semantic Versioning 2.0.0](https://semver.org/) - Semver specification
- [GitHub - davidrjonas/semver-cli](https://github.com/davidrjonas/semver-cli) - CLI version parsing patterns

### Brewfile Sync
- [Homebrew Bundle and Brewfile Documentation](https://docs.brew.sh/Brew-Bundle-and-Brewfile) - Official Homebrew brewfile format
- [Brew Bundle Brewfile Tips](https://gist.github.com/ChristopherA/a579274536aab36ea9966f301ff14f3f) - Community brewfile patterns

### Bun Capabilities
- [Bun Bundler Documentation](https://bun.sh/docs/bundler) - Binary compilation features
- [Bun GitHub Repository](https://github.com/oven-sh/bun) - Official Bun source
