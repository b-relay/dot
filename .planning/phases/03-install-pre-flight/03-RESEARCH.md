# Phase 3: Install Pre-flight - Research

**Researched:** 2026-01-25
**Domain:** CLI argument parsing, pre-flight validation, Bun TypeScript
**Confidence:** HIGH

## Summary

This phase adds pre-flight dependency checking to `dot install` and a post-install message. The implementation involves:

1. Reusing the existing `checkDependencies()` function from Phase 1
2. Adding `--force` flag parsing using Node.js `util.parseArgs` (supported by Bun)
3. Blocking install with a clear error when required dependencies are missing
4. Printing a post-install message telling users to run `exec zsh`

The approach is straightforward: parse `--force` flag from argv, call `checkDependencies()` before the install loop, and add a post-install message. No external libraries needed. The existing codebase already has all the dependency checking infrastructure from Phase 1.

**Primary recommendation:** Add `--force` flag parsing at CLI entry point, gate `install()` with a pre-flight check function that reuses `checkDependencies()`, and append post-install messaging to the existing "Done!" output.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| util.parseArgs | Node.js built-in | Parse `--force` flag | Bun supports Node.js util module, no dependencies needed |
| Bun.argv | Built-in | Access raw command-line args | Already used in codebase |
| checkDependencies() | Existing | Check required dependencies | Reuse Phase 1 infrastructure |

### Supporting

No external libraries needed. The implementation relies entirely on:
- Node.js `util.parseArgs` (supported by Bun)
- Existing dependency checking infrastructure from Phase 1
- Standard JavaScript/TypeScript patterns

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| util.parseArgs | Manual argv parsing | parseArgs is cleaner, handles edge cases |
| util.parseArgs | commander/yargs | External dependencies for trivial flag parsing |
| Reusing checkDependencies() | Duplicate logic | DRY violation, maintenance burden |

**Installation:** No new dependencies required.

## Architecture Patterns

### Recommended Project Structure

The implementation fits within the existing `dot/index.ts` file structure:

```
dot/
├── index.ts           # Add parseArgs, pre-flight check, post-install message
└── tests/
    └── install-preflight.test.ts  # New test file for pre-flight behavior
```

### Pattern 1: Parse Install Options

**What:** Use util.parseArgs to extract `--force` flag from command-line arguments
**When to use:** When a command needs flag options beyond positional arguments

```typescript
// Source: Node.js util.parseArgs documentation
import { parseArgs } from "util";

type InstallOptions = {
  force: boolean;
};

function parseInstallArgs(): InstallOptions {
  const { values } = parseArgs({
    args: Bun.argv.slice(2), // Skip bun and script path
    options: {
      force: {
        type: "boolean",
        short: "f",
        default: false,
      },
    },
    strict: false, // Allow positional "install" command
    allowPositionals: true,
  });

  return {
    force: values.force ?? false,
  };
}
```

### Pattern 2: Pre-flight Check Function

**What:** Gate install with dependency validation, return early on failure
**When to use:** When an operation should be blocked unless prerequisites are met

```typescript
// Source: Existing checkDependencies() + standard pre-flight pattern
async function preflightCheck(options: InstallOptions): Promise<boolean> {
  if (options.force) {
    return true; // Bypass all checks
  }

  const deps = await checkDependencies();
  const missingRequired = deps.filter(d => d.required && !d.installed);

  if (missingRequired.length > 0) {
    console.error("Error: Missing required dependencies:\n");
    for (const dep of missingRequired) {
      const hint = dep.brewPackage
        ? ` (brew install ${dep.brewPackage})`
        : "";
      console.error(`  \u2718 ${dep.name}${hint}`);
    }
    console.error("\nInstall dependencies first, or use --force to bypass this check.");
    return false;
  }

  return true;
}
```

### Pattern 3: Post-install Message

**What:** Print actionable next steps after successful install
**When to use:** When users need to take action after a command completes

```typescript
// Source: Common CLI UX pattern
function printPostInstallMessage(): void {
  console.log("\nTo apply changes, run: exec zsh");
  console.log("Or open a new terminal window.");
}
```

### Pattern 4: CLI Entry Point Integration

**What:** Parse options before command execution, pass to relevant functions
**When to use:** When commands need configurable behavior

```typescript
// Source: Adaptation of existing switch statement
const config = createConfig();
const command = Bun.argv[2];

switch (command) {
  case "install": {
    const options = parseInstallArgs();
    if (await preflightCheck(options)) {
      await install(config);
      printPostInstallMessage();
    } else {
      process.exit(1);
    }
    break;
  }
  // ... other commands unchanged
}
```

### Anti-Patterns to Avoid

- **Duplicating checkDependencies logic:** Reuse the existing function
- **Checking dependencies inside install():** Keep pre-flight separate for testability
- **Silent failures:** Always print clear error messages with remediation steps
- **Forgetting process.exit(1):** CLI must signal failure to caller
- **Using strict: true with positional commands:** parseArgs throws on "install" positional

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parse --force flag | Manual string matching | util.parseArgs | Handles short flags, equals syntax, etc. |
| Check dependencies | Duplicate the loop | checkDependencies() | Already exists, tested, correct |
| Exit codes | Return statements only | process.exit(1) | CLI callers expect proper exit codes |

**Key insight:** Phase 1 already built the hard part. This phase is mostly wiring existing pieces together.

## Common Pitfalls

### Pitfall 1: Using strict: true with Positional Commands

**What goes wrong:** parseArgs throws "Unknown option 'install'"
**Why it happens:** The "install" command word is treated as an unknown option
**How to avoid:** Use `strict: false` and `allowPositionals: true`
**Warning signs:** "Unknown option" errors when running `dot install`

### Pitfall 2: Forgetting to Slice Bun.argv

**What goes wrong:** parseArgs sees bun executable path as first argument
**Why it happens:** Bun.argv includes full path like Node.js process.argv
**How to avoid:** Always slice: `Bun.argv.slice(2)` to skip bun path and script name
**Warning signs:** Flags not being recognized

### Pitfall 3: Not Exiting with Error Code

**What goes wrong:** Scripts calling `dot install` think it succeeded
**Why it happens:** Function returns without calling process.exit(1)
**How to avoid:** Always use process.exit(1) for command failures
**Warning signs:** CI pipelines proceeding after install failures

### Pitfall 4: Checking Dependencies Inside install()

**What goes wrong:** Hard to test pre-flight logic independently
**Why it happens:** Seems simpler to add check at start of function
**How to avoid:** Keep pre-flight as separate function, call before install()
**Warning signs:** Tests that need to mock the entire install function

### Pitfall 5: Post-install Message on Failure

**What goes wrong:** User sees "run exec zsh" even though install failed
**Why it happens:** Message printed unconditionally
**How to avoid:** Only print post-install message after successful install
**Warning signs:** Confusing output when install is blocked

## Code Examples

Verified patterns ready for implementation:

### Complete parseInstallArgs Implementation

```typescript
// Source: Node.js util.parseArgs docs + Bun compatibility
import { parseArgs } from "util";

type InstallOptions = {
  force: boolean;
};

function parseInstallArgs(): InstallOptions {
  // Bun.argv: [bun-path, script-path, command, ...args]
  // Slice to get just the args after "install"
  const args = Bun.argv.slice(3);

  const { values } = parseArgs({
    args,
    options: {
      force: {
        type: "boolean",
        short: "f",
        default: false,
      },
    },
    strict: false,
    allowPositionals: true,
  });

  return {
    force: values.force ?? false,
  };
}
```

### Complete Pre-flight Check

```typescript
// Source: Reuses existing checkDependencies()
async function preflightCheck(force: boolean): Promise<boolean> {
  if (force) {
    console.log("Warning: Bypassing dependency check (--force)");
    return true;
  }

  const deps = await checkDependencies();
  const missingRequired = deps.filter(d => d.required && !d.installed);

  if (missingRequired.length === 0) {
    return true;
  }

  console.error("Error: Missing required dependencies:\n");
  for (const dep of missingRequired) {
    const hint = dep.brewPackage
      ? ` (brew install ${dep.brewPackage})`
      : "";
    console.error(`  \u2718 ${dep.name}${hint}`);
  }
  console.error("\nInstall dependencies first, or use --force to bypass this check.");
  return false;
}
```

### Modified install() with Post-install Message

```typescript
// Source: Existing install() + UX addition
async function install(config: Config) {
  console.log("Installing dotfiles...");

  for (const [source, target] of Object.entries(config.links)) {
    // ... existing install logic unchanged ...
  }

  console.log("Done!");
  // NEW: Post-install guidance
  console.log("\nTo apply changes, run: exec zsh");
  console.log("Or open a new terminal window.");
}
```

### Updated CLI Entry Point

```typescript
// Source: Modification of existing switch statement
case "install": {
  const { force } = parseInstallArgs();
  if (await preflightCheck(force)) {
    await install(config);
  } else {
    process.exit(1);
  }
  break;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual argv parsing | util.parseArgs | Node.js 18.3+ (2022) | Cleaner, more robust |
| yargs/commander for simple CLIs | Built-in parseArgs | 2022+ | Zero dependencies |
| Silent install failures | Clear error + exit code | Best practice | Better automation |

**Deprecated/outdated:**
- None relevant - util.parseArgs is stable and recommended

## Open Questions

### Resolved During Research

1. **Should we modify install() or create a wrapper?**
   - Decision: Keep install() unchanged, add pre-flight before calling it
   - Rationale: Better separation of concerns, easier to test

2. **How to handle --force with short flag?**
   - Decision: Support both `--force` and `-f`
   - Rationale: Common CLI convention, util.parseArgs supports `short` option

3. **Where should post-install message go?**
   - Decision: Inside install() after "Done!"
   - Rationale: Simpler than managing at CLI level, message is always relevant after install

### Questions for Planning Phase

1. **Should --force print a warning?**
   - Recommendation: Yes, "Warning: Bypassing dependency check (--force)"
   - Planner decision

2. **Should post-install message be conditional?**
   - Recommendation: No, always show it (it's always useful after install)
   - Planner decision

## Sources

### Primary (HIGH confidence)

- Node.js util.parseArgs documentation - Full API reference, options structure, examples
- Bun.argv documentation - Confirms Node.js util module compatibility
- Existing `dot/index.ts` - checkDependencies() function, CLI structure, patterns

### Secondary (MEDIUM confidence)

- [Bun Process Argv Guide](https://bun.com/docs/guides/process/argv) - Confirms parseArgs works with Bun

### Tertiary (LOW confidence)

- None - all findings verified with primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Node.js built-ins, fully supported by Bun
- Architecture: HIGH - Straightforward extension of existing patterns
- Pitfalls: HIGH - Based on actual util.parseArgs documentation

**Research date:** 2026-01-25
**Valid until:** 2026-03-25 (60 days - stable domain, no fast-moving libraries)
