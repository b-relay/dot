# Architecture

**Analysis Date:** 2026-01-25

## Pattern Overview

**Overall:** Declarative dotfiles management with CLI tool orchestration

**Key Characteristics:**
- Configuration-driven symlink management (LINKS map defines all system integrations)
- Stateful tracking system (reviewed paths JSON file prevents over-recommendation)
- Task-based CLI with dependency injection for testability
- Separation of core filesystem operations from orchestration logic
- Promise-based parallel operations for performance

## Layers

**CLI Layer:**
- Purpose: Parse commands and dispatch to handlers
- Location: `dot/index.ts` lines 574-597
- Contains: Command router, help text
- Depends on: Config, functional layers
- Used by: Bun runtime (user invocation)

**Configuration Layer:**
- Purpose: Normalize paths and centralize all configuration
- Location: `dot/index.ts` lines 16-48 (Config type, createConfig function)
- Contains: Path resolution, LINKS map definition, file paths
- Depends on: Node.js path utilities, environment variables
- Used by: All command handlers
- Key function: `createConfig(home?: string)` - Returns Config object with all paths and symlink mappings

**Symlink Operations Layer:**
- Purpose: Manage symlink creation, verification, removal
- Location: `dot/index.ts` lines 149-205 (install, uninstall functions)
- Contains: Installation logic, uninstallation with safety checks
- Depends on: Symlink helpers
- Used by: CLI layer
- Patterns:
  - Install: Check existing → validate source → create or skip with message
  - Uninstall: Verify symlink points to us → remove or skip

**Symlink Helper Layer:**
- Purpose: Low-level symlink verification and path resolution
- Location: `dot/index.ts` lines 50-101
- Contains: resolveSymlinkTarget, linksToExpectedResolved, pathExists, tryRealpath
- Key functions:
  - `resolveSymlinkTarget(linkPath)` - Resolves symlink to normalized absolute path
  - `linksToExpectedResolved(resolvedDest, expectedSource)` - Canonicalizes both paths and compares (with fallback)
  - `pathExists(path)` - Safe existence check using stat (returns false for broken symlinks)

**State Management Layer:**
- Purpose: Track reviewed paths and prevent over-recommendation
- Location: `dot/index.ts` lines 103-131 (reviewed paths functions)
- Contains: readReviewedPaths, writeReviewedPaths, isReviewedRecently
- Depends on: File I/O, date math
- Key concept: 90-day expiry for reviewed paths stored in `.doctor-reviewed.json`

**Diagnostic Layer:**
- Purpose: Gather system state for doctor analysis
- Location: `dot/index.ts` lines 243-434 (getSymlinkStatus, getRepoFiles, getDotfiles, getGitStatus)
- Contains: Status collection, file scanning, git operations
- Key functions:
  - `getSymlinkStatus(config)` - Returns array of SymlinkStatus objects with states: valid, broken, missing, wrong-target, not-symlink
  - `getDotfiles(config)` - Scans ~/.dotfiles, ~/., and ~/.config for dotfiles with metadata
  - `getRepoFiles(config)` - Git ls-files to get tracked configuration files
  - `getGitStatus(config)` - Current branch and porcelain status

**Utility Layer:**
- Purpose: General-purpose helpers
- Location: `dot/index.ts` lines 207-241, 479-483
- Contains: Path normalization, brew output filtering, date calculations
- Key functions:
  - `normalizePath(home, inputPath)` - Expands ~, resolves relative paths, normalizes absolute paths
  - `filterBrewfile(output)` - Removes vscode, cargo, go lines from brew bundle dump
  - `getExpiryDate(reviewDate)` - Adds 90 days to date string

## Data Flow

**Install Command:**

1. CLI invokes install(config)
2. For each link in config.links:
   - Create target parent directories with mkdir -p
   - lstat target path (don't follow symlinks)
   - If symlink exists: resolve and compare with expected source (using linksToExpectedResolved)
   - If symlink is correct: log skip message
   - If symlink is wrong: log warning
   - If regular file exists: log warning (don't overwrite)
   - If nothing exists: check source exists → create symlink → log creation
3. Return to CLI with completion message

**Doctor Command:**

1. CLI invokes doctor(config)
2. Load reviewed paths from .doctor-reviewed.json and filter by 90-day window
3. Gather parallel data:
   - getSymlinkStatus(config) - Check all configured symlinks
   - getRepoFiles(config) - Git ls-files for tracked configs
   - getDotfiles(config) - Scan home and .config directories
   - getGitStatus(config) - Current branch and changes
4. Build JSON context with symlink states, repo files, detected dotfiles, git status
5. Stream context to `claude -p` CLI tool with analysis prompt
6. Claude returns recommendations (issues, cleanup, tracking suggestions)

**Review Command:**

1. CLI invokes review(config, pathArg)
2. normalizePath(config.home, pathArg) - Expand ~ and resolve
3. markAsReviewed(config, path) - Add to reviewed paths with today's date
4. writeReviewedPaths(config, updatedData) - Persist to .doctor-reviewed.json
5. Display confirmation with expiry date

**Sync Command:**

1. CLI invokes sync(config)
2. Run `brew bundle dump` to stdout
3. filterBrewfile(output) - Remove vscode/cargo/go lines
4. Write filtered output to homebrew/brewfile
5. Show `git -C ~/.dotfiles status -s` for user review

**Uninstall Command:**

1. CLI invokes uninstall(config)
2. For each link in config.links:
   - lstat target path
   - If not a symlink: skip (safety check)
   - If symlink: resolve and compare source
   - If points to expected source: delete
   - If points elsewhere: skip (safety check)
3. Return to CLI

## Key Abstractions

**Config Type:**
- Purpose: Centralize all configuration and path resolution
- File: `dot/index.ts` lines 16-23, 25-48
- Contains: home, dotfiles, dotconfig, reviewedFile, links record
- Pattern: Passed as parameter to all functions, never global state

**SymlinkStatus Type:**
- Purpose: Represent state of a single symlink target
- File: `dot/index.ts` lines 243-248
- Properties: source, target, status (enum), actualTarget (optional)
- Status values: valid (correct + exists), broken (correct path but source missing), missing (target doesn't exist), wrong-target (points elsewhere), not-symlink (regular file)

**Dotfile Type:**
- Purpose: Metadata about a discovered dotfile in filesystem
- File: `dot/index.ts` lines 435-442
- Properties: path, type, isManaged, size, lastModified, symlinkTarget
- Used by: getDotfiles for doctor analysis

**ReviewedPaths Type:**
- Purpose: Simple mapping of path → review date string
- File: `dot/index.ts` line 103
- Pattern: Persisted as JSON, expired entries cleaned up on each doctor run

## Entry Points

**Bun CLI invocation:**
- Location: `dot/index.ts` lines 574-597
- Triggers: User runs `dot <command>`
- Responsibilities: Parse Bun.argv[2], createConfig(), dispatch to handler, catch errors
- Command router: switch statement with cases for install, uninstall, sync, doctor, review

**Doctor Analysis Integration:**
- Location: `dot/index.ts` lines 549-556
- Triggers: `dot doctor` command
- Responsibilities: Gather state, build prompt, invoke Claude CLI
- Output: Claude's analysis piped to stdout

## Error Handling

**Strategy:** Graceful degradation with informative logging

**Patterns:**

1. **Symlink Operations:**
   - Try lstat → catch (file doesn't exist) → handle missing case
   - linksToExpectedResolved falls back to string comparison if realpath fails
   - pathExists returns false instead of throwing (includes broken symlinks)
   - Install skips if source doesn't exist (don't create broken links)

2. **File I/O:**
   - readReviewedPaths returns {} if JSON parse fails (corrupted file)
   - getDotfiles catches stat errors and skips unpermitted files
   - getRepoFiles assumes .dotfiles is a valid git repo

3. **Doctor Failures:**
   - If `claude` CLI not installed, catch and print error message
   - Exit with code 1 on CLI failures

4. **Logging:**
   - Install/uninstall use console.log with [status] prefix: [link], [skip], [warn], [removed]
   - Doctor prints status messages during gather phase
   - No thrown errors in main handlers (errors caught at CLI boundary)

## Cross-Cutting Concerns

**Logging:** console.log with [STATUS] prefixes throughout
- Install phase: [link] created, [skip] correct symlink, [warn] issues
- Doctor phase: "Gathering...", "Analyzing with Claude..."
- Review phase: Confirmation message with expiry date

**Validation:** Defensive checks throughout
- pathExists before creating symlinks
- linksToExpectedResolved compares sources before removing
- Source file verification in install command

**Authentication:** None (file system operations only, except Claude CLI which handles its own auth)

**Path Normalization:** Applied consistently
- resolve() always used for absolute path normalization
- ~ expansion in normalizePath before resolve
- Relative paths resolved against home, not cwd

**Concurrency:** Promise.all for parallel operations
- getSymlinkStatus maps over entries with Promise.all
- getRepoFiles and getGitStatus run in parallel via Promise.all
- getDotfiles scans two directories with nested Promise.all

---

*Architecture analysis: 2026-01-25*
