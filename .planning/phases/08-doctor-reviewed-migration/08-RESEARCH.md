# Phase 8: Doctor-Reviewed Migration - Research

**Researched:** 2026-02-01
**Domain:** Interactive CLI prompts, JSON state management, date handling
**Confidence:** HIGH

## Summary

This phase migrates doctor-reviewed paths from `~/.dotfiles/.doctor-reviewed.json` to `~/.config/dot/reviewed.json` and adds flexible ignore durations (1 month, custom days, forever). The implementation uses the existing `@clack/prompts` library for interactive menus and follows established patterns in the codebase for state file management.

The main technical challenges are:
1. Designing a JSON schema that supports both timed and permanent ignores
2. Implementing the arrow-key selection UI for ignore options
3. Adding the `dot ignore --list` and `dot ignore --unignore` commands

**Primary recommendation:** Extend the existing reviewed.json format with a `type` field to distinguish between timed and permanent ignores, using ISO 8601 date strings consistent with the rest of the codebase.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @clack/prompts | ^1.0.0 | Interactive prompts | Already in use, provides select/text/confirm prompts |
| picocolors | ^1.1.1 | Terminal styling | Already in use, lightweight |
| zod | ^4.3.6 | Schema validation | Already in use for config/state types |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js fs/promises | built-in | File operations | mkdir, stat operations |
| path module | built-in | Path manipulation | dirname, resolve |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @clack/prompts | inquirer | Heavier, different API from existing code |
| zod | io-ts | Less familiar, more complex |

**Installation:**
No new dependencies required - all needed libraries are already installed.

## Architecture Patterns

### Recommended File Location
```
~/.config/dot/
  state.json       # Existing - dotfiles path
  reviewed.json    # New - ignored paths
```

This follows the existing XDG Base Directory pattern already established for `state.json`.

### Pattern 1: Discriminated Union for Ignore Types
**What:** Use a `type` field to distinguish between timed ignores and permanent ("forever") ignores
**When to use:** When an entry can have fundamentally different expiration semantics
**Example:**
```typescript
// Source: Existing codebase patterns (state.ts, types.ts)
type ReviewedEntry =
  | { type: 'timed'; expiresAt: string }  // ISO 8601 date
  | { type: 'forever' };

type ReviewedPaths = Record<string, ReviewedEntry>;

// Example reviewed.json:
{
  "~/.config/some-app": { "type": "timed", "expiresAt": "2026-03-01" },
  "~/.old-config": { "type": "forever" }
}
```

### Pattern 2: Human-Readable Date Format
**What:** Use YYYY-MM-DD format for expiry dates (consistent with existing code)
**When to use:** All date storage in reviewed.json
**Example:**
```typescript
// Source: Existing codebase pattern (index.ts:1116)
const today = new Date().toISOString().split("T")[0]!;  // "2026-02-01"

function calculateExpiryDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split("T")[0]!;
}
```

### Pattern 3: Select Menu with Dynamic Follow-up
**What:** Arrow-key selection with text input for custom option
**When to use:** When one option requires additional input
**Example:**
```typescript
// Source: @clack/prompts documentation
import * as p from '@clack/prompts';

const choice = await p.select({
  message: 'How long to ignore this path?',
  options: [
    { value: '1-month', label: '1 month', hint: 'expires Mar 1' },
    { value: 'forever', label: 'Forever', hint: 'permanent' },
    { value: 'custom', label: 'Custom days', hint: 'enter number' },
    { value: 'skip', label: "Don't ignore" },
  ],
});

if (choice === 'custom') {
  const days = await p.text({
    message: 'Number of days:',
    validate: (value) => {
      const num = parseInt(value, 10);
      if (isNaN(num) || num <= 0) return 'Enter a positive number';
      return undefined;
    },
  });

  // Confirm if > 999 days
  if (parseInt(days, 10) > 999) {
    const confirm = await p.confirm({
      message: `Ignore for ${days} days (${Math.round(parseInt(days, 10) / 365)} years)? This seems long.`,
    });
    if (!confirm) { /* re-prompt or cancel */ }
  }
}
```

### Anti-Patterns to Avoid
- **Storing computed expiry dates:** Store the raw input (days or "forever") and compute expiry at runtime - NO, this makes it harder to display "expires on X date" and harder for manual editing. Store the final expiry date.
- **Using Date objects in JSON:** JSON has no native date type. Always store as ISO 8601 strings.
- **Mixing permanent and timed in same field:** Using a magic date like "9999-12-31" for forever - makes the file less readable and edge cases harder.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Interactive prompts | Custom readline | @clack/prompts | Consistent UX, arrow keys, cancellation handling |
| Date arithmetic | Manual math | Native Date.setDate() | Handles month/year boundaries correctly |
| Path expansion | Manual string replace | Existing normalizePath() | Already handles ~, relative paths |
| File existence | try/catch stat | Existing pathExists() | Already in codebase |

**Key insight:** The codebase already has utilities for most of these operations. Follow existing patterns rather than introducing new ones.

## Common Pitfalls

### Pitfall 1: Migration Path Conflicts
**What goes wrong:** Paths stored with different formats (~/path vs /home/user/path) don't match
**Why it happens:** Inconsistent path normalization
**How to avoid:** Always normalize paths before storing and comparing using existing `normalizePath()` function
**Warning signs:** Same file appearing multiple times in ignore list, ignores not working

### Pitfall 2: Timezone Issues with Dates
**What goes wrong:** Expiry date calculated in local timezone but compared in UTC
**Why it happens:** JavaScript Date() behavior varies based on string format
**How to avoid:** Use date-only strings (YYYY-MM-DD) which are timezone-agnostic for day-level comparisons
**Warning signs:** Paths expiring early/late by up to a day

### Pitfall 3: JSON Parse Errors on Corrupted File
**What goes wrong:** User manually edits reviewed.json with invalid JSON
**Why it happens:** File is meant to be human-editable
**How to avoid:** Wrap JSON.parse in try/catch, return empty object on failure (existing pattern)
**Warning signs:** Doctor command crashing

### Pitfall 4: Race Conditions in Read-Modify-Write
**What goes wrong:** Two processes read, modify, and write simultaneously, losing changes
**Why it happens:** No file locking
**How to avoid:** This is low risk for a CLI tool - only one instance typically runs at a time. Accept the limitation.
**Warning signs:** Ignore entries disappearing

### Pitfall 5: Breaking Existing Review Flow
**What goes wrong:** Changing the reviewed.json location breaks existing doctor ignore commands
**Why it happens:** CONTEXT.md says "no migration needed - no existing users"
**How to avoid:** Simply use new path. If migration were needed, would read old file on first run.
**Warning signs:** N/A - no migration required

## Code Examples

Verified patterns from official sources and existing codebase:

### Reading/Writing Reviewed Paths (Updated Format)
```typescript
// Source: Adapted from existing index.ts pattern
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

type ReviewedEntry =
  | { type: 'timed'; expiresAt: string }
  | { type: 'forever' };

type ReviewedPaths = Record<string, ReviewedEntry>;

// Location: ~/.config/dot/reviewed.json
function getReviewedFilePath(): string {
  return `${process.env.HOME}/.config/dot/reviewed.json`;
}

async function readReviewedPaths(): Promise<ReviewedPaths> {
  const file = Bun.file(getReviewedFilePath());
  if (await file.exists()) {
    try {
      return await file.json();
    } catch {
      return {};  // Corrupted file - start fresh
    }
  }
  return {};
}

async function writeReviewedPaths(paths: ReviewedPaths): Promise<void> {
  const filePath = getReviewedFilePath();
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, JSON.stringify(paths, null, 2) + "\n");
}
```

### Checking Expiry
```typescript
// Source: Adapted from existing isReviewedRecently pattern
function isIgnored(entry: ReviewedEntry, now: Date = new Date()): boolean {
  if (entry.type === 'forever') {
    return true;  // Never expires
  }

  const expiryDate = new Date(entry.expiresAt + 'T00:00:00');
  return now < expiryDate;
}

function getActiveReviewed(paths: ReviewedPaths): ReviewedPaths {
  const now = new Date();
  const active: ReviewedPaths = {};

  for (const [path, entry] of Object.entries(paths)) {
    if (isIgnored(entry, now)) {
      active[path] = entry;
    }
  }

  return active;
}
```

### Ignore Duration Selection
```typescript
// Source: @clack/prompts documentation
import * as p from '@clack/prompts';

type IgnoreDuration =
  | { type: '1-month' }
  | { type: 'forever' }
  | { type: 'custom'; days: number }
  | { type: 'skip' };

async function promptIgnoreDuration(path: string): Promise<IgnoreDuration> {
  // Calculate preview dates for hints
  const oneMonthExpiry = calculateExpiryDate(30);

  const choice = await p.select({
    message: `Ignore ${path}?`,
    options: [
      { value: '1-month', label: '1 month', hint: `until ${formatDate(oneMonthExpiry)}` },
      { value: 'forever', label: 'Forever', hint: 'permanent' },
      { value: 'custom', label: 'Custom', hint: 'enter days' },
      { value: 'skip', label: "Don't ignore" },
    ],
  });

  if (p.isCancel(choice)) {
    return { type: 'skip' };
  }

  if (choice === 'custom') {
    const daysInput = await p.text({
      message: 'Number of days:',
      validate: (value) => {
        const num = parseInt(value, 10);
        if (isNaN(num) || num <= 0) return 'Enter a positive number';
        return undefined;
      },
    });

    if (p.isCancel(daysInput)) {
      return { type: 'skip' };
    }

    const days = parseInt(daysInput as string, 10);

    // Confirm if > 999 days (catches typos like 3000 instead of 30)
    if (days > 999) {
      const years = Math.round(days / 365);
      const confirm = await p.confirm({
        message: `Ignore for ${days} days (~${years} years)?`,
        initialValue: false,
      });

      if (p.isCancel(confirm) || !confirm) {
        return { type: 'skip' };
      }
    }

    return { type: 'custom', days };
  }

  return { type: choice as '1-month' | 'forever' | 'skip' };
}
```

### Listing Ignored Paths
```typescript
// Source: Existing CLI pattern
async function listIgnored(): Promise<void> {
  const paths = await readReviewedPaths();
  const active = getActiveReviewed(paths);

  if (Object.keys(active).length === 0) {
    p.log.info('No ignored paths');
    return;
  }

  p.log.step('Ignored paths:');
  for (const [path, entry] of Object.entries(active)) {
    if (entry.type === 'forever') {
      console.log(`  ${path} (permanent)`);
    } else {
      console.log(`  ${path} (until ${entry.expiresAt})`);
    }
  }
}
```

### Inline Confirmation Message
```typescript
// Source: CONTEXT.md decision
function formatIgnoreConfirmation(entry: ReviewedEntry): string {
  if (entry.type === 'forever') {
    return 'Ignored permanently';
  }
  // Format date like "Mar 15" for brevity
  const date = new Date(entry.expiresAt);
  const month = date.toLocaleString('en-US', { month: 'short' });
  const day = date.getDate();
  return `Ignored until ${month} ${day}`;
}

// Usage: p.log.success(formatIgnoreConfirmation(entry));
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Store in dotfiles repo | Store in ~/.config/dot/ | This phase | Machine-specific, not synced |
| Fixed 90-day expiry | Flexible duration | This phase | User control |
| No way to list ignores | `dot ignore --list` | This phase | Visibility |

**Deprecated/outdated:**
- `.doctor-reviewed.json` in dotfiles repo: Moving to `~/.config/dot/reviewed.json`
- `REVIEW_EXPIRY_DAYS` constant: Replaced by per-entry expiry dates

## Open Questions

Things that couldn't be fully resolved:

1. **Date display format for hints**
   - What we know: Need to show expiry date in selection hints and confirmations
   - What's unclear: Whether to use "Mar 15" or "2026-03-15" format
   - Recommendation: Use "Mar 15" for brevity in prompts, store full ISO date in JSON

2. **Custom days input UX after selection**
   - What we know: @clack/prompts `text()` follows `select()` naturally
   - What's unclear: Whether to inline the text input or make it a separate step
   - Recommendation: Separate `p.text()` call is cleaner and matches existing patterns

3. **Path display in ignore prompt**
   - What we know: CONTEXT.md marks this as Claude's discretion
   - Options: Path only vs path + reason from doctor analysis
   - Recommendation: Path only - keeps prompt simple, reason is visible above in doctor output

## Sources

### Primary (HIGH confidence)
- Existing codebase (`index.ts`, `state.ts`, `wizard.ts`, `types.ts`) - patterns for file I/O, date handling, prompts
- @clack/prompts GitHub documentation - API usage for select, text, confirm

### Secondary (MEDIUM confidence)
- [XDG Base Directory - ArchWiki](https://wiki.archlinux.org/title/XDG_Base_Directory) - ~/.config convention
- [JSON date format best practices](https://jsoneditoronline.org/indepth/parse/json-date-format/) - ISO 8601 recommendation

### Tertiary (LOW confidence)
- None - all patterns verified against existing codebase or official documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Using existing libraries already in package.json
- Architecture: HIGH - Following established patterns in codebase
- Pitfalls: MEDIUM - Based on general experience with similar features

**Research date:** 2026-02-01
**Valid until:** 2026-03-01 (30 days - stable domain)
