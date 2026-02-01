---
phase: 07
plan: 01
subsystem: wizard
tags: [init, symlink, conflict-detection, bugfix]

dependency-graph:
  requires: []
  provides: ["previewSymlinks-target-verification"]
  affects: ["07-02", "07-03", "07-04"]

tech-stack:
  added: []
  patterns:
    - "symlink target verification using readlink + resolve"
    - "structured preview result with typed status enum"

file-tracking:
  key-files:
    created:
      - tests/wizard.test.ts
    modified:
      - src/wizard.ts

decisions:
  - id: "symlink-status-enum"
    choice: "Typed enum for symlink statuses"
    reason: "Type-safe handling of all symlink scenarios in upstream code"
  - id: "preview-result-structure"
    choice: "Return items array with status and actualTarget"
    reason: "Enables richer UI handling and debugging info"

metrics:
  duration: "~5 minutes"
  completed: "2026-02-01"
---

# Phase 7 Plan 1: Fix previewSymlinks Target Verification Summary

Fixed false conflict detection bug where symlinks were marked as `[exists]` without verifying they point to the correct target.

## What Changed

### src/wizard.ts

**Fixed `previewSymlinks` function (lines 1104-1227):**

1. **Added typed status enum** (`SymlinkPreviewStatus`):
   - `new` - Target doesn't exist, source exists
   - `will-create` - Neither target nor source exist yet
   - `already-linked` - Symlink pointing to correct source
   - `wrong-target` - Symlink pointing elsewhere
   - `conflict` - Real file exists at target

2. **Added proper symlink target verification:**
   ```typescript
   if (targetStat.isSymbolicLink()) {
     const linkTarget = await readlink(target);
     const resolvedTarget = resolve(dirname(target), linkTarget);
     if (resolvedTarget === source) {
       status = 'already-linked';
     } else {
       status = 'wrong-target';
       actualTarget = resolvedTarget;
     }
   }
   ```

3. **Enhanced return type** (`PreviewResult`):
   - `safe: boolean` - False if any conflicts or wrong targets
   - `hasConflicts: boolean` - True if real files exist at targets
   - `hasWrongTargets: boolean` - True if symlinks point elsewhere
   - `items: Array<{source, target, status, actualTarget?}>` - Detailed per-link info

4. **Improved console output:**
   - Shows `[already linked]` for correct symlinks (was `[exists]`)
   - Shows `[wrong target]` with actual target path for mismatched symlinks
   - Added helpful note about using `--force` to update wrong targets

### tests/wizard.test.ts (new file)

Added 8 comprehensive tests covering:
- New status (target missing, source exists)
- Will-create status (neither exists)
- Already-linked status (correct symlink)
- Wrong-target status (symlink to different location)
- Conflict status (real file exists)
- Mixed statuses scenario
- Safe flag logic verification
- Relative symlink handling

## Deviations from Plan

None - plan executed exactly as written.

## Test Results

```
216 pass, 0 fail
745 expect() calls
Ran 216 tests across 11 files [1.69s]
```

8 new tests added for symlink status detection.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| a0f3316 | fix | Verify symlink targets in previewSymlinks |
| 3b20c13 | test | Add tests for symlink status detection |

## Next Phase Readiness

**Phase 7 remaining plans can proceed:**
- 07-02: Directory filtering - no blockers
- 07-03: Dry-run flag - no blockers
- 07-04: File annotations - no blockers

The fixed `previewSymlinks` function now correctly identifies symlink status, providing the foundation for enhanced UI improvements in subsequent plans.
