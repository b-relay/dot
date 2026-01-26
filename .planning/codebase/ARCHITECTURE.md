# Architecture

**Analysis Date:** 2026-01-26

## Pattern Overview

**Overall:** Single-file monolithic CLI application with layered helper functions

**Key Characteristics:**
- Single entry point: `index.ts` (1,130 lines)
- Command dispatcher pattern via switch statement
- Dependency injection through `Config` type
- Separation of concerns via helper function groups (symlink, dependency, brewfile, architecture detection)
- Test exports for internal utilities

## Layers

**Configuration & Setup:**
- Purpose: Establish runtime configuration and environment
- Location: `index.ts` lines 102-125 (`createConfig()`)
- Contains: Config type definition, static LINKS map, HOME environment resolution
- Depends on: Environment variables (HOME), filesystem paths
- Used by: All commands

**Symlink Management:**
- Purpose: Create/verify/remove symlinks mapping dotfiles to system config locations
- Location: `index.ts` lines 127-178 (helpers), 592-650 (commands)
- Contains: `resolveSymlinkTarget()`, `linksToExpectedResolved()`, `pathExists()`, `install()`, `uninstall()`
- Depends on: Node.js fs/promises API, path resolution
- Used by: install/uninstall commands, doctor analysis

**Dependency Checking:**
- Purpose: Verify required and recommended system tools are installed
- Location: `index.ts` lines 180-282
- Contains: `isToolInstalled()`, `checkDependencies()`, `checkNerdFont()`, `preflightCheck()`
- Depends on: `which` command, font directory scanning
- Used by: install preflight, doctor command

**Brewfile Sync:**
- Purpose: Parse Brewfile, compare with installed packages, detect drift
- Location: `index.ts` lines 285-441
- Contains: `parseBrewfile()`, `getInstalledPackages()`, `checkBrewfileSync()`, `filterBrewfile()`
- Depends on: `brew bundle dump`, Homebrew CLI
- Used by: sync and doctor commands

**Architecture Detection:**
- Purpose: Detect CPU architecture, scan for hardcoded architecture-specific paths
- Location: `index.ts` lines 443-542
- Contains: `getArchitecture()`, `scanForHardcodedPaths()`
- Depends on: `process.arch`, filesystem scanning
- Used by: doctor command

**Review/Dismissal System:**
- Purpose: Allow users to mark dotfiles as reviewed, excluding them from doctor recommendations for 90 days
- Location: `index.ts` lines 546-928
- Contains: `readReviewedPaths()`, `writeReviewedPaths()`, `isReviewedRecently()`, `markAsReviewed()`, `review()` command
- Depends on: `.doctor-reviewed.json` persistence
- Used by: review command, doctor filtering

**Doctor (Analysis & Reporting):**
- Purpose: Gather system state and analyze with Claude AI for recommendations
- Location: `index.ts` lines 930-1033
- Contains: `doctor()` command, integration with all helper layers
- Depends on: Claude CLI (`claude` command), all other layers
- Used by: doctor command entry point

**CLI Dispatcher:**
- Purpose: Route command line arguments to appropriate handlers
- Location: `index.ts` lines 1035-1080
- Contains: help text, command switch statement, argument parsing
- Depends on: Bun.argv for command parsing
- Used by: Entry point

## Data Flow

**Install Command Flow:**

1. Parse install arguments (check for `--force` flag)
2. Run preflight check: verify required dependencies installed
3. Iterate config.links map: for each [source, target] pair
4. Check if target exists and is already correct symlink → skip
5. Create parent directories if needed
6. Create symlink from target to source
7. Report status for each link

**Doctor Command Flow:**

1. Check dependencies (fast operations first)
2. Check Brewfile sync status against installed packages
3. Scan architecture and hardcoded paths
4. Load and clean up expired review records
5. Gather symlink status, repo files, dotfiles, git status in parallel
6. Build JSON context from all gathered data
7. Send to Claude with prompt for analysis
8. Display Claude's recommendations to user

**State Management:**
- Configuration: Immutable config object created once at startup
- Symlink State: Read from filesystem via lstat/readlink (not cached)
- Reviewed Paths: JSON file at `~/.dotfiles/.doctor-reviewed.json`
- Brewfile Packages: Read from `~/.dotfiles/homebrew/brewfile` and `brew list`

## Key Abstractions

**Config Type:**
- Purpose: Encapsulates all configuration (paths, symlink definitions)
- Examples: `index.ts` lines 33-39
- Pattern: Dependency injection - passed to all commands, single source of truth

**SymlinkStatus Type:**
- Purpose: Represents state of a single symlink
- Examples: `index.ts` lines 688-693
- Pattern: Result type with discriminated union (status field determines meaning)

**Dotfile Type:**
- Purpose: Represents a single dotfile with metadata
- Examples: `index.ts` lines 880-887
- Pattern: Rich object with optional fields depending on file type

**BrewfilePackage Type:**
- Purpose: Represents a brew formula or cask
- Examples: `index.ts` lines 56-60
- Pattern: Simple type for parsed package metadata

**HardcodedPathIssue Type:**
- Purpose: Represents a detected architecture-incompatible path
- Examples: `index.ts` lines 67-73
- Pattern: Diagnostic type with suggestions

## Entry Points

**CLI Entry Point:**
- Location: `index.ts` lines 1051-1080
- Triggers: `bun index.ts <command> [args]`
- Responsibilities: Parse command, create config, dispatch to handler

**install Command:**
- Location: `index.ts` lines 592-624
- Triggers: `dot install [--force]`
- Responsibilities: Create symlinks from LINKS map

**uninstall Command:**
- Location: `index.ts` lines 626-650
- Triggers: `dot uninstall`
- Responsibilities: Remove managed symlinks

**sync Command:**
- Location: `index.ts` lines 665-686
- Triggers: `dot sync`
- Responsibilities: Update brewfile, show git status

**doctor Command:**
- Location: `index.ts` lines 930-1033
- Triggers: `dot doctor`
- Responsibilities: Comprehensive analysis with Claude

**review Command:**
- Location: `index.ts` lines 900-922
- Triggers: `dot review <path>`
- Responsibilities: Mark path as reviewed for 90 days

## Error Handling

**Strategy:** Try-catch blocks with graceful degradation where appropriate

**Patterns:**
- Symlink operations: Try lstat, catch means file doesn't exist (skip)
- File parsing: Catch JSON parse errors, return empty result
- Directory scanning: Try readdir, catch means directory doesn't exist (continue)
- CLI tools: Use `.nothrow().quiet()` on $ command to capture exit codes
- Missing environment: Throw early if HOME not set (hard requirement)

**Specific Error Cases:**
- Missing dependencies: Print list of missing tools with brew install suggestions
- Architecture detection: Scan config files for hardcoded paths, warn user
- Claude CLI failure: Exit with message to install/configure claude CLI
- Broken symlinks: Detect and report without crashing

## Cross-Cutting Concerns

**Logging:** Console.log for user-facing messages, console.error for errors (no external logging framework)

**Validation:**
- Path normalization: `normalizePath()` handles ~, ~/, relative, and absolute paths
- Symlink verification: `linksToExpectedResolved()` canonicalizes both sides before comparison
- Architecture check: `process.arch` queried at runtime, paths scanned against current architecture

**Authentication:** None - operates on local filesystem with user's credentials

**Path Resolution:**
- Config defines absolute paths for LINKS
- User input paths normalized through `normalizePath()` (handles ~ expansion)
- Symlink targets resolved through `resolveSymlinkTarget()` (dirname + resolve pattern)
- Real paths canonicalized via `realpath` when available, fallback to `resolve`
