# Codebase Structure

**Analysis Date:** 2026-01-26

## Directory Layout

```
dot/
├── index.ts              # Main CLI application (1,130 lines, all functionality)
├── tests/                # Test files
│   ├── index.test.ts                    # Unit tests for utility functions
│   ├── integration.test.ts              # Integration tests with temp directories
│   ├── install-preflight.test.ts        # Install dependency checking tests
│   ├── dependencies.test.ts             # Dependency checking tests
│   ├── doctor.test.ts                   # Doctor command analysis tests
│   └── brewfile.test.ts                 # Brewfile parsing and sync tests
├── package.json          # Project metadata, build scripts
├── tsconfig.json         # TypeScript configuration
├── bun.lock              # Bun lock file
├── CLAUDE.md             # Project-specific Claude guidance
├── .gitignore            # Git ignore rules
└── .planning/            # Planning documents
    └── codebase/         # Architecture/structure analysis
```

## Directory Purposes

**Root:**
- Purpose: Single-file CLI application with tests
- Contains: TypeScript source, tests, configuration, documentation
- Key files: `index.ts` (main application), `package.json`, `tsconfig.json`

**tests/:**
- Purpose: Unit and integration tests for all commands and helpers
- Contains: Test files using Bun test runner
- Key files: `integration.test.ts` (comprehensive), `doctor.test.ts` (complex analysis)
- Created/deleted per test run (uses temporary directories)

**.planning/codebase/:**
- Purpose: GSD codebase analysis documents
- Contains: ARCHITECTURE.md, STRUCTURE.md, and other analysis docs
- Generated: Yes (by GSD tools)

## Key File Locations

**Entry Points:**
- `index.ts`: Single entry point, all command handlers in one file

**Configuration:**
- `package.json`: Build output, scripts, dependencies (lines 1-16)
- `tsconfig.json`: TypeScript compiler options (strict mode enabled)
- `index.ts` lines 102-125: `createConfig()` establishes runtime paths

**Core Logic:**
- Symlink management: `index.ts` lines 127-650
- Dependency checking: `index.ts` lines 180-282
- Brewfile sync: `index.ts` lines 285-441
- Architecture detection: `index.ts` lines 443-542
- Doctor analysis: `index.ts` lines 930-1033
- Review/dismissal: `index.ts` lines 546-928

**Testing:**
- Unit tests: `tests/index.test.ts` (utilities, path normalization, date calculations)
- Integration tests: `tests/integration.test.ts` (symlink operations with temp dirs)
- Command tests: `tests/install-preflight.test.ts`, `tests/doctor.test.ts`, `tests/brewfile.test.ts`, `tests/dependencies.test.ts`

## Naming Conventions

**Files:**
- Main app: `index.ts` (Bun/Node.js convention)
- Tests: `*.test.ts` (Bun test runner pattern)
- Config: JSON files, standard names (package.json, tsconfig.json)

**Functions:**
- Verbs describe action: `install()`, `uninstall()`, `sync()`, `doctor()`, `review()`
- Getters: `getSymlinkStatus()`, `getDotfiles()`, `getArchitecture()`, `getRepoFiles()`
- Checkers: `checkDependencies()`, `checkBrewfileSync()`, `checkNerdFont()`
- Parse/read: `parseBrewfile()`, `readReviewedPaths()`, `readlink()` (Node API)
- Helpers: `normalizePath()`, `isToolInstalled()`, `isPathManaged()`, `pathExists()`
- Internal helpers (underscore): `__test` object exports (lines 1083-1091)

**Variables:**
- Paths: `home`, `dotfiles`, `dotconfig`, `target`, `source`, `linkPath`
- Collections: `deps`, `packages`, `files`, `status`, `config`, `issues`
- Booleans: `installed`, `isManaged`, `fontInstalled`, `required`
- Types suffix for type definitions: `Config`, `DependencyStatus`, `Dotfile`, etc.

**Types:**
- PascalCase: `Config`, `Dependency`, `DependencyStatus`, `BrewfilePackage`, `BrewfileSyncStatus`, `HardcodedPathIssue`, `SymlinkStatus`, `Dotfile`, `ReviewedPaths`, `InstallOptions`
- Enum-like: `'valid' | 'broken' | 'missing' | 'wrong-target' | 'not-symlink'` (discriminated unions, not enums)

**Constants:**
- SCREAMING_SNAKE_CASE: `REVIEW_EXPIRY_DAYS`, `DEPENDENCIES`

## Where to Add New Code

**New Command:**
1. Implement function at module level: `async function mycommand(config: Config) { ... }`
2. Add case to switch statement: `case "mycommand": await mycommand(config); break;`
3. Update `help()` function: Add line to usage text
4. Export if testing needed: Add to export statements at end of file

**New Helper Function:**
1. Place in appropriate section group (marked with comments like `// --- Symlink helpers ---`)
2. Export at bottom if needed for tests
3. Add to `__test` object if testing internals

**New Type:**
1. Define near top of file with other types (around lines 33-78)
2. Export from exports block at bottom (lines 1094-1129)

**New Configuration Entry:**
1. Add to LINKS map in `createConfig()` (lines 114-123)
2. Format: `[`${dotfiles}/source/path`]: `${target}/path``

**Tests:**
1. Create new file: `tests/myfeature.test.ts` (Bun pattern)
2. Import `describe`, `test`, `expect` from `bun:test`
3. Import functions/types from `../index`
4. Use beforeEach/afterEach for setup/cleanup
5. For filesystem tests: create temp dir with `mkdtemp()`, clean up in afterEach

## Special Directories

**~/.dotfiles:**
- Purpose: User's dotfiles repository (external, not in this codebase)
- Contents: zsh configs, git config, tmux config, vscode settings, jj config
- Referenced by: LINKS map in config
- Committed: External repo

**~/.config:**
- Purpose: XDG Base Directory for application configs
- Contents: symlinks to zsh, git, tmux, starship, jj directories
- Referenced by: LINKS map targets
- Committed: Managed by this tool (symlinks), not the code

**.planning/codebase/:**
- Purpose: Generated analysis documents
- Contents: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md
- Generated: Yes
- Committed: Yes (documentation)

**tests/:**
- Purpose: Test suite using Bun test runner
- Contains: *.test.ts files
- Generated: No (source files)
- Temporary artifacts: Test creates temp directories under tmpdir() that are cleaned up

## Import Organization

**Pattern in index.ts:**
1. Bun imports: `import { $ } from "bun"`
2. Node.js APIs: `import { parseArgs } from "util"; import { ... } from "node:fs/promises"`
3. Node.js utilities: `import { dirname, resolve, isAbsolute } from "node:path"`

**Export Strategy:**
- Type exports: Lines 1094-1103
- Constant exports: Lines 1104-1105
- Function exports: Lines 1106-1129
- Test-internal exports: `__test` object (lines 1083-1091)

**No External Dependencies:**
- Only devDependencies: `@types/bun`, `typescript`
- All functionality uses Node.js APIs and Bun built-ins
