# Phase 7: Init Wizard Fixes - Research

**Researched:** 2026-02-01
**Domain:** CLI wizard polish, terminal UI, file system operations
**Confidence:** HIGH

## Summary

This phase involves polishing the existing init wizard with four focused improvements: directory filtering, dry-run flag, file annotations, and conflict detection fixes. The codebase already uses `@clack/prompts` for interactive UI, which supports disabled items natively. Terminal coloring requires adding `picocolors` (already a transitive dependency of @clack/prompts).

The most critical finding is the **conflict detection bug**: the `previewSymlinks` function detects symlinks but doesn't verify they point to the correct target. A symlink pointing to the wrong location shows as `[exists]` instead of being flagged as needing attention.

**Primary recommendation:** Fix the conflict detection bug first, then layer on the other improvements using existing patterns in the codebase.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @clack/prompts | ^1.0.0 | Interactive CLI prompts | Already in use, supports disabled items |
| picocolors | ^1.1.x | Terminal color/styling | Zero-dependency, fastest option, transitive dep of @clack |
| node:fs/promises | built-in | File system operations | Already used throughout codebase |
| node:path | built-in | Path manipulation | Already used throughout codebase |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| diff | ^7.0.0 | Text comparison | Showing file diffs for conflict resolution |
| util.parseArgs | built-in | CLI argument parsing | Already used for flags like --force |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| picocolors | chalk | chalk is 15x larger, slower to load; picocolors sufficient |
| diff | custom diff | diff library handles edge cases, unified output format |

**Installation:**
```bash
# picocolors is already a transitive dependency, but explicit is better
bun add picocolors

# diff library for showing file differences in conflict resolution
bun add diff
```

## Architecture Patterns

### Recommended Project Structure

No structural changes needed. New functionality fits existing files:
```
src/
├── wizard.ts        # Add filtering logic, annotation patterns
├── init.ts          # Add --dry-run flag handling
└── types.ts         # Add any new type definitions
```

### Pattern 1: Disabled Items in @clack/prompts

**What:** Mark items as disabled (greyed out) but still visible in select/multiselect
**When to use:** Directory filtering - show filtered directories but prevent selection
**Example:**
```typescript
// Source: @clack/prompts documentation
import * as p from '@clack/prompts';

const result = await p.select({
  message: 'Select a directory',
  options: [
    { value: 'Documents', label: 'Documents/' },
    { value: 'node_modules', label: 'node_modules/', disabled: true, hint: 'cache dir' },
    { value: '.git', label: '.git/', disabled: true, hint: 'version control' },
  ],
});
```

### Pattern 2: Terminal Coloring with picocolors

**What:** Add colors without method chaining (nested function calls)
**When to use:** Dry-run output, status indicators, warnings
**Example:**
```typescript
// Source: picocolors README
import pc from 'picocolors';

// Basic colors
console.log(pc.green('New symlink'));
console.log(pc.yellow('Would replace'));
console.log(pc.red('Conflict'));

// Dim text for skipped/disabled items
console.log(pc.dim('node_modules — skipped (cache dir)'));

// Combined styling (nested, not chained)
console.log(pc.bold(pc.green('Success!')));
console.log(pc.dim(pc.yellow('Warning text')));

// Check if colors supported
if (pc.isColorSupported) {
  // Use colors
}
```

### Pattern 3: Dry-run Pattern

**What:** Run wizard flow but collect actions instead of executing
**When to use:** --dry-run flag implementation
**Example:**
```typescript
type PlannedAction = {
  type: 'create' | 'replace' | 'conflict';
  source: string;
  target: string;
  existingContent?: string; // For showing diffs
};

async function collectActions(links: LinkMap, dryRun: boolean): Promise<PlannedAction[]> {
  const actions: PlannedAction[] = [];

  for (const [source, target] of Object.entries(links)) {
    // ... determine action type
    actions.push({ type, source, target });
  }

  return actions;
}

// In main flow
if (options.dryRun) {
  displayActions(actions);
  const proceed = await confirm('Apply these changes now?');
  if (!proceed) return;
}
// Execute actions...
```

### Pattern 4: File Annotation Pattern

**What:** Categorize files by value and display in groups
**When to use:** Helping users identify valuable vs low-value dotfiles
**Example:**
```typescript
const LOW_VALUE_PATTERNS = [
  /\.cache$/,
  /\.tmp$/,
  /_history$/,
  /\.log$/,
  /\.DS_Store$/,
  /\.localized$/,
  /Thumbs\.db$/,
  /desktop\.ini$/,
];

function isLowValue(filename: string): boolean {
  return LOW_VALUE_PATTERNS.some(p => p.test(filename));
}

// Group for display
const valuable = files.filter(f => !isLowValue(f.name));
const other = files.filter(f => isLowValue(f.name));

// Display valuable first, then collapsed "Other files"
```

### Anti-Patterns to Avoid
- **Hiding filtered items completely:** User decision says "show but disabled" - hiding confuses users about what's available
- **Method chaining with picocolors:** Unlike chalk, picocolors uses nested calls: `pc.red(pc.bold(text))` not `pc.red.bold(text)`
- **Blocking on every conflict:** User wants per-conflict resolution, but keep flow smooth with clear prompts

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Terminal colors | ANSI escape codes | picocolors | Cross-platform, NO_COLOR support |
| Text diffing | String comparison | diff library | Handles edge cases, standard output format |
| Disabled menu items | Custom rendering | @clack/prompts disabled | Already supported, consistent styling |
| Git conflict markers | Manual string concat | Standard format | Users expect git-style markers |

**Key insight:** The existing @clack/prompts and picocolors stack already supports everything needed. No new UI libraries required.

## Common Pitfalls

### Pitfall 1: False Positive Conflict Detection (THE BUG)

**What goes wrong:** Symlinks pointing to correct target are flagged as conflicts or shown as generic `[exists]`
**Why it happens:** Current `previewSymlinks` (line 1137-1139 in wizard.ts) checks if target is a symlink but doesn't verify where it points
**How to avoid:** After detecting symlink, read target and compare to expected source using `readlink` + `resolve`
**Warning signs:** User sees `[exists]` for correctly linked files, or `[conflict]` for symlinks

**Current buggy code:**
```typescript
// wizard.ts lines 1134-1148
if (targetStat.isSymbolicLink()) {
  // It's a symlink - would need to check if it points to right place
  status = '[exists]';  // BUG: Should verify target!
} else {
  status = '[conflict]';
  hasConflicts = true;
}
```

**Fix pattern:**
```typescript
if (targetStat.isSymbolicLink()) {
  const linkTarget = await readlink(target);
  const resolvedTarget = resolve(dirname(target), linkTarget);
  if (resolvedTarget === source) {
    status = '[already linked]';  // Correct - green checkmark
  } else {
    status = '[wrong target]';    // Different symlink exists
    // Could offer to update
  }
} else {
  status = '[conflict]';          // Real file exists
  hasConflicts = true;
}
```

### Pitfall 2: Hardcoding Filter Lists

**What goes wrong:** Filter patterns scattered across multiple functions
**Why it happens:** Each feature (directory filtering, annotations) adds its own patterns
**How to avoid:** Centralize patterns in config/constants, allow user customization
**Warning signs:** Same pattern defined in multiple places

### Pitfall 3: Breaking Interactive Flow for Dry-Run

**What goes wrong:** Dry-run skips interactive wizard, user can't test actual experience
**Why it happens:** Temptation to short-circuit when dryRun flag is set
**How to avoid:** User decision explicitly states "runs full interactive wizard flow, but doesn't execute"
**Warning signs:** Dry-run produces different output than actual run would

### Pitfall 4: Losing User Input on Conflict Resolution

**What goes wrong:** User makes conflict resolution choices, but choices aren't saved on error
**Why it happens:** All-or-nothing execution
**How to avoid:** Collect all decisions first, then execute, allow partial rollback
**Warning signs:** User has to re-answer prompts after partial failure

## Code Examples

Verified patterns from the existing codebase and official sources:

### Reading Symlink Target (from index.ts)
```typescript
// Source: existing codebase index.ts lines 228-233
async function resolveSymlinkTarget(linkPath: string): Promise<string> {
  const raw = await readlink(linkPath);
  return resolve(dirname(linkPath), raw);
}
```

### Checking Symlink Points to Expected Source (from index.ts)
```typescript
// Source: existing codebase index.ts lines 247-265
async function linksToExpectedResolved(
  resolvedDest: string,
  expectedSource: string,
): Promise<boolean> {
  const expectedAbs = resolve(expectedSource);
  const realDest = await tryRealpath(resolvedDest);
  const realSource = await tryRealpath(expectedAbs);

  if (realDest !== null && realSource !== null) {
    return realDest === realSource;
  }
  return resolvedDest === expectedAbs;
}
```

### Git Conflict Marker Format
```typescript
// Source: git documentation
const conflictMarkers = `<<<<<<< Current (your dotfiles repo)
${repoContent}
=======
${localContent}
>>>>>>> Incoming (local file)
`;
```

### Using diff Library for Unified Output
```typescript
// Source: jsdiff documentation
import { createPatch } from 'diff';

const patch = createPatch(
  filename,
  oldContent,
  newContent,
  'repo version',
  'local version'
);
// Returns unified diff format suitable for display
```

### Adding --dry-run Flag (following existing pattern)
```typescript
// Source: existing pattern from parseInitArgs in init.ts
export function parseInitArgs(args: string[]): InitOptions {
  const options: InitOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    // ... existing flags
    if (arg === "--dry-run") {
      options.dryRun = true;
    }
  }

  return options;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| chalk for colors | picocolors | 2022+ | 15x smaller, faster |
| inquirer for prompts | @clack/prompts | 2023+ | Better UX, modern design |
| Manual conflict detection | Symlink-aware checking | This phase | Fixes false positives |

**Deprecated/outdated:**
- chalk: Still works but picocolors preferred for size/speed
- inquirer: @clack/prompts provides better UX

## Open Questions

Things that couldn't be fully resolved:

1. **User config file location for custom patterns**
   - What we know: dot.config.json exists, has `ignorePatterns` array
   - What's unclear: Should annotation patterns also go there, or separate?
   - Recommendation: Extend `ignorePatterns` or add parallel `annotationPatterns` to dot.config.json

2. **Backup file naming convention**
   - What we know: User said Claude's discretion on `.backup` vs `.bak` vs timestamped
   - What's unclear: No strong community standard
   - Recommendation: Use `.backup` for simplicity, or `.backup-YYYYMMDD` if multiple backups needed

3. **Exact behavior when user overrides filter**
   - What we know: User wants confirmation warning ("Are you sure?")
   - What's unclear: What happens after confirmation - add to permanent allowlist or one-time?
   - Recommendation: One-time for this run, suggest adding to config if they want permanent

## Sources

### Primary (HIGH confidence)
- Existing codebase (`/Users/brendon/.dotfiles/dot/src/wizard.ts`, `init.ts`, `index.ts`) - Conflict detection bug identified, existing patterns documented
- [picocolors README](https://github.com/alexeyraspopov/picocolors) - API documentation
- [@clack/prompts documentation](https://bomb.sh/docs/clack/basics/getting-started/) - Disabled items, select/multiselect APIs

### Secondary (MEDIUM confidence)
- [jsdiff GitHub](https://github.com/kpdecker/jsdiff) - Diff library API for conflict resolution
- [Git merge documentation](https://git-scm.com/docs/git-merge) - Conflict marker format

### Tertiary (LOW confidence)
- Web search results for terminal color comparisons - Verified picocolors is current standard

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Using existing dependencies, well-documented
- Architecture: HIGH - Following existing patterns in codebase
- Pitfalls: HIGH - Bug identified with specific line numbers

**Research date:** 2026-02-01
**Valid until:** 2026-03-01 (stable libraries, unlikely to change)
