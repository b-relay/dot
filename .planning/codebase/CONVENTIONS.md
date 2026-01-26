# Coding Conventions

**Analysis Date:** 2026-01-26

## Naming Patterns

**Files:**
- Single file (`index.ts`): Main CLI entry point with all logic in one file
- Test files: `{module}.test.ts` format (e.g., `index.test.ts`, `integration.test.ts`)
- File names use kebab-case with `.ts` extension

**Functions:**
- camelCase for all functions: `createConfig()`, `resolveSymlinkTarget()`, `installAsync()`
- Private/internal helpers follow same convention: `tryRealpath()`, `linksToExpectedResolved()`
- Exported test utilities exported via `__test` object: `__test.pathExists`, `__test.tryRealpath`

**Variables & Constants:**
- camelCase for all variables: `tmpDir`, `config`, `homeFiles`
- SCREAMING_SNAKE_CASE for module-level constants: `REVIEW_EXPIRY_DAYS`, `DEPENDENCIES`
- readonly array constants: `as const` marker used for type safety: `DEPENDENCIES: readonly Dependency[]`

**Types:**
- PascalCase for all type names: `Config`, `Dependency`, `DependencyStatus`, `BrewfilePackage`, `SymlinkStatus`, `Dotfile`
- Optional fields marked with `?`: `description?: string`, `brewPackage?: string`, `size?: number`
- Type imports explicit: `type Config`, `type Dependency` with type keyword

## Code Style

**Formatting:**
- No explicit formatter configured (Prettier/ESLint not used)
- Manual formatting follows:
  - 2-space indentation (observed consistently throughout)
  - Lines are wrapped for readability (max length roughly 80-100 chars)
  - Comments on separate lines above code, or inline with context
  - Objects formatted with keys on new lines when multiline

**Linting:**
- TypeScript strict mode enabled: `"strict": true` in `tsconfig.json`
- `noFallthroughCasesInSwitch: true` - enforces breaks in switch statements
- `noUncheckedIndexedAccess: true` - prevents unsafe index access
- `noImplicitOverride: true` - requires explicit override keyword
- `skipLibCheck: true` - faster type checking by skipping lib files

**Error Handling:**
- Pattern: Try-catch with error recovery
- For file operations: try-catch blocks handle ENOENT, ELOOP, permission errors gracefully
- Return `null` or empty array on error, not throwing: `catch { return null; }`, `catch { return []; }`
- Example from `tryRealpath()`:
  ```typescript
  async function tryRealpath(path: string): Promise<string | null> {
    try {
      return await realpath(path);
    } catch {
      return null;
    }
  }
  ```
- Process errors: Explicit `process.exit(1)` with error message to stderr

## Import Organization

**Order:**
1. Third-party imports (bun, node built-ins): `import { $ } from "bun"`, `import { parseArgs } from "util"`
2. Node.js fs promises: `import { lstat, readlink, ... } from "node:fs/promises"`
3. Node.js path utilities: `import { dirname, resolve, ... } from "node:path"`
4. No relative imports within single-file module

**Path Aliases:**
- Not used (single-file module, no aliases needed)

**Module Imports:**
- Destructured imports for functions/types: `import { describe, expect, test } from "bun:test"`
- Default imports for modules: `import { $ } from "bun"`
- Type imports use explicit keyword: `import { type Config, type SymlinkStatus } from "../index"`

## Comments

**When to Comment:**
- Comments used for non-obvious behavior: "Resolve symlink target to absolute path (always normalized)"
- Comments explain WHY not WHAT: "Always use resolve() to normalize paths (removes .., ., etc.)"
- Section separators using repeated dashes: `// --- Core symlink helpers ---`
- Comments above key algorithms or workarounds

**JSDoc/TSDoc:**
- Not systematically used in this codebase
- Some inline doc comments above complex functions explaining parameters and behavior

**Example from code:**
```typescript
// Resolve symlink target to absolute path (always normalized)
async function resolveSymlinkTarget(linkPath: string): Promise<string> {
  const raw = await readlink(linkPath);
  // Always use resolve() to normalize paths (removes .., ., etc.)
  return resolve(dirname(linkPath), raw);
}
```

## Function Design

**Size:**
- Functions are medium-sized (30-100 lines typical)
- Helper functions extracted for readability: `isToolInstalled()`, `checkDependencies()` are separate from usage
- Longer functions for complex logic: `doctor()` is 103 lines but well-structured with sections

**Parameters:**
- Explicit parameters preferred over config objects, except for dependency injection
- `config: Config` parameter passed to most functions for dependency injection
- Optional parameters use `?` marker: `today?: string = new Date()...`

**Return Values:**
- Promise-based (async/await): All async file operations return `Promise<T>`
- Success returns data or void: `Promise<SymlinkStatus[]>`, `Promise<void>`
- Error handling via null/empty arrays, not throwing: `Promise<string | null>`
- Type-safe returns using discriminated unions: `status: "valid" | "broken" | "missing" | "wrong-target"`

## Module Design

**Exports:**
- Main exports at bottom of file (lines 1093-1129): Functions, Types, Constants
- Test exports via special `__test` object (lines 1083-1091): Internal functions needed by tests
- Grouped by category: Types, Constants, Functions
- Public functions: `install()`, `uninstall()`, `getDotfiles()`, etc.
- Internal helpers: `pathExists()`, `tryRealpath()` exported only via `__test` for testing

**Barrel Files:**
- Not used (single-file module)

**Export Pattern:**
```typescript
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

// Public exports
export {
  // Types
  type Config,
  type SymlinkStatus,
  type Dotfile,
  // Constants
  REVIEW_EXPIRY_DAYS,
  DEPENDENCIES,
  // Functions
  createConfig,
  install,
  uninstall,
  // ... more
};
```

## CLI Entry Point

**Pattern:** `index.ts` contains all logic with switch statement at bottom
- Line 1052-1080: Command dispatch switch statement
- Line 1035-1049: `help()` function describes all commands
- Line 1055-1080: Cases for each command (install, uninstall, sync, doctor, review)
- Each case either awaits a function or calls help()

**Example:**
```typescript
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
  // ... more cases
  default:
    help();
    break;
}
```

## Path Handling

**Convention:**
- Always use absolute paths throughout: `config.dotfiles`, `config.home` are absolute
- Resolve relative paths against home directory, not cwd: `normalizePath(home, inputPath)`
- Use `resolve()` from path module to normalize: removes `..`, `.`, trailing slashes
- Symlink resolution: `resolveSymlinkTarget()` returns normalized absolute paths

**Example:**
```typescript
function normalizePath(home: string, inputPath: string): string {
  if (inputPath === "~") return home;
  if (inputPath.startsWith("~/")) return resolve(home, inputPath.slice(2));
  if (!isAbsolute(inputPath)) return resolve(home, inputPath);
  return resolve(inputPath);
}
```

## Async/Await Pattern

**Convention:**
- `async function` declaration style used consistently
- `await` for all promise operations: `await install()`, `await Bun.file().text()`
- `Promise.all()` for parallel operations: `const [status, branch] = await Promise.all([...])`
- `nothrow().quiet()` on shell operations that might fail: `await $\`which ${name}\`.nothrow().quiet()`

---

*Convention analysis: 2026-01-26*
