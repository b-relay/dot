---
phase: 06-decouple-dot-cli
plan: 03
status: complete
started: 2026-01-31
completed: 2026-02-01
duration: ~15 min (including verification)
---

# Plan 06-03: Track Command - Summary

## What Was Built

`dot track <path>` command to add new dotfiles to the repository with interactive folder selection.

## Key Changes

### dot/src/track.ts (new)

Track command implementation with:
- `track(targetPath, dotfilesPath, config, options)` - main function
- `selectDestinationFolder(dotfilesPath)` - interactive folder picker
- `parseTrackArgs(args)` - argument parsing

Features:
- Interactive numbered menu for destination selection (existing folders, [new folder], [root])
- Custom filename option (defaults to original name)
- Conflict detection with backup option
- Preview before execution
- Auto-commit support via `config.autoCommit`
- `--as <path>` flag for non-interactive use
- `--force` flag to skip confirmations

### dot/index.ts

- Added `track` command routing
- Imports and calls track function with loaded config

## Verification Results

Tested in isolated `/tmp/dot-track-test/` environment:

| Test | Result |
|------|--------|
| Select [root] folder | ✅ File placed at dotfiles root |
| Create [new folder] | ✅ Creates folder and places file |
| Custom filename | ✅ Renames correctly |
| Default filename | ✅ Preserves original name exactly |
| `--as` flag | ✅ Skips interactive prompts |
| `--force` flag | ✅ Skips confirmation |
| Symlink creation | ✅ Points to dotfiles repo |
| Config update | ✅ Adds entry like `"bash/bashrc": "~/.bashrc"` |

## Commits

- `82cf929` feat(06-03): implement track command for adding dotfiles

## Artifacts

| File | Purpose |
|------|---------|
| dot/src/track.ts | Track command implementation |

## Dependencies Used

- 06-01: `updateConfigLinks` from config.ts for updating dot.config.json
