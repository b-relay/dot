---
phase: 08-doctor-reviewed-migration
plan: 01
subsystem: doctor
tags: [doctor, reviewed-paths, xdg, schema]

dependency-graph:
  requires:
    - 07-init-wizard-fixes (base wizard functionality)
  provides:
    - ReviewedEntry discriminated union type
    - XDG-compliant reviewed.json at ~/.config/dot/
    - isIgnored() for checking entry expiry
    - getActiveReviewed() for filtering expired entries
    - getExpiredPaths() for finding expired paths
  affects:
    - 08-02 (duration selection UI)
    - 08-03 (auto-cleanup integration)

tech-stack:
  patterns:
    - Discriminated union for entry types (timed | forever)
    - XDG Base Directory pattern (~/.config/dot/)
    - YYYY-MM-DD date string comparison (lexicographically sortable)

key-files:
  created: []
  modified:
    - index.ts
    - tests/index.test.ts
    - tests/doctor.test.ts
    - tests/integration.test.ts

decisions:
  - id: reviewed-entry-schema
    choice: "Discriminated union with type field"
    rationale: "Clear type safety, extensible for future entry types"
  - id: date-comparison
    choice: "String comparison of YYYY-MM-DD format"
    rationale: "Lexicographic comparison works correctly, simpler than Date parsing"
  - id: expiry-semantics
    choice: "expiresAt <= today means expired"
    rationale: "On the expiry date, the ignore is no longer active"

metrics:
  duration: 12min
  completed: 2026-02-01
---

# Phase 08 Plan 01: Reviewed Paths Schema Migration Summary

ReviewedEntry discriminated union with XDG storage location at ~/.config/dot/reviewed.json, supporting both timed (30-day default) and permanent forever ignores.

## What Was Done

### Task 1: Update reviewed paths type and storage location
- Replaced flat `Record<string, string>` with discriminated union `ReviewedEntry`
- Added `getReviewedFilePath()` returning `~/.config/dot/reviewed.json`
- Updated `readReviewedPaths()` and `writeReviewedPaths()` to not require config parameter
- Created `isIgnored()` for checking if an entry is still active
- Created `getActiveReviewed()` for filtering expired entries
- Created `getExpiredPaths()` for finding expired paths
- Removed `REVIEW_EXPIRY_DAYS`, `isReviewedRecently()`, `getExpiryDate()`
- Removed `reviewedFile` from Config type

**Commit:** `fdf2f41` feat(08-01): migrate reviewed paths to XDG location with new schema

### Task 2: Update callers to use new reviewed paths API
- Updated `markAsReviewed()` to accept `ReviewedEntry` instead of date string
- Updated `doctorIgnore()` to create 30-day timed entries
- Updated `doctor()` to use `getActiveReviewed()` and `getExpiredPaths()`
- Updated exports to include new functions and types

**Commit:** Included in `fdf2f41`

### Task 3: Update tests for new reviewed paths API
- Replaced `isReviewedRecently` tests with `isIgnored` tests
- Added `getActiveReviewed` and `getExpiredPaths` tests
- Added `getReviewedFilePath` test
- Updated doctor.test.ts to use new `ReviewedEntry` schema
- Updated `markAsReviewed` tests for new function signature
- Removed `reviewedFile` assertion from integration tests

**Commit:** `00d8558` test(08-01): update tests for new reviewed paths schema

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

1. **TypeScript compiles:** All code compiles without errors
2. **Tests pass:** 218 tests passing (0 failures)
3. **Manual verification:**
   - `bun run index.ts doctor ignore ~/Desktop` creates entry at `~/.config/dot/reviewed.json`
   - Entry has correct schema: `{ "type": "timed", "expiresAt": "2026-03-04" }`

## Key Implementation Details

### ReviewedEntry Type
```typescript
type ReviewedEntry =
  | { type: 'timed'; expiresAt: string }  // YYYY-MM-DD format
  | { type: 'forever' };

type ReviewedPaths = Record<string, ReviewedEntry>;
```

### Date Comparison Logic
```typescript
function isIgnored(entry: ReviewedEntry, now: Date = new Date()): boolean {
  if (entry.type === 'forever') return true;
  const today = now.toISOString().split('T')[0]!;
  return entry.expiresAt > today;  // Lexicographic comparison works for YYYY-MM-DD
}
```

## Next Phase Readiness

Plan 08-02 can proceed to add:
- Duration selection UI (30 days, 90 days, 1 year, forever)
- Interactive prompts for choosing ignore duration
- The `ReviewedEntry` schema already supports `forever` type

No blockers identified.
