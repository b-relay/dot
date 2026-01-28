# Roadmap: dot CLI

## Overview

Transform dot from a hardcoded dotfiles tool into an interactive setup wizard that guides Mac users through creating a configured development environment. Build foundation-first with safety features (backup, preflight checks, state tracking), then add the interactive wizard engine and adaptive questioning flow. Start with shell configuration as the proving ground (most complex domain), expand to tool configuration (Git, Homebrew, Rust, Bun, fnm, tmux, iTerm2), and finish with maintenance features for ongoing sync and drift detection.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Safety features, state management, architecture detection
- [ ] **Phase 2: Interactive Core** - Wizard engine, adaptive prompts, discovery
- [ ] **Phase 3: Shell Configuration** - Detect, organize, template zsh configs
- [ ] **Phase 4: Tool Configuration** - Git, Homebrew, Rust, Bun, fnm, tmux, iTerm2
- [ ] **Phase 5: Maintenance** - Status, sync, drift detection, stale file identification

## Phase Details

### Phase 1: Foundation
**Goal**: System can safely manage dotfiles with backup, preflight checks, state tracking, and architecture-aware paths.
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, FOUND-06
**Success Criteria** (what must be TRUE):
  1. Existing config files are backed up with timestamps before any destructive operation
  2. All required dependencies are checked before touching files
  3. Operations can be re-run safely without side effects (idempotent)
  4. Installation state is tracked and survives interruption (Ctrl+C recovery)
  5. All file operations are logged with timestamp, action, and status
  6. Correct Homebrew paths are detected and used (ARM /opt/homebrew vs Intel /usr/local)
**Plans**: 4 plans

Plans:
- [x] 01-01-PLAN.md — Dependencies and logger module
- [x] 01-02-PLAN.md — Backup module with timestamped backups
- [x] 01-03-PLAN.md — State tracking module for crash recovery
- [x] 01-04-PLAN.md — Wire safety features into install command

### Phase 2: Interactive Core
**Goal**: User can run `dot setup` and answer adaptive questions based on detected system state.
**Depends on**: Phase 1
**Requirements**: SETUP-01, SETUP-02, SETUP-03, SETUP-04, SETUP-05, SETUP-06
**Success Criteria** (what must be TRUE):
  1. User can run `dot setup` and see interactive terminal prompts
  2. User can select which configs to track using multi-select UI
  3. Questions adapt to detected state (only ask about zsh plugins if zsh is detected)
  4. Config files are automatically discovered in known locations
  5. Installed tools and their versions are detected and displayed
  6. Tool can be installed standalone via single bash command (no existing dotfiles repo required)
**Plans**: TBD

Plans:
- [ ] TBD during planning

### Phase 3: Shell Configuration
**Goal**: zsh is properly configured with organized files, starship prompt, and user-selected plugins.
**Depends on**: Phase 2
**Requirements**: SHELL-01, SHELL-02, SHELL-03, SHELL-04, SHELL-05, SHELL-06
**Success Criteria** (what must be TRUE):
  1. Current zsh setup is detected (existing config files, plugin managers)
  2. zsh config files are organized into proper layout (.zshenv in ~/, .zprofile/.zshrc in ZDOTDIR)
  3. Shell configs are generated from templates with architecture-specific paths (no hardcoded /opt/homebrew)
  4. Starship prompt is configured with user-selected theme
  5. zsh plugins are installed based on user choice (autosuggestions, syntax-highlighting, etc.)
  6. ZDOTDIR is set with XDG fallback to ensure SSH compatibility
**Plans**: TBD

Plans:
- [ ] TBD during planning

### Phase 4: Tool Configuration
**Goal**: Development tools (Git, Homebrew, Rust, Bun, fnm, tmux, iTerm2) are configured and tracked.
**Depends on**: Phase 3
**Requirements**: TOOL-01, TOOL-02, TOOL-03, TOOL-04, TOOL-05, TOOL-06, TOOL-07, TOOL-08
**Success Criteria** (what must be TRUE):
  1. SSH key exists (generated if missing), added to agent, user prompted to add to GitHub
  2. Homebrew packages are tracked in Brewfile (main packages only, not dependencies)
  3. Brewfile drift is detected (installed vs tracked packages shown)
  4. Rust toolchain paths are configured in shell
  5. Bun paths and shell completions are configured
  6. fnm (Node version manager) paths and shell integration are configured
  7. tmux is configured with sensible defaults
  8. iTerm2 preferences are managed
**Plans**: TBD

Plans:
- [ ] TBD during planning

### Phase 5: Maintenance
**Goal**: User can monitor dotfiles status, sync changes, and detect drift or stale files.
**Depends on**: Phase 4
**Requirements**: MAINT-01, MAINT-02, MAINT-03, MAINT-04
**Success Criteria** (what must be TRUE):
  1. Status command shows what's tracked, what's changed, and what's untracked
  2. Sync command stages, commits, and pushes dotfiles changes
  3. Drift between installed configs and dotfiles is detected and reported
  4. Stale or unused dotfiles are identified for potential cleanup
**Plans**: TBD

Plans:
- [ ] TBD during planning

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 4/4 | Complete ✓ | 2026-01-28 |
| 2. Interactive Core | 0/TBD | Not started | - |
| 3. Shell Configuration | 0/TBD | Not started | - |
| 4. Tool Configuration | 0/TBD | Not started | - |
| 5. Maintenance | 0/TBD | Not started | - |
