---
phase: 08-doctor-reviewed-migration
plan: 02
subsystem: doctor
tags: [doctor, ignore, clack-prompts, ui, reviewed-paths]

dependency-graph:
  requires:
    - 08-01 (reviewed paths schema with ReviewedEntry type, isIgnored, getExpiredPaths)
  provides:
    - Interactive ignore duration selection (1 month, Forever, Custom, Don't ignore)
    - dot ignore command with --list and --unignore flags
    - Expired paths notification in doctor output
    - Plain text Claude prompt for terminal display
  affects:
    - 08-03 (if exists, auto-cleanup integration)

tech-stack:
  added: []
  patterns:
    - Arrow-key selection menu via @clack/prompts p.select()
    - Custom input with validation via p.text()
    - Confirmation for unusual values (>999 days)

key-files:
  created: []
  modified:
    - index.ts

decisions:
  - id: duration-options-order
    choice: "1 month, Forever, Custom, Don't ignore"
    rationale: "Common case first, power user options second, escape hatch last"
  - id: custom-days-confirmation
    choice: ">999 days requires confirmation"
    rationale: "Catches typos like 3000 when user meant 30"
  - id: expired-notification-position
    choice: "At very top of doctor output"
    rationale: "User sees it immediately, can re-ignore if desired"

metrics:
  duration: 3min
  completed: 2026-02-02
---

# Phase 08 Plan 02: Ignore Duration Selection & Management Summary

**Interactive duration selection UI with 4 options via @clack/prompts, dot ignore command with --list/--unignore, and expired paths notification at top of doctor output.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-02T04:09:03Z
- **Completed:** 2026-02-02T04:12:20Z
- **Tasks:** 3
- **Files modified:** 1

## Accomplishments

- Users can choose ignore duration via arrow-key menu (1 month, Forever, Custom, Don't ignore)
- Custom days input with validation and >999 confirmation
- `dot ignore --list` shows all ignored paths with expiry info
- `dot ignore --unignore <path>` removes paths from ignore list
- Doctor shows "X paths came back from review" when paths expire
- Claude prompt updated to output plain text for terminal display

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement ignore duration selection UI** - `0036ef6` (feat)
2. **Task 2: Implement dot ignore command with --list and --unignore** - `b872704` (feat)
3. **Task 3: Update doctor to show expired paths notification and fix Claude prompt** - `7f65969` (feat)

## Files Created/Modified

- `index.ts` - Added duration helpers (calculateExpiryDate, formatDateShort, promptIgnoreDuration, choiceToEntry, formatIgnoreConfirmation), ignore management commands (listIgnored, unignorePath), ignore command handling, updated doctor() with expired notification, updated Claude prompt

## Decisions Made

- Duration options ordered: 1 month first (common case), Forever second (power users), Custom third, Don't ignore last - per CONTEXT.md
- Custom days >999 prompts for confirmation to catch typos
- Expired paths notification appears at very top of doctor output (before spinner starts)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- TypeScript error in validate callback: `value` parameter can be `string | undefined`. Fixed by adding `if (!value)` check before parsing.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All ignore duration and management features complete
- Doctor integration complete with expired notification
- Ready for 08-03 if auto-cleanup integration planned

---
*Phase: 08-doctor-reviewed-migration*
*Completed: 2026-02-02*
