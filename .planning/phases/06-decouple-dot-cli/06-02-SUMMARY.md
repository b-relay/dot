---
phase: 06-decouple-dot-cli
plan: 02
subsystem: cli
tags: [bun, clack, prompts, wizard, interactive, init, symlinks, scanning]

# Dependency graph
requires:
  - phase: 06-01
    provides: Config loading, state persistence, getDotfilesPath
provides:
  - Interactive init wizard for first-run setup
  - Directory browser for path selection
  - Deep symlink scanning with broken link detection
  - Manual symlink resolution for edge cases
  - Config generation from user selections
affects: [06-03, 06-04, 06-05]

# Tech tracking
tech-stack:
  added: ["@clack/prompts"]
  removed: ["bun-promptx"]
  patterns:
    - "Async prompt functions with UserCancelledError"
    - "Directory browser with navigation options"
    - "Recursive symlink scanning with skip lists"
    - "Broken symlink detection via stat() verification"

key-files:
  created:
    - dot/src/wizard.ts
    - dot/src/init.ts
  modified:
    - dot/index.ts
    - dot/package.json

key-decisions:
  - "Switched from bun-promptx to @clack/prompts based on user feedback for better UI"
  - "Directory browser instead of text input for path selection"
  - "Deep scanning (3-4 levels) of ~/, ~/.config/, ~/Library/Application Support/"
  - "Smart skip lists for large directories (Downloads, node_modules, etc.)"
  - "Manual symlink resolution option for edge cases"
  - "Broken symlink detection and separate display"

patterns-established:
  - "checkCancel() wrapper for p.isCancel() checks"
  - "intro/outro/cancel for wizard flow messaging"
  - "Directory browser pattern for file/folder selection"
  - "DotfileStatus enum for categorizing file state"
  - "DiscoveredSymlink type with targetExists for broken detection"
  - "scanDirectoryForSymlinks() with configurable depth and skip lists"

# Metrics
duration: ~45min (extended due to iterative refinement)
completed: 2026-02-01
---

# Phase 06 Plan 02: Init Wizard Summary

**Interactive init wizard with @clack/prompts, deep symlink scanning, broken link detection, and manual resolution**

## Performance

- **Duration:** ~45 min (extended due to iterative refinement)
- **Started:** 2026-02-01T04:43:43Z
- **Completed:** 2026-02-01
- **Tasks:** 2 original + 13 iterative improvements
- **Files modified:** 4

## Accomplishments

- Interactive `dot init` command for first-run setup
- Directory browser with navigation (up/down, create folder)
- Deep symlink scanning (3-4 levels) across multiple directories:
  - `~/` (home root, depth 3)
  - `~/.config/` (depth 4)
  - `~/Library/Application Support/` (macOS, depth 4)
- Smart skip lists for large directories (Downloads, node_modules, .cache, etc.)
- Broken symlink detection with separate warning display
- Manual "Add more symlinks" option for unusual locations
- Spinner with progress indication during scan
- Categorizes files as: already-linked, broken-link, in-repo, available, conflict
- Only offers to migrate files not already tracked
- Multi-select UI for choosing dotfiles to migrate
- Config generation (dot.config.json) from user selections
- Git repository initialization in dotfiles folder
- Clean Ctrl+C handling that exits wizard immediately

## Task Commits

Each improvement was committed atomically:

| # | Commit | Type | Description |
|---|--------|------|-------------|
| 1 | `33b9e30` | feat | Initial wizard helpers with bun-promptx |
| 2 | `8f0dcd8` | feat | Implement dot init command |
| 3 | `73d5325` | fix | Custom path input and Ctrl+C handling |
| 4 | `71c2133` | refactor | Switch to @clack/prompts |
| 5 | `6870718` | feat | Add directory browser |
| 6 | `add4a68` | fix | Smart scanning respects existing dotfiles |
| 7 | `9b17788` | fix | Improve detection and messaging |
| 8 | `fd9936e` | fix | Skip repo files already linked from different locations |
| 9 | `5cb01fd` | fix | Scan ~/.config subdirectories |
| 10 | `3ce5553` | feat | Deeper scanning and manual symlink resolution |
| 11 | `85d4846` | feat | Clearer messaging and broader symlink scanning |
| 12 | `7b52e41` | feat | Add spinner while scanning |
| 13 | `7144f83` | fix | Clarify spinner message about skipped directories |
| 14 | `8d1a500` | fix | Display ALL discovered symlinks, not just COMMON_DOTFILES |
| 15 | `6c3be86` | feat | Detect and display broken symlinks |

## Files Created/Modified

- `dot/src/wizard.ts` - Interactive prompt helpers, directory browser, symlink scanning
- `dot/src/init.ts` - Init command implementation with full setup flow
- `dot/index.ts` - Added init command routing, deleted state folder detection
- `dot/package.json` - Added @clack/prompts, removed bun-promptx

## Key Features

### 1. Deep Symlink Scanning
Recursively scans multiple directories to find existing symlinks pointing to the dotfiles repo:
- `~/` with depth 3 (skipping large dirs)
- `~/.config/` with depth 4
- `~/Library/Application Support/` with depth 4 (macOS)

### 2. Smart Skip Lists
Avoids scanning huge directories that won't contain dotfile symlinks:
- User data: Downloads, Documents, Desktop, Pictures, Music, Movies
- Development: node_modules, .npm, .cargo, go, .virtualenvs
- Cache: .cache, .Trash, .local
- Apps: Steam, Google, Firefox, Discord, Spotify

### 3. Broken Symlink Detection
Verifies each symlink's target actually exists using `stat()`. Broken symlinks are:
- Tracked with `status: 'broken-link'`
- Displayed separately with warning
- Excluded from "already linked" counts

### 4. Manual Resolution Option
When files appear "in-repo but not linked", users can:
- Continue (files really aren't linked)
- Add manual paths (specify symlink locations for each file)
- Validates that paths are symlinks pointing to expected source

### 5. Progress Indication
Spinner shows during scanning with message about skipped directories:
```
Scanning for symlinks (skipping Downloads, node_modules, caches)...
```

## Decisions Made

1. **Switched from bun-promptx to @clack/prompts** - User feedback indicated bun-promptx had poor UX. @clack/prompts provides beautiful visual feedback, proper multiselect with checkboxes, and better Ctrl+C handling.

2. **Directory browser instead of text input** - User requested file selector. Implemented interactive browser starting at home, with navigation into subdirs, going up, and creating new folders.

3. **Deep scanning with skip lists** - Rather than only checking known paths, scan directories recursively but skip large non-config directories to maintain performance.

4. **Broken symlink as separate status** - Rather than ignoring broken symlinks or treating them as errors, display them with a warning so users can fix them.

5. **Manual resolution option** - For edge cases where symlinks are in unusual locations, let users manually specify paths rather than assuming all symlinks are in standard locations.

## Deviations from Plan

### Iterative Improvements (User Feedback)

**1. Custom path had no input UI** (73d5325)
- Selecting "[Enter custom path]" showed nothing
- Added proper text prompt after selection

**2. Ctrl+C continued to next question** (73d5325)
- Pressing Ctrl+C skipped to next prompt instead of exiting
- Added UserCancelledError thrown on cancel

**3. User wanted better selection UI** (71c2133)
- bun-promptx UI wasn't polished enough
- Replaced with @clack/prompts

**4. User wanted directory browser** (6870718)
- Text input for paths is poor UX
- Implemented interactive directory browser

**5. Smart scanning for existing dotfiles** (add4a68)
- Wizard offered to migrate already tracked files
- Added DotfileStatus, scan checks repo state

**6. Detection and messaging improvements** (9b17788)
- Deleted state folder not detected
- File naming assumptions wrong
- Fixed with actual symlink target resolution

**7. Skip already-linked repo files** (fd9936e)
- Files linked from different locations still shown as "not linked"
- Cross-reference against discovered symlinks

**8. Deeper config scanning** (5cb01fd)
- Only scanning 1 level into ~/.config
- Extended to scan subdirectories

**9. Broader and deeper scanning** (3ce5553, 85d4846)
- Need 3-4 level deep scanning
- Added recursive scan with skip lists
- Manual resolution option for edge cases

**10. Progress indication** (7b52e41, 7144f83)
- Deep scanning takes time, no feedback
- Added spinner with descriptive message

**11. Display all discovered symlinks** (8d1a500)
- Only showing COMMON_DOTFILES matches
- Now shows ALL symlinks found during deep scan

**12. Broken symlink detection** (6c3be86)
- Broken symlinks not detected
- Added targetExists check and separate display

---

**Total improvements:** 15 commits across 12 improvement areas
**Impact:** Significantly more robust than original plan. Handles edge cases, provides better UX, and gives users full visibility into their dotfiles setup.

## Issues Encountered

None blocking - all issues were iteratively addressed based on user testing.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Init wizard complete and approved by user
- Ready for 06-03 (track command) which will use similar wizard patterns
- @clack/prompts patterns established for future interactive commands
- Symlink scanning utilities available for reuse

---
*Phase: 06-decouple-dot-cli*
*Plan: 02*
*Completed: 2026-02-01*
