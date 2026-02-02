---
phase: 06-decouple-dot-cli
plan: 01
subsystem: cli
tags: [zod, config, state, typescript, json]

# Dependency graph
requires: []
provides:
  - Config loading from dot.config.json with Zod validation
  - State management for dotfiles path persistence
  - Global --dotfiles flag and DOT_HOME env var support
  - Backward compatibility with existing hardcoded LINKS
affects: [06-02, 06-03, 06-04, 06-05]

# Tech tracking
tech-stack:
  added: [zod@4.3.6]
  patterns: [config-resolution-chain, runtime-validation]

key-files:
  created:
    - dot/src/types.ts
    - dot/src/state.ts
    - dot/src/config.ts
    - dot/tests/config.test.ts
  modified:
    - dot/index.ts
    - dot/package.json

key-decisions:
  - "JSON as primary config format (works with compiled binary)"
  - "TypeScript config secondary, requires bun runtime (not compiled)"
  - "State file at ~/.config/dot/state.json for dotfiles path persistence"
  - "Priority chain: --dotfiles > DOT_HOME > state > ~/.dotfiles fallback"
  - "Legacy links maintained for backward compatibility"

patterns-established:
  - "Config resolution chain with priority-based lookup"
  - "Zod schemas for runtime validation with type inference"
  - "createTestConfig helper pattern for unit tests"

# Metrics
duration: 8 min
completed: 2026-02-01
---

# Phase 6 Plan 1: Config Infrastructure Summary

**External config loading with Zod validation, state management, and full backward compatibility with existing dotfiles setup**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-01T04:30:46Z
- **Completed:** 2026-02-01T04:39:10Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- Config loading from dot.config.json with Zod 4.x validation
- State persistence at ~/.config/dot/state.json for dotfiles path
- Global --dotfiles flag and DOT_HOME env var support
- Priority chain: CLI flag > env var > state file > ~/.dotfiles fallback
- Full backward compatibility - existing setup works unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Zod and create types/state modules** - `9d71682` (chore)
2. **Task 2: Create config loader** - `77428a7` (feat)
3. **Task 3: Integrate config into CLI** - `80d7884` (feat)

## Files Created/Modified

- `dot/src/types.ts` - Zod schemas for LinkMap, DotConfig, DotState
- `dot/src/state.ts` - loadState, saveState, getDotfilesPath functions
- `dot/src/config.ts` - loadConfig, writeConfig, updateConfigLinks functions
- `dot/tests/config.test.ts` - 23 tests for config/state functionality
- `dot/index.ts` - Integrated config loading, global args, initializeDot
- `dot/package.json` - Added zod@4.3.6 dependency
- `dot/tests/*.test.ts` - Updated to use new createConfig signature

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| JSON primary, TS secondary | Compiled binaries cannot dynamically import TS files |
| State at ~/.config/dot/ | XDG Base Directory pattern for config |
| Priority: flag > env > state > default | Standard CLI config resolution pattern |
| Legacy LINKS as fallback | Existing users get seamless migration |
| Zod 4.x for validation | Runtime type safety with TypeScript inference |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed state path evaluated at runtime**
- **Found during:** Task 3 (config tests failing)
- **Issue:** STATE_PATH was evaluated at module load time, so changing HOME in tests didn't affect the path
- **Fix:** Changed to getStatePath() function that evaluates HOME at runtime
- **Files modified:** dot/src/state.ts
- **Verification:** All 23 config tests now pass
- **Committed in:** 80d7884 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (blocking issue)
**Impact on plan:** Fix was necessary for testability. No scope creep.

## Issues Encountered

None - all verifications passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Config infrastructure complete and tested
- Ready for Plan 06-02: Init wizard for first-run setup
- writeConfig and updateConfigLinks exported for use by track command (Plan 06-03)
- All 183 tests passing across 8 test files

---
*Phase: 06-decouple-dot-cli*
*Completed: 2026-02-01*
