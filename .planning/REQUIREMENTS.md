# Requirements: dot

**Defined:** 2026-01-27
**Core Value:** Run one command on a fresh Mac and get a working, configured dev environment with your choices.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Foundation

- [ ] **FOUND-01**: Backup existing configs before any destructive operation (timestamped, restorable)
- [ ] **FOUND-02**: Run preflight dependency checks before touching any files
- [ ] **FOUND-03**: Operations are idempotent (safe to re-run, same result)
- [ ] **FOUND-04**: Track installation state for interrupted install recovery
- [ ] **FOUND-05**: Log all operations for audit trail (what changed, when, status)
- [ ] **FOUND-06**: Detect architecture (ARM vs Intel) and use correct Homebrew paths

### Interactive Setup

- [ ] **SETUP-01**: Interactive `dot setup` command with terminal prompts
- [ ] **SETUP-02**: User can select which configs to track via multi-select UI
- [ ] **SETUP-03**: Questions adapt based on detected state (only ask about zsh plugins if zsh detected)
- [ ] **SETUP-04**: Automatically discover config files in known locations
- [ ] **SETUP-05**: Detect installed tools and their versions
- [ ] **SETUP-06**: Standalone install via single bash command (decoupled from specific repo)

### Shell Configuration

- [ ] **SHELL-01**: Detect current shell setup (zsh/bash, existing config files)
- [ ] **SHELL-02**: Organize zsh config into proper file layout (.zshenv, .zprofile, .zshrc)
- [ ] **SHELL-03**: Generate shell configs from templates with architecture-aware paths
- [ ] **SHELL-04**: Configure starship prompt with theme selection
- [ ] **SHELL-05**: Set up zsh plugins (autosuggestions, syntax-highlighting, etc.) with user choice
- [ ] **SHELL-06**: Handle ZDOTDIR with proper XDG fallback for SSH compatibility

### Tool Configuration

- [ ] **TOOL-01**: Generate SSH key if missing, add to agent, prompt user to add to GitHub
- [ ] **TOOL-02**: Track Homebrew packages in Brewfile (main packages, not sub-deps)
- [ ] **TOOL-03**: Detect Brewfile drift (installed vs tracked)
- [ ] **TOOL-04**: Configure Rust toolchain paths
- [ ] **TOOL-05**: Configure Bun paths and completions
- [ ] **TOOL-06**: Configure fnm (Node version manager) paths and shell integration
- [ ] **TOOL-07**: Configure tmux with sensible defaults
- [ ] **TOOL-08**: Configure iTerm2 preferences

### Maintenance

- [ ] **MAINT-01**: Status command showing what's tracked, changed, untracked
- [ ] **MAINT-02**: Manual sync command (stage, commit, push dotfiles changes)
- [ ] **MAINT-03**: Detect drift between installed configs and dotfiles
- [ ] **MAINT-04**: Identify stale/unused dotfiles that may not be needed

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Migration

- **MIG-01**: Detect oh-my-zsh installation and offer migration path
- **MIG-02**: Detect zinit installation and offer migration path
- **MIG-03**: Import existing plugin configurations during migration

### Security

- **SEC-01**: Git config with GPG signing key setup
- **SEC-02**: Secret detection (warn before committing sensitive files)
- **SEC-03**: Encrypted secrets support (age or GPG)

### Advanced Sync

- **SYNC-01**: File watching for automatic sync (launchd on macOS)
- **SYNC-02**: Backport changes from installed config to templates
- **SYNC-03**: Multi-machine profiles (work vs personal)

### AI Integration

- **AI-01**: Claude skills configuration
- **AI-02**: AGENTS.md file management
- **AI-03**: AI plugin configuration

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Linux support | Mac-focused tool, ARM and Intel only |
| Windows support | Not the target platform |
| Non-interactive batch mode | Wizard is the interface, keep it simple |
| Arbitrary dotfiles layouts | Opinionated about structure enables smart features |
| Real-time sync | Start with manual, add watching in v2 |
| Password manager integration | Complex, defer to v2+ |
| Full oh-my-zsh migration | Too complex for v1, detect and warn only |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Pending |
| FOUND-02 | Phase 1 | Pending |
| FOUND-03 | Phase 1 | Pending |
| FOUND-04 | Phase 1 | Pending |
| FOUND-05 | Phase 1 | Pending |
| FOUND-06 | Phase 1 | Pending |
| SETUP-01 | Phase 2 | Pending |
| SETUP-02 | Phase 2 | Pending |
| SETUP-03 | Phase 2 | Pending |
| SETUP-04 | Phase 2 | Pending |
| SETUP-05 | Phase 2 | Pending |
| SETUP-06 | Phase 2 | Pending |
| SHELL-01 | Phase 3 | Pending |
| SHELL-02 | Phase 3 | Pending |
| SHELL-03 | Phase 3 | Pending |
| SHELL-04 | Phase 3 | Pending |
| SHELL-05 | Phase 3 | Pending |
| SHELL-06 | Phase 3 | Pending |
| TOOL-01 | Phase 4 | Pending |
| TOOL-02 | Phase 4 | Pending |
| TOOL-03 | Phase 4 | Pending |
| TOOL-04 | Phase 4 | Pending |
| TOOL-05 | Phase 4 | Pending |
| TOOL-06 | Phase 4 | Pending |
| TOOL-07 | Phase 4 | Pending |
| TOOL-08 | Phase 4 | Pending |
| MAINT-01 | Phase 5 | Pending |
| MAINT-02 | Phase 5 | Pending |
| MAINT-03 | Phase 5 | Pending |
| MAINT-04 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 26 total
- Mapped to phases: 26
- Unmapped: 0 ✓

---
*Requirements defined: 2026-01-27*
*Last updated: 2026-01-27 after initial definition*
