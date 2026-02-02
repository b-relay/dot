# Project Milestones: Dotfiles

## v2.0 Standalone CLI (Shipped: 2026-02-01)

**Delivered:** The dot CLI works independently of dotfiles repo structure with configurable links, init wizard, and standalone binary distribution

**Phases completed:** 6 (5 plans total)

**Key accomplishments:**
- External config loading from dot.config.json with Zod validation
- Interactive init wizard with directory browser and deep symlink scanning
- `dot link` command for adding new dotfiles with interactive folder selection
- `dot move --self` command for relocating dotfiles folder with symlink updates
- Standalone compiled binary distribution (55MB, works without Bun)

**Stats:**
- 11 files created/modified
- 3,032 lines of TypeScript
- 1 phase, 5 plans, ~15 tasks
- 1 day from v1.1 to v2.0

**Git range:** `feat(06-01)` → `feat(06-05)`

**What's next:** Enhanced diagnostics with tool version info

---

## v1.1 Architecture Portability (Shipped: 2026-01-26)

**Delivered:** Dotfiles work on both Apple Silicon and Intel Macs without manual configuration changes

**Phases completed:** 4-5 (2 plans total)

**Key accomplishments:**
- Dynamic Homebrew detection in zprofile (Apple Silicon or Intel)
- Architecture-portable fzf and bun completions using $(brew --prefix)
- `dot doctor` detects hardcoded architecture-specific paths with file:line locations
- JetBrains Mono Nerd Font detection in doctor recommendations

**Stats:**
- 4 files modified
- ~200 lines of zsh/TypeScript
- 2 phases, 2 plans, 6 tasks
- 1 day from v1.0 to v1.1

**Git range:** `feat(04-01)` → `feat(05-01)`

**What's next:** Decouple dot CLI for standalone use (v2.0)

---

## v1.0 Onboarding MVP (Shipped: 2026-01-25)

**Delivered:** Users understand exactly what to do after installation and are blocked from installing if required dependencies are missing

**Phases completed:** 1-3 (3 plans total)

**Key accomplishments:**
- Dependency checking integrated into `dot doctor` (required + recommended tools)
- `dot install` blocks when required dependencies missing (unless --force)
- Brewfile sync with untracked package detection
- Post-install message telling user to run `exec zsh`

**Stats:**
- 8 files modified
- ~400 lines of TypeScript
- 3 phases, 3 plans, ~12 tasks
- Initial project setup

**Git range:** `feat(01-01)` → `feat(03-01)`

**What's next:** Architecture portability for cross-Mac support (v1.1)

---
