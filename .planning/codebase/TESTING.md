# Testing Patterns

**Analysis Date:** 2026-01-26

## Test Framework

**Runner:**
- Bun test runner (built into Bun)
- Version: Latest Bun (from @types/bun: latest)
- Config: No explicit config file needed (Bun convention)

**Assertion Library:**
- Bun test assertions: `expect()` API
- Import: `import { describe, expect, test, beforeEach, afterEach } from "bun:test"`

**Run Commands:**
```bash
bun test                    # Run all tests
bun test --watch           # Watch mode (derived from pattern)
```

## Test File Organization

**Location:**
- Co-located in `tests/` directory, not alongside source files
- All test files in: `/Users/clay/Projects/dot/tests/`

**Naming:**
- Pattern: `{module}.test.ts`
- Examples:
  - `index.test.ts` - Unit tests for core functions
  - `integration.test.ts` - Integration tests with temp directories
  - `doctor.test.ts` - Tests for doctor command
  - `brewfile.test.ts` - Tests for brewfile parsing
  - `dependencies.test.ts` - Tests for dependency checking
  - `install-preflight.test.ts` - Tests for install preflight checks

**File Structure:**
```
tests/
├── index.test.ts              # Pure unit tests (no I/O)
├── integration.test.ts        # Tests with temp file system
├── doctor.test.ts             # Doctor-specific tests
├── brewfile.test.ts           # Brewfile parsing tests
├── dependencies.test.ts       # Dependency checking tests
└── install-preflight.test.ts  # Install safety tests
```

## Test Structure

**Suite Organization:**
- `describe()` blocks group related tests by function or feature
- One `describe` per function typically
- Related suites grouped logically in same file

**Example:**
```typescript
describe("normalizePath", () => {
  const home = "/home/testuser";

  test("expands bare ~ to home", () => {
    expect(normalizePath(home, "~")).toBe(home);
  });

  test("expands ~/ to home directory", () => {
    expect(normalizePath(home, "~/test")).toBe(`${home}/test`);
    expect(normalizePath(home, "~/.config/app")).toBe(`${home}/.config/app`);
  });

  // ... more tests
});
```

**Setup/Teardown Pattern:**
- `beforeEach()` creates temp directory and test config
- `afterEach()` cleans up: `await rm(tmpDir, { recursive: true })`
- Used consistently in integration tests

**Example:**
```typescript
describe("install/uninstall", () => {
  let tmpDir: string;
  let config: Config;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-test-"));
    // Setup test fixtures
    await mkdir(`${tmpDir}/.dotfiles/zsh`, { recursive: true });
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "# zshenv");
    config = createConfig(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("creates symlinks with correct sources and targets", async () => {
    // test code
  });
});
```

## Test Types

**Unit Tests:**
- Pure logic tests with no I/O: `normalizePath()`, `isReviewedRecently()`, `getExpiryDate()`
- Located in `index.test.ts` (lines 10-186)
- No file system setup needed
- Fast execution, deterministic results
- Use fixed reference dates for time-dependent tests: `const fixedNow = new Date("2024-06-15T12:00:00Z")`

**Integration Tests:**
- Tests that interact with file system: `install()`, `uninstall()`, `getSymlinkStatus()`
- Located in `integration.test.ts` (lines 28-830)
- Create temp directories with `mkdtemp()`
- Test real symlink creation and resolution
- Include edge cases: relative symlinks, deeply nested paths, unicode filenames
- Extensive setup via `beforeEach` and cleanup via `afterEach`

**Command Tests:**
- `doctor.test.ts` - Tests doctor command state gathering
- `brewfile.test.ts` - Tests Brewfile parsing with real Homebrew data
- `dependencies.test.ts` - Tests dependency checking
- `install-preflight.test.ts` - Tests install safety checks

**E2E Tests:**
- Not present (CLI testing would require shell invocation)

## Mocking

**Framework:**
- Not used - tests use real file system operations via temp directories
- Real Homebrew data used in `brewfile.test.ts` (calls actual `brew list`)
- Shell operations via `$\`...\`` (Bun shell syntax)

**Patterns:**
- Dependency injection through `createConfig(tmpDir)`: Override home directory for testing
- Exposed internal functions via `__test` object for direct testing:
  ```typescript
  const { pathExists, tryRealpath, resolveSymlinkTarget, linksToExpectedResolved } = __test;
  ```
- Fixed reference dates for time-based tests:
  ```typescript
  const fixedNow = new Date("2024-06-15T12:00:00Z");
  expect(isReviewedRecently("2024-06-15", fixedNow)).toBe(true);
  ```

**What to Mock:**
- Nothing - real file system used via temp directories for safety

**What NOT to Mock:**
- File I/O - use real temp directories instead
- Git operations - initialize real test repos with `initGitRepo()`
- Homebrew - call real `brew` commands for brewfile tests

## Fixtures and Factories

**Test Data:**
- Temp directory factory: `await mkdtemp(join(tmpdir(), "dot-test-"))`
- Test file creation: Direct `writeFile()` calls
- Config creation: `createConfig(tmpDir)` (custom factory)
- Git repo initialization: `initGitRepo()` helper function

**Example Fixture Setup:**
```typescript
beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "dot-test-"));

  // Create directory structure
  await mkdir(`${tmpDir}/.dotfiles/zsh`, { recursive: true });
  await mkdir(`${tmpDir}/.dotfiles/git`, { recursive: true });

  // Create test files
  await writeFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "# zshenv");
  await writeFile(`${tmpDir}/.dotfiles/zsh/zprofile`, "# zprofile");

  // Create config
  config = createConfig(tmpDir);
});
```

**Helper Functions:**
- `initGitRepo(path)` - Initialize git repo for doctor/repo tests
  ```typescript
  async function initGitRepo(path: string): Promise<void> {
    await $`git -C ${path} init -b main`.quiet();
    await $`git -C ${path} config user.email "test@example.com"`.quiet();
    await $`git -C ${path} config user.name "Test User"`.quiet();
  }
  ```

**Location:**
- Test utilities defined in test files themselves (doctor.test.ts lines 17-23)
- No separate fixtures directory

## Assertion Patterns

**Basic Assertions:**
```typescript
expect(value).toBe(expected)           // Exact equality
expect(value).toEqual(expected)        // Deep equality
expect(value).toBeGreaterThan(5)       // Numeric comparisons
expect(value).toContain("substring")   // String/array contains
expect(value).toMatch(/pattern/)       // Regex matching
```

**Async Testing:**
```typescript
test("resolves symlink target", async () => {
  const result = await resolveSymlinkTarget(link);
  expect(result).toBe(expectedPath);
});

// Error rejection testing
await expect(resolveSymlinkTarget(file)).rejects.toThrow();
```

**Error Testing:**
```typescript
test("throws for non-symlink", async () => {
  const file = `${tmpDir}/regular-file`;
  await writeFile(file, "content");
  await expect(resolveSymlinkTarget(file)).rejects.toThrow();
});
```

## Coverage

**Requirements:**
- None enforced (no coverage config detected)

**View Coverage:**
- Not configured

## Common Patterns

**Symlink Testing:**
Pattern for verifying symlink creation and resolution:
```typescript
test("creates symlinks with correct sources and targets", async () => {
  await install(config);
  const status = await getSymlinkStatus(config);

  // Verify resolved paths match
  const expectedTargets = new Set(
    Object.values(config.links).map(t => resolve(t))
  );
  const scopedStatus = status.filter(s => expectedTargets.has(resolve(s.target)));
  const validLinks = scopedStatus.filter(s => s.status === "valid");

  expect(validLinks.length).toBe(expectedTargets.size);
});
```

**State Testing with beforeEach/afterEach:**
```typescript
describe("install/uninstall", () => {
  let tmpDir: string;
  let config: Config;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-test-"));
    // setup
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("operation 1", async () => {
    // test
  });

  test("operation 2", async () => {
    // test
  });
});
```

**File System Cleanup Pattern:**
- Temp directories created in `beforeEach`
- Always cleaned up in `afterEach` regardless of test outcome
- Uses `rm(tmpDir, { recursive: true })` for complete removal

**Testing Mixed States:**
```typescript
test("reports mixed symlink states correctly", async () => {
  // Create valid symlink
  await symlink(`${tmpDir}/.dotfiles/zsh/zshenv`, `${tmpDir}/.zshenv`);

  // Create wrong-target symlink
  await writeFile(`${tmpDir}/wrong-file`, "wrong");
  await symlink(`${tmpDir}/wrong-file`, `${tmpDir}/.config/git/config`);

  // Don't create source for third case (missing)

  const status = await getSymlinkStatus(testConfig);

  const valid = status.find(s => s.target.endsWith(".zshenv"));
  const wrong = status.find(s => s.target.includes("git/config"));
  const missing = status.find(s => s.target.includes("jj/config"));

  expect(valid?.status).toBe("valid");
  expect(wrong?.status).toBe("wrong-target");
  expect(missing?.status).toBe("missing");
});
```

**Edge Case Testing:**
- Unicode filenames: `expect(await pathExists("/tmp/émoji🎉")).toBe(true)`
- Spaces in paths: `expect(await pathExists("/path with spaces/file")).toBe(true)`
- Relative symlinks with multiple `..`: 5+ levels handled in single test
- Circular symlinks: ELOOP errors caught by `pathExists()`
- Corrupted JSON: Graceful fallback in `readReviewedPaths()`

## Test Count & Coverage

**Test Statistics:**
- `index.test.ts`: ~100 tests (normalizePath, isReviewedRecently, getExpiryDate, filterBrewfile)
- `integration.test.ts`: ~80 tests (install, uninstall, symlink status, dotfile scanning, reviewed paths)
- `doctor.test.ts`: Tests for doctor command state gathering
- `brewfile.test.ts`: Tests for Brewfile parsing
- `dependencies.test.ts`: Tests for dependency checking
- `install-preflight.test.ts`: Tests for install safety

**Focus Areas:**
- Path normalization and symlink resolution (extensive)
- File system operations with various edge cases (extensive)
- State management (reviewed paths, git status)
- Data parsing (Brewfile, dependencies)
- Safety checks (uninstall protection, preflight checks)

---

*Testing analysis: 2026-01-26*
