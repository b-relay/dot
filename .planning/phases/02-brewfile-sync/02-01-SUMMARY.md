---
phase: 02-brewfile-sync
plan: 01
subsystem: cli
tags: [homebrew, brewfile, dotfiles, bun, typescript]

# Dependency graph
requires:
  - phase: 01-dependency-checking
    provides: dependency checking infrastructure in doctor command
provides:
  - Bidirectional brewfile sync checking in dot doctor
  - parseBrewfile, getInstalledPackages, checkBrewfileSync functions
  - BrewfilePackage and BrewfileSyncStatus types
affects: [03-sync-improvements]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Brewfile parsing with regex for brew/cask lines
    - Tap path normalization for package matching

key-files:
  created:
    - dot/tests/brewfile.test.ts
  modified:
    - dot/index.ts

key-decisions:
  - "Tap path matching extracts last segment (oven-sh/bun/bun -> bun)"
  - "Untracked packages shown as informational only (no auto-add suggestion)"
  - "brew bundle install hint shown only when packages missing from system"

patterns-established:
  - "Brewfile parsing with description extraction from preceding comment"
  - "Integration with real brew commands using .nothrow().quiet() pattern"

# Metrics
duration: 5min
completed: 2026-01-25
---

# Phase 2 Plan 1: Brewfile Sync Checking Summary

**Bidirectional brewfile comparison in dot doctor showing missing and untracked packages with brew bundle install hint**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-25T21:00:00Z
- **Completed:** 2026-01-25T21:05:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added bidirectional brewfile sync checking to dot doctor command
- Shows packages in brewfile but not installed (with brew bundle install hint)
- Shows installed packages not tracked in brewfile (informational only)
- Handles tap paths correctly (oven-sh/bun/bun matches installed bun)
- Added 12 comprehensive tests for brewfile parsing and sync checking

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement brewfile sync checking** - `729dd4c` (feat)
2. **Task 2: Add tests for brewfile sync checking** - `4c4fc2c` (test)

## Files Created/Modified
- `dot/index.ts` - Added BrewfilePackage/BrewfileSyncStatus types, parseBrewfile, getInstalledPackages, checkBrewfileSync, printBrewfileStatus functions
- `dot/tests/brewfile.test.ts` - 181 lines of tests for brewfile sync functionality

## Decisions Made
- Tap path matching uses last segment only (e.g., `oven-sh/bun/bun` matches `bun`) - required for correct comparison with `brew list` output
- Untracked packages shown as informational with no add suggestion - per requirements, to avoid auto-modifying brewfile
- Description extracted from comment on preceding line in brewfile - preserves brew bundle dump format

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Brewfile sync checking complete and tested
- Ready for Phase 3 (Sync Improvements) which can enhance the sync command
- All success criteria met:
  - BREW-01: dot doctor compares installed packages against homebrew/brewfile
  - BREW-02: Missing brewfile packages shown with check/cross status
  - BREW-03: brew bundle install command shown when packages missing
  - BREW-04: Untracked packages shown as informational only

---
*Phase: 02-brewfile-sync*
*Completed: 2026-01-25*
