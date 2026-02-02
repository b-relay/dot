# Phase 1: Dependency Checking - Research

**Researched:** 2026-01-25
**Domain:** CLI dependency detection, Bun shell, TypeScript
**Confidence:** HIGH

## Summary

This phase adds dependency checking to the `dot doctor` command. The implementation involves:
1. Defining a DEPENDENCIES data structure with required and recommended tools
2. Checking tool availability using Bun shell's `which` command pattern
3. Reporting status with check/cross visual indicators
4. Generating combined `brew install` commands for missing Homebrew tools

The approach is straightforward: use Bun's `$` shell to run `which <tool>` with `.nothrow()` to safely check exit codes. No external libraries needed. The existing codebase already uses this pattern for other shell operations.

**Primary recommendation:** Extend `doctor()` function with a new `checkDependencies()` helper that runs before the existing Claude analysis, providing a fast, deterministic check that doesn't require API calls.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bun shell ($) | Built-in | Execute `which` commands | Already used in codebase, native, fast |
| Promise.all | Built-in | Parallel tool checks | Pattern already used in getSymlinkStatus |

### Supporting

No external libraries needed. The implementation relies entirely on:
- Bun's built-in `$` shell API
- Node.js fs/promises (already imported)
- Standard JavaScript/TypeScript patterns

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `which` command | `command -v` | `which` is more portable and gives cleaner exit codes |
| Bun shell | Bun.spawn | Shell API is simpler for single commands |
| Sequential checks | Promise.all | Parallel is faster, already used in codebase |

**Installation:** No new dependencies required.

## Architecture Patterns

### Recommended Project Structure

The implementation fits within the existing `dot/index.ts` file structure:

```
dot/
├── index.ts           # Add DEPENDENCIES map and checkDependencies()
└── tests/
    └── dependencies.test.ts  # New test file for dependency checking
```

### Pattern 1: DEPENDENCIES Map Structure

**What:** A typed constant defining all dependencies with their metadata
**When to use:** When you need static configuration with installation hints

```typescript
// Source: Based on existing LINKS pattern in dot/index.ts
type Dependency = {
  name: string;
  required: boolean;
  brewPackage?: string;      // Homebrew package name if installable via brew
  description?: string;      // What this tool does
};

const DEPENDENCIES: Dependency[] = [
  // Required tools (break shell functionality if missing)
  { name: "brew", required: true, description: "Homebrew package manager" },
  { name: "starship", required: true, brewPackage: "starship", description: "Shell prompt" },
  { name: "cargo", required: true, description: "Rust package manager" },
  { name: "fnm", required: true, brewPackage: "fnm", description: "Node version manager" },
  { name: "zoxide", required: true, brewPackage: "zoxide", description: "Smart cd replacement" },

  // Recommended tools (enhance shell experience)
  { name: "fzf", required: false, brewPackage: "fzf", description: "Fuzzy finder" },
  { name: "vivid", required: false, brewPackage: "vivid", description: "LS_COLORS generator" },
  { name: "eza", required: false, brewPackage: "eza", description: "Modern ls replacement" },
  { name: "bun", required: false, brewPackage: "oven-sh/bun/bun", description: "JavaScript runtime" },
];
```

### Pattern 2: Check Tool Availability

**What:** Use Bun shell with .nothrow() to check if tool exists
**When to use:** Any time you need to detect if a CLI tool is installed

```typescript
// Source: Bun documentation (Context7 /oven-sh/bun)
async function isToolInstalled(name: string): Promise<boolean> {
  const { exitCode } = await $`which ${name}`.nothrow().quiet();
  return exitCode === 0;
}
```

### Pattern 3: Parallel Status Checks

**What:** Check all dependencies in parallel using Promise.all
**When to use:** When checking multiple tools (matches existing getSymlinkStatus pattern)

```typescript
// Source: Existing pattern in dot/index.ts getSymlinkStatus()
type DependencyStatus = {
  name: string;
  required: boolean;
  installed: boolean;
  brewPackage?: string;
};

async function checkDependencies(): Promise<DependencyStatus[]> {
  return Promise.all(
    DEPENDENCIES.map(async (dep) => ({
      name: dep.name,
      required: dep.required,
      installed: await isToolInstalled(dep.name),
      brewPackage: dep.brewPackage,
    }))
  );
}
```

### Pattern 4: Visual Status Output

**What:** Use check/cross marks for clear visual feedback
**When to use:** For CLI status output

```typescript
// Source: Common CLI pattern, similar to existing console.log in install()
function printDependencyStatus(deps: DependencyStatus[]): void {
  const required = deps.filter(d => d.required);
  const recommended = deps.filter(d => !d.required);

  console.log("\nRequired dependencies:");
  for (const dep of required) {
    const status = dep.installed ? "\u2714" : "\u2718";  // check/cross
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
}
```

### Pattern 5: Combined Brew Install Command

**What:** Generate single brew command for all missing Homebrew dependencies
**When to use:** DEPS-05 requirement

```typescript
function printBrewInstallCommand(deps: DependencyStatus[]): void {
  const missing = deps
    .filter(d => !d.installed && d.brewPackage)
    .map(d => d.brewPackage!);

  if (missing.length > 0) {
    console.log(`\nInstall missing with: brew install ${missing.join(" ")}`);
  }
}
```

### Anti-Patterns to Avoid

- **Running brew info for checks:** Too slow, `which` is instant and sufficient
- **Auto-installing dependencies:** Violates user control (explicitly out of scope)
- **External links in output:** Per requirements, only print install commands
- **Checking versions:** Deferred to v2 (DIAG-01, DIAG-02)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Check if command exists | Custom PATH parsing | `which` via Bun shell | `which` handles all edge cases |
| Parallel async operations | Manual Promise handling | Promise.all | Built-in, well-tested |
| Terminal colors | ANSI escape codes | Unicode check/cross marks | Simpler, works everywhere |

**Key insight:** The problem is simple enough that built-in tools suffice. Adding dependencies would add complexity without benefit.

## Common Pitfalls

### Pitfall 1: Checking PATH Instead of `which`

**What goes wrong:** Custom PATH parsing misses shell aliases, symlinks, or non-standard locations
**Why it happens:** Developers try to avoid shell execution
**How to avoid:** Use `which` - it's designed for exactly this purpose
**Warning signs:** Code that parses `PATH` environment variable manually

### Pitfall 2: Forgetting .nothrow() on Bun Shell

**What goes wrong:** Missing tool throws exception instead of returning exit code
**Why it happens:** Bun shell throws on non-zero exit codes by default
**How to avoid:** Always use `.nothrow().quiet()` for existence checks
**Warning signs:** Uncaught exceptions when checking for missing tools

### Pitfall 3: Blocking Doctor on Missing Dependencies

**What goes wrong:** If dependency check fails, user can't see other doctor output
**Why it happens:** Early exit or thrown errors
**How to avoid:** Dependency check should always complete and report, never exit
**Warning signs:** `process.exit()` in dependency checking code

### Pitfall 4: Hard-Coding Brew Package Names Incorrectly

**What goes wrong:** Install commands fail for tools with different brew names
**Why it happens:** Assuming brew package name = command name
**How to avoid:** Explicitly map each tool to its correct brew package
**Warning signs:** `bun` is actually `oven-sh/bun/bun` in Homebrew

### Pitfall 5: Not Handling Cargo Specially

**What goes wrong:** Suggesting `brew install cargo` which doesn't exist
**Why it happens:** Assuming all tools are Homebrew-installable
**How to avoid:** cargo has no brewPackage - it comes from rustup, not Homebrew
**Warning signs:** Error output mentioning "No available formula with the name cargo"

## Code Examples

Verified patterns ready for implementation:

### Complete isToolInstalled Helper

```typescript
// Source: Bun docs (Context7) + existing codebase patterns
import { $ } from "bun";

async function isToolInstalled(name: string): Promise<boolean> {
  const { exitCode } = await $`which ${name}`.nothrow().quiet();
  return exitCode === 0;
}
```

### Type-Safe DEPENDENCIES Definition

```typescript
// Source: Pattern derived from existing Config type in index.ts
type Dependency = {
  name: string;
  required: boolean;
  brewPackage?: string;
  description: string;
};

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
```

### Integration Point in doctor()

```typescript
// Source: Existing doctor() function pattern
async function doctor(config: Config) {
  console.log("Running dotfiles doctor...\n");

  // NEW: Check dependencies first (fast, no API calls)
  console.log("Checking dependencies...");
  const depStatus = await checkDependencies();
  printDependencyStatus(depStatus);
  printBrewInstallCommand(depStatus);

  // Existing doctor logic continues...
  const reviewedPaths = await readReviewedPaths(config);
  // ...
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `command -v` in POSIX | `which` via Bun shell | N/A - Bun specific | Cleaner API, consistent behavior |
| Sequential checks | Promise.all parallel | Common pattern | Faster for multiple tools |
| External CLI libs (commander, yargs) | Bun built-in argv | Bun 1.0+ (2023) | Zero dependencies |

**Deprecated/outdated:**
- None relevant - this is greenfield implementation

## Open Questions

### Resolved During Research

1. **How to handle cargo?**
   - Cargo is NOT in Homebrew (it's part of `rust` formula or from rustup)
   - Solution: Don't include brewPackage for cargo, just note it exists

2. **What's the correct bun Homebrew package?**
   - It's `oven-sh/bun/bun` (tap + formula name)
   - Verified via `brew info bun`

### Questions for Planning Phase

1. **Should dependency check run before or after symlink checks?**
   - Recommendation: Before (faster, helps user prioritize)
   - Planner decision

2. **Should we use color output?**
   - Recommendation: No (Unicode check/cross is sufficient, avoids terminal compatibility issues)
   - Planner decision

## Sources

### Primary (HIGH confidence)

- Context7 `/oven-sh/bun` - Shell API, error handling, .nothrow() usage
- Existing `dot/index.ts` - Config pattern, Promise.all usage, console output style
- Homebrew package verification - `brew info` commands run locally

### Secondary (MEDIUM confidence)

- [Effective Shell - Managing Dotfiles](https://effective-shell.com/part-5-building-your-toolkit/managing-your-dotfiles/) - Dotfiles script patterns
- [MIT Missing Semester - Dotfiles](https://missing.csail.mit.edu/2019/dotfiles/) - Tool check patterns

### Tertiary (LOW confidence)

- None - all findings verified with primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No external libraries, Bun built-ins fully documented
- Architecture: HIGH - Pattern matches existing codebase exactly
- Pitfalls: HIGH - Verified through actual command execution

**Research date:** 2026-01-25
**Valid until:** 2026-03-25 (60 days - stable domain, no fast-moving libraries)
