# Coding Conventions

**Analysis Date:** 2026-01-25

## Naming Patterns

**Files:**
- TypeScript source: `index.ts` (single entry point for CLI tool)
- Test files: `tests/{feature}.test.ts`
- Configuration: `tsconfig.json`, `package.json`
- Naming pattern: camelCase for files in source, kebab-case avoided

**Functions:**
- Async functions: `async function functionName()` - full word names, no abbreviations
- Helper functions: `try*` prefix for functions that return null on failure (e.g., `tryRealpath`)
- Internal helpers: Grouped by section with comments (e.g., `// --- Core symlink helpers ---`)
- Descriptive naming: `resolveSymlinkTarget`, `linksToExpectedResolved`, `isReviewedRecently` - names clearly indicate purpose
- Test internal exports: `__test` object containing internal-only functions not in public API

**Variables:**
- camelCase: `tmpDir`, `config`, `fileContent`, `linkStat`
- Constants: UPPER_SNAKE_CASE: `REVIEW_EXPIRY_DAYS`, `LINKS`
- Type variables: PascalCase with prefix: `ReviewedPaths`, `SymlinkStatus`, `Dotfile`
- Object keys: string keys in configuration objects as source → target mappings

**Types:**
- PascalCase: `Config`, `SymlinkStatus`, `Dotfile`, `ReviewedPaths`
- Type declarations before usage
- Inline object types for simple structures
- Exported for testing: `type Config`, `type SymlinkStatus`, `type Dotfile`
- Not exported: Internal type unions like type checks on strings

## Code Style

**Formatting:**
- No linter/formatter configured (not detected)
- Indentation: 2 spaces (inferred from tsconfig and source)
- Line length: No hard limit observed, lines up to 100+ characters used
- Semicolons: Used consistently
- Trailing newlines: JSON files have trailing newlines (e.g., JSON.stringify with "\n" appended)

**Linting:**
- No .eslintrc or ESLint configuration detected
- TypeScript strict mode enabled: `"strict": true` in tsconfig.json
- Additional strict flags enabled:
  - `"noFallthroughCasesInSwitch": true`
  - `"noUncheckedIndexedAccess": true`
  - `"noImplicitOverride": true`
- Unused variable/parameter checks disabled: `"noUnusedLocals": false`, `"noUnusedParameters": false`

## Import Organization

**Order:**
1. External packages (e.g., `import { $ } from "bun"`)
2. Node built-in modules (e.g., `import { lstat, readlink } from "node:fs/promises"`)
3. Path utilities from built-ins (e.g., `import { dirname, resolve, isAbsolute } from "node:path"`)
4. Local module exports (if any - not used in main file)

**Path Aliases:**
- Not used in codebase (no baseUrl or paths configured)
- Absolute imports from packages only (Bun standard library and Node built-ins)

## Error Handling

**Patterns:**
- Try-catch blocks: Used for operations that throw (file system calls, JSON parsing)
- Fail-safe helpers: Functions like `tryRealpath()` return `null` on error instead of throwing
- Empty object fallback: Corrupted JSON returns `{}` rather than throwing (e.g., in `readReviewedPaths`)
- Null coalescing: Check with `?? value` for optional environment variables
- CLI error exit: `process.exit(1)` for CLI argument validation errors
- Generic catch: `catch { ... }` without error variable when error details not needed

Example pattern from `readReviewedPaths`:
```typescript
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
```

## Logging

**Framework:** `console` (native)

**Patterns:**
- Status updates: `console.log("[tag] message")` format (e.g., `[skip]`, `[warn]`, `[link]`, `[removed]`)
- User guidance: Multi-line help text with `console.log()` per line
- Error reporting: `console.error()` for failures (e.g., missing claude CLI)
- Progress indication: Multi-step console output showing operation stages
- No debug logging (all logs are user-facing)

Example from `install()`:
```typescript
console.log(`  [skip] ${target} (already correct)`);
console.log(`  [warn] ${target} exists and is not a symlink`);
console.log(`  [link] ${target} -> ${source}`);
```

## Comments

**When to Comment:**
- Function intention: Top-level comment before helper functions explaining purpose
- Algorithm clarity: Comments explaining complex logic like path normalization
- Important assumptions: Comment when behavior differs from intuition
- Fix explanations: Comments referencing what problems a specific check solves

**JSDoc/TSDoc:**
- Not used in this codebase
- Type safety provided by TypeScript strict mode instead
- Comments are inline explanatory text, not JSDoc blocks

Example:
```typescript
// Check if resolved symlink destination matches expected source
// (canonicalize each side independently)
// Note: resolvedDest is already absolute from resolveSymlinkTarget()
async function linksToExpectedResolved(
  resolvedDest: string,
  expectedSource: string,
): Promise<boolean> {
```

## Function Design

**Size:**
- Typically 10-50 lines
- Larger functions 50-100+ lines when handling multiple concerns (e.g., `getDotfiles` with Promise.all and nested maps)
- Single responsibility per function

**Parameters:**
- Config object is always passed (dependency injection for testability)
- Single config parameter rather than spreading config fields
- Optional date parameters for testing (`today?: string` with default to `new Date()`)
- No rest parameters used

**Return Values:**
- `Promise<T>` for async file operations
- `boolean` for checks
- `T | null` for try-* functions
- Object types like `SymlinkStatus[]` for complex returns
- Consistent error handling (throw or return null, never silent failures)

Example:
```typescript
async function getSymlinkStatus(config: Config): Promise<SymlinkStatus[]> {
  // Returns array of status objects
}

async function tryRealpath(path: string): Promise<string | null> {
  // Returns resolved path or null on error
}
```

## Module Design

**Exports:**
- Public API exports at bottom of file (`export { ... }`)
- Internal test exports: `export const __test = { ... }` for functions needed only by tests
- Type exports: `export type Config`, `export type SymlinkStatus`
- Constants exported: `export REVIEW_EXPIRY_DAYS`
- CLI entry point: Default execution at module bottom with switch statement

**Barrel Files:**
- Not used (single-file module `index.ts` serves as barrel)
- Test imports: Direct imports from `../index` (from test files)

Example structure:
```typescript
// Type definitions at top
type Config = { ... };

// Helper functions
function createConfig() { ... }
async function install() { ... }

// CLI entry point
const config = createConfig();
const command = Bun.argv[2];
switch (command) { ... }

// Public API exports
export { type Config, install, uninstall, ... };

// Internal test exports
export const __test = { pathExists, resolveSymlinkTarget, ... };
```

---

*Convention analysis: 2026-01-25*
