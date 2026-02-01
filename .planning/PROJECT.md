# Dotfiles CLI Tool

## What This Is

A standalone CLI tool (`dot`) for managing personal dotfiles on macOS. Handles symlink management, dependency checking, brewfile sync, diagnostic analysis, and interactive setup. Works independently of any specific dotfiles repo structure.

## Core Value

Users can set up and manage their dotfiles with confidence — clear guidance, dependency validation, and interactive tools prevent the "install succeeded but nothing works" experience.

## Current State

**Version:** v2.0 (Shipped 2026-02-01)
**Codebase:** 3,032 lines of TypeScript
**Tech stack:** Bun, Zod, @clack/prompts

## Current Milestone: v2.1 Polish & Self-Update

**Goal:** Add self-update capability, improve diagnostics, and refine brewfile/doctor UX based on real usage

**Target features:**
- Self-update from GitHub releases (check + prompt before install)
- Enhanced diagnostics (tool versions, iTerm2 detection)
- Brewfile sync redesign (dynamic type discovery, interactive exclusions)
- Doctor-reviewed improvements (configurable duration, move to ~/.config/dot/)
- Verify recent bug fixes are working correctly

## Requirements

### Validated

- ✓ Symlink management via `dot install` and `dot uninstall` — existing
- ✓ Brewfile sync via `dot sync` — existing
- ✓ Doctor command with Claude analysis — existing
- ✓ Reviewed paths tracking (90-day expiry) — existing
- ✓ Post-install message telling user to run `exec zsh` — v1.0
- ✓ Dependency checking integrated into `dot doctor` — v1.0
- ✓ `dot install` blocks when required dependencies are missing — v1.0
- ✓ Dynamic Homebrew paths in zsh config (Apple Silicon and Intel) — v1.1
- ✓ `dot doctor` detects hardcoded architecture-specific paths — v1.1
- ✓ JetBrains Mono Nerd Font detection — v1.1
- ✓ External config loading from dot.config.json — v2.0
- ✓ Configurable dotfiles location (--dotfiles, DOT_HOME, state) — v2.0
- ✓ Interactive init wizard with symlink discovery — v2.0
- ✓ `dot link` command for adding dotfiles — v2.0
- ✓ `dot move --self` command for relocating dotfiles — v2.0
- ✓ Standalone compiled binary distribution — v2.0

### Active

- Self-update: check for updates, prompt before installing
- Enhanced diagnostics: tool version info in doctor output
- iTerm2 detection for recommended dependencies
- Brewfile sync: dynamic type discovery, interactive exclusion selection
- Brewfile exclusions stored in dot config (no hardcoded defaults)
- Doctor-reviewed path storage moved to ~/.config/dot/
- Configurable ignore duration (default 90 days, allow "forever")

### Out of Scope

- Auto-installing missing dependencies — too invasive, user should control
- Cross-platform support — macOS-only (homebrew, Apple-specific paths)
- Auto-fix hardcoded paths — user should review and approve changes
- Linux/Windows/WSL support — macOS-only by design

## Context

**Milestones shipped:**
- v1.0: Onboarding MVP (dependency checking, install blocking)
- v1.1: Architecture Portability (dynamic Homebrew, path scanning)
- v2.0: Standalone CLI (config loading, init wizard, link/move commands)

**Known future work:**
- (Moved to v2.1 milestone)

## Constraints

- **Tech stack**: TypeScript/Bun, zero external npm dependencies (except zod, @clack/prompts)
- **Compatibility**: macOS only
- **Distribution**: Compiled binary via bun build --compile

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Block install without deps (require --force) | Prevents "nothing works" confusion | ✓ Good |
| Integrate deps into doctor | Keeps CLI simple, one diagnostic command | ✓ Good |
| Required vs Recommended categories | Some tools are critical (starship), others nice-to-have (fzf) | ✓ Good |
| Check /opt/homebrew first then /usr/local | Matches Homebrew's preference for native arch | ✓ Good |
| JSON primary, TS secondary for config | Compiled binaries cannot dynamically import TS | ✓ Good |
| State at ~/.config/dot/state.json | XDG Base Directory pattern | ✓ Good |
| @clack/prompts for wizard UI | Better UX than bun-promptx | ✓ Good |
| Deep scan 3-4 levels for symlinks | Find symlinks in ~/.config subdirs | ✓ Good |

---
*Last updated: 2026-02-01 after starting v2.1 milestone*
