# Testing Patterns

**Analysis Date:** 2026-01-25

## Test Framework

**Runner:**
- Bun test (`bun test`)
- Config: No separate test config file (uses bun built-in test runner)
- Version: Uses `bun:test` standard library

**Assertion Library:**
- Built-in Bun assertions: `expect()` from `bun:test`

**Run Commands:**
```bash
cd dot && bun test              # Run all tests
cd dot && bun test --watch     # Watch mode (inferred)
cd dot && bun test --coverage  # Coverage (inferred)
```

Tests are located in `dot/tests/` directory:
- `dot/tests/index.test.ts` - Unit tests for core functions
- `dot/tests/doctor.test.ts` - Tests for reviewed paths and git operations
- `dot/tests/integration.test.ts` - Integration tests with filesystem operations

## Test File Organization

**Location:**
- Co-located in `tests/` subdirectory within `dot/` module
- Pattern: Feature-based test files (index.test.ts, doctor.test.ts, integration.test.ts)
- One test file per major feature area

**Naming:**
- Files: `{feature}.test.ts`
- Test suites: `describe("functionName", ...)`
- Test cases: `test("behavior being tested", ...)`
- Descriptive test names in present tense describing expected behavior

**Structure:**
```
dot/
├── index.ts                    # Main source
└── tests/
    ├── index.test.ts          # Core function tests
    ├── doctor.test.ts         # Reviewed paths, git status tests
    └── integration.test.ts    # Full filesystem integration tests
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";

describe("functionName", () => {
  // Setup fixtures
  let tmpDir: string;
  let config: Config;

  beforeEach(async () => {
    // Setup before each test
  });

  afterEach(async () => {
    // Cleanup after each test
  });

  test("should do something", () => {
    expect(result).toBe(expected);
  });
});
```

**Patterns:**
- Setup pattern: `beforeEach()` creates temporary directories and test config
- Teardown pattern: `afterEach()` removes temporary directories with `rm(tmpDir, { recursive: true })`
- Assertion pattern: `expect(result).toBe(value)`, `expect(result).toEqual(object)`, `expect(result).toMatch(regex)`
- Multiple assertions: Tests have 1-5 assertions, typically focused on single behavior
- Lifecycle hooks: `beforeEach`/`afterEach` used for every test needing filesystem

## Mocking

**Framework:** No external mocking library (uses Bun test built-ins)

**Patterns:**
```typescript
// Test utilities - function to create test conditions
async function initGitRepo(path: string): Promise<void> {
  await $`git -C ${path} init -b main`.quiet();
  await $`git -C ${path} config user.email "test@example.com"`.quiet();
  await $`git -C ${path} config user.name "Test User"`.quiet();
}

// Used in test:
describe("getRepoFiles", () => {
  beforeEach(async () => {
    // ...
    await initGitRepo(`${tmpDir}/.dotfiles`);
  });
});
```

**Dependency Injection for Testing:**
- Functions accept optional parameters with defaults: `isReviewedRecently(date, now = new Date())`
- Allows passing fixed test dates instead of current date
- Config object injection: Tests pass custom `createConfig(tmpDir)` for isolation

Example:
```typescript
// Function allows date injection for deterministic testing
function isReviewedRecently(reviewDate: string, now: Date = new Date()): boolean {
  const reviewed = new Date(reviewDate);
  const diffDays = (now.getTime() - reviewed.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays < REVIEW_EXPIRY_DAYS;
}

// Test uses fixed date
test("returns true for date 89 days ago", () => {
  const fixedNow = new Date("2024-06-15T12:00:00Z");
  expect(isReviewedRecently("2024-03-18", fixedNow)).toBe(true);
});
```

**What to Mock:**
- Temporary filesystems via `mkdtemp()` - creates isolated test environments
- Git commands via `$` shell execution - tests run actual git init in temp repos
- File operations - use real filesystem in temp directories instead of mocking

**What NOT to Mock:**
- File system operations (use real temp directories instead)
- Git operations (use real git init in temp directories)
- Date/time (pass as function parameters)
- Never mock `node:fs/promises` - always use real filesystem

## Fixtures and Factories

**Test Data:**
```typescript
// Configuration fixture
let config: Config;
beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "dot-test-"));
  await mkdir(`${tmpDir}/.dotfiles`, { recursive: true });
  config = createConfig(tmpDir);
});

// File/directory setup
await mkdir(`${tmpDir}/.dotfiles/zsh`, { recursive: true });
await writeFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "# zshenv");

// Git repo initialization
await initGitRepo(`${tmpDir}/.dotfiles`);
```

**Location:**
- Test utilities at top of test files: `async function initGitRepo(path: string)`
- Fixtures created in `beforeEach()` hooks
- No separate fixture files

## Coverage

**Requirements:** None enforced (no coverage threshold detected)

**View Coverage:**
```bash
cd dot && bun test --coverage
```

## Test Types

**Unit Tests:**
- Scope: Individual functions with simple inputs/outputs
- Approach: Fast, deterministic tests with temporary data
- Examples:
  - `normalizePath()` - path normalization with various input patterns
  - `filterBrewfile()` - string filtering logic
  - `isReviewedRecently()` - date comparison with fixed test dates
- Characteristics: No file system dependency (or minimal temp file setup)

**Integration Tests:**
- Scope: Functions working together with filesystem operations
- Approach: Create realistic temporary directory structures, run operations, verify state
- Examples:
  - `install()` with full directory structure → verify symlinks created and readable
  - `getSymlinkStatus()` with various symlink states (valid, broken, wrong-target, missing)
  - `getDotfiles()` scanning home directory with exclusion patterns
- Characteristics: Uses real filesystem in `mkdtemp()` directories, realistic file operations

**E2E Tests:**
- Framework: Not used
- Pattern: Integration tests serve as near-E2E (use real git, real file operations in temp dirs)

## Common Patterns

**Async Testing:**
```typescript
// All async operations use async/await
test("reads and parses JSON", async () => {
  const data = { "/path": "2024-01-01" };
  await writeFile(config.reviewedFile, JSON.stringify(data));
  const result = await readReviewedPaths(config);
  expect(result).toEqual(data);
});

// Promise.all in tests
describe("getRepoFiles", () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(...);
    config = createConfig(tmpDir);
    await initGitRepo(`${tmpDir}/.dotfiles`);
  });
});
```

**Error Testing:**
```typescript
// Test expected exceptions
test("throws when path doesn't exist", async () => {
  await expect(resolveSymlinkTarget(`${tmpDir}/nonexistent`))
    .rejects.toThrow();
});

// Test error handling (functions returning null on error)
test("returns null for non-existent path", async () => {
  expect(await tryRealpath(`${tmpDir}/nonexistent`))
    .toBeNull();
});

// Test graceful degradation
test("returns empty object for corrupted JSON", async () => {
  await writeFile(config.reviewedFile, "{ invalid json }");
  const result = await readReviewedPaths(config);
  expect(result).toEqual({});
});
```

**Date-Dependent Testing:**
```typescript
// Fixed date for deterministic tests
const fixedNow = new Date("2024-06-15T12:00:00Z");

test("returns true for date within expiry window", () => {
  expect(isReviewedRecently("2024-06-15", fixedNow)).toBe(true);
});

test("returns false for date at expiry boundary", () => {
  expect(isReviewedRecently("2024-03-17", fixedNow)).toBe(false);
});
```

**Symlink Testing:**
```typescript
// Create real symlinks in temp directories
test("handles relative symlink destinations", async () => {
  const relativeTarget = ".dotfiles/zsh/zshenv";
  await symlink(relativeTarget, `${tmpDir}/.zshenv`);

  const status = await getSymlinkStatus(config);
  const zshenv = status.find(s => s.target.endsWith(".zshenv"));
  expect(zshenv?.status).toBe("valid");
});

// Create broken symlinks
test("detects broken symlinks", async () => {
  const expectedSource = `${tmpDir}/.dotfiles/zsh/zshenv`;
  await unlink(expectedSource); // Remove source file
  await symlink(expectedSource, `${tmpDir}/.zshenv`);

  const status = await getSymlinkStatus(config);
  const zshenv = status.find(s => s.target.endsWith(".zshenv"));
  expect(zshenv?.status).toBe("broken");
});
```

**Filesystem Edge Cases:**
```typescript
// Test paths with spaces
test("handles files with spaces in names", async () => {
  const file = `${tmpDir}/file with spaces.txt`;
  await writeFile(file, "content");
  expect(await pathExists(file)).toBe(true);
});

// Test unicode
test("handles unicode filenames", async () => {
  const file = `${tmpDir}/文件.txt`;
  await writeFile(file, "content");
  expect(await pathExists(file)).toBe(true);
});

// Test circular symlinks
test("returns false for circular symlink (ELOOP)", async () => {
  const linkA = `${tmpDir}/link-a`;
  const linkB = `${tmpDir}/link-b`;
  await symlink(linkB, linkA);
  await symlink(linkA, linkB);
  expect(await pathExists(linkA)).toBe(false);
});
```

## Test Isolation & Cleanup

**Temporary Directories:**
- Every test that needs filesystem gets own `tmpDir` via `mkdtemp()`
- Cleanup always in `afterEach()` with `await rm(tmpDir, { recursive: true })`
- Pattern ensures no test pollution between suite runs
- Directory name includes test context: `join(tmpdir(), "dot-test-")`

**Git Initialization:**
- Tests needing git: call `initGitRepo()` in `beforeEach()`
- Sets up main branch and test user email/name
- Each test repo is isolated in its own temp directory

---

*Testing analysis: 2026-01-25*
