# dot

## What This Is

A dotfiles setup wizard for Mac users that intelligently configures development environments. Rather than blindly applying a static template, dot detects what's on the machine, asks the right questions based on what it finds, and manages dotfiles bidirectionally — both creating configs from templates and migrating existing configs into a proper dotfiles structure.

## Core Value

Run one command on a fresh Mac and get a working, configured dev environment with your choices.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Symlink management (install/uninstall) — existing
- ✓ Dependency checking (required + recommended tools) — existing
- ✓ Brewfile sync (parse, compare, detect drift) — existing
- ✓ Architecture detection (ARM vs Intel, path scanning) — existing
- ✓ Doctor command (state gathering + Claude analysis) — existing
- ✓ Review system (mark paths reviewed for 90 days) — existing

### Active

<!-- Current scope. Building toward these. -->

**Setup Wizard:**
- [ ] Interactive `dot setup` command that guides user through configuration
- [ ] Bootstrap dotfiles repo from scratch for new users
- [ ] Migrate existing config files to dotfiles structure (backup + symlink)
- [ ] Decouple from specific dotfiles repo — standalone install via bash command
- [ ] Detect installed tools and their versions
- [ ] Ask questions based on what's detected (adaptive flow)

**zsh Configuration:**
- [ ] Detect current shell setup (oh-my-zsh, zinit, vanilla, etc.)
- [ ] Configure starship prompt
- [ ] Plugin management with user choice
- [ ] Organized config file layout (right commands in right files)
- [ ] Template-based generation for fresh setups

**Config Management:**
- [ ] Git config with SSH auth and signing keys (create if missing, prompt user, not version controlled)
- [ ] Rust toolchain configuration
- [ ] Bun configuration
- [ ] fnm (Node version manager) configuration
- [ ] tmux configuration
- [ ] iTerm2 configuration
- [ ] Brew package tracking (main packages only, not sub-deps)

**Sync & Maintenance:**
- [ ] Backport changes from installed config back to template/dotfiles
- [ ] Identify stale/unused dotfiles
- [ ] Track config freshness (what's out of date)
- [ ] Secrets in dotfiles folder but gitignored, still symlinked

**Future:**
- [ ] AI agent configs (Claude skills, plugins, AGENTS.md files)

### Out of Scope

- Linux support — Mac-focused, ARM and Intel only
- Windows support — not the target platform
- Non-interactive batch mode — wizard is the interface
- Supporting arbitrary dotfiles layouts — opinionated about structure

## Context

**Existing codebase:** Single-file TypeScript CLI (`index.ts`, ~1130 lines) using Bun runtime. Has working symlink management, dependency checking, brewfile sync, and Claude-powered doctor analysis. Currently tightly coupled to a specific dotfiles repo with hardcoded paths.

**Pain points driving this:**
- New machine setup requires manual work despite having a "dotfiles tool"
- Adding/updating/removing configs requires manual sync
- Hardcoded paths break with different usernames
- No way to start fresh with choices — it's all-or-nothing
- zsh config files are disorganized

**Target tools to configure:**
- zsh with starship prompt and plugins
- Rust toolchain (cargo)
- Bun
- fnm (Node version manager)
- tmux
- iTerm2
- Git with SSH/signing keys
- Homebrew packages

## Constraints

- **Platform**: macOS only (Intel and ARM)
- **Runtime**: Bun/TypeScript (existing stack, keep it)
- **Install method**: Must be installable via single bash command (standalone)
- **Secrets**: SSH keys and signing keys must not be version controlled

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Keep Bun/TypeScript stack | Existing codebase, no reason to change | — Pending |
| Mac-only focus | Target audience is Mac developers | — Pending |
| Interactive wizard as primary interface | User wants choices, not hardcoded config | — Pending |
| Opinionated dotfiles structure | Reduces complexity, enables smart features | — Pending |

---
*Last updated: 2026-01-27 after initialization*
