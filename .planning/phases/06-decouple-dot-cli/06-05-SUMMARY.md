---
phase: 06-decouple-dot-cli
plan: 05
status: complete
started: 2026-02-01
completed: 2026-02-01
duration: ~20 min
---

# Plan 06-05: Standalone Binary Distribution - Summary

## What Was Built

Standalone binary distribution system for the dot CLI, enabling use without cloning the dotfiles repo.

## Key Changes

### dot/package.json

- Added `version: "0.1.0"` field
- Added `build:release` script with `--minify` flag for smaller binaries

### dot/src/update.ts (new)

Self-update command placeholder:
- Shows manual update instructions
- Prepared for future GitHub releases integration

### dot/index.ts

- Added `VERSION` constant ("0.1.0")
- Added `--version` / `-v` flag support
- Added `update` command routing
- Version displayed in help output
- **Critical fix:** `createConfig()` now resolves link paths:
  - Source paths resolved relative to dotfilesPath
  - Target paths have `~` expanded to HOME

### install.sh (existing)

Already had comprehensive install script with:
- Interactive location selection
- SSH/HTTPS auth handling
- PATH check with guidance
- Prerequisite validation (git, brew, bun)

## Verification Results

### Binary Distribution

| Test | Result |
|------|--------|
| `bun run build:release` | ✅ Produces 55MB minified binary |
| Binary works without Bun | ✅ Standalone executable |
| `dot --version` | ✅ Shows "dot v0.1.0" |
| `dot update` | ✅ Shows manual update instructions |

### Submodule Removal (Critical)

Tested in `/tmp/decoupled-test/` with dotfiles repo containing NO dot/ submodule:

| Test | Result |
|------|--------|
| Create dotfiles with dot.config.json only | ✅ |
| `dot install` creates symlinks | ✅ |
| Symlinks point to correct paths | ✅ |
| File content accessible | ✅ |
| `dot uninstall` removes symlinks | ✅ |

**Confirmed:** The standalone binary works completely independently of any dot/ submodule.

## Commits

- `e7244ae` feat(06-05): add version, update command, and release build
- `fabc7e7` fix(06-05): resolve relative source paths and expand ~ in targets

## Artifacts

| File | Purpose |
|------|---------|
| dot/src/update.ts | Self-update command |
| install.sh | Installation script (pre-existing) |

## Architecture Note

The dot CLI is now fully decoupled:
- Can be installed standalone via `install.sh`
- Works with any dotfiles repo structure
- Only requires `dot.config.json` in the dotfiles root
- State stored in `~/.config/dot/state.json` pointing to dotfiles location
