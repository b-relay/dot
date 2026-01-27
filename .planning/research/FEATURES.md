# Feature Landscape: Dotfiles Management & Setup Wizards

**Domain:** Dotfiles management and interactive setup tools for macOS developers
**Researched:** 2026-01-27
**Confidence:** HIGH (verified with official docs, active tools, recent sources)

## Executive Summary

Modern dotfiles managers fall into three categories: **symlink orchestrators** (GNU Stow, dotbot), **Git-based trackers** (yadm, bare repo), and **intelligent managers** (chezmoi, tuck, mackup). Setup wizards are **surprisingly rare** — most tools assume you already know what to track. The gap is clear: users want **automatic detection + interactive choices**, not just symlinking or templating.

For an interactive setup wizard targeting Mac developers, the competitive landscape shows:
- **Table stakes:** Symlink management, Git integration, basic detection
- **Differentiators:** Smart detection, adaptive questioning, migration from existing configs, one-command bootstrap
- **Anti-features:** Complex DSLs, all-or-nothing configs, ignoring what's already on the machine

---

## Table Stakes

Features users expect from any dotfiles tool. Missing these = incomplete product.

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| **Symlink creation/removal** | Core dotfiles pattern since ~2010 | Low | Filesystem APIs | Must be idempotent, handle conflicts |
| **Git integration** | Everyone stores dotfiles in Git | Low | Git binary | clone, commit, push/pull |
| **Backup before overwrite** | Safety net for existing files | Low | Filesystem APIs | Timestamp-based backup dirs |
| **Detect & handle conflicts** | Existing files block installation | Low | File existence checks | Show what's blocking, offer choices |
| **Directory creation** | Parent dirs might not exist | Low | mkdir -p | Create intermediate directories |
| **Install script** | Bootstrap on fresh machine | Low | Shell/Bash | One command to get started |
| **Platform detection** | Mac ARM vs Intel differences | Low | `uname -m` / `process.arch` | Homebrew paths differ |
| **Config file discovery** | Know what to track | Medium | Filesystem traversal | ~/.config, ~/, common locations |
| **Dependency checking** | Verify tools before setup | Medium | `which`, tool version checks | Required vs recommended |
| **Show status/diff** | "What's tracked? What changed?" | Medium | Git status, file comparison | Visual feedback |

**Dependencies:**
- Symlink management → Backup system (must backup before linking)
- Install script → Dependency checking (verify before execution)
- Platform detection → Config templates (different paths per platform)

---

## Differentiators

Features that set a tool apart. Not expected, but highly valued when present.

| Feature | Value Proposition | Complexity | Implementation Notes | Source |
|---------|-------------------|------------|---------------------|--------|
| **Interactive selection during init** | User chooses what to track, not all-or-nothing | Medium | Terminal UI with checkboxes, multi-select | tuck, ChezmoiSetup wrapper |
| **Automatic detection of configs** | Finds dotfiles user didn't know existed | Medium | Scan known locations, filter noise | tuck auto-detects changes and new dotfiles |
| **Adaptive questioning** | Ask about tools only if they're installed | Medium | Conditional prompts based on detection | Rare - opportunity for differentiation |
| **Migration from existing setup** | Import configs from oh-my-zsh, zinit, etc. | High | Parse existing config files, transform | Mackup has 360+ app presets |
| **Template-based generation** | Handle machine differences (hostname, arch, paths) | High | Template engine, variable substitution | chezmoi's secret weapon - Go templates |
| **Secrets management integration** | Connect to 1Password, Bitwarden, etc. | High | API integration with password managers | chezmoi supports 15+ password managers |
| **Single-command bootstrap** | `curl | sh` that does everything | Medium | Detect if Git repo exists, clone+install | chezmoi init --apply $GITHUB_USERNAME |
| **Brewfile generation from installed** | Track Homebrew packages automatically | Low | `brew bundle dump` wrapper | Common but often manual |
| **Untracked package detection** | "You have X not in Brewfile" | Medium | Compare `brew list` to Brewfile | Existing dot tool has this |
| **Architecture-specific path scanning** | Detect hardcoded /opt/homebrew or /usr/local | Medium | Regex scan of shell configs | Existing dot tool has this |
| **File encryption** | Secure sensitive configs in repo | High | GPG, age, git-crypt integration | yadm, chezmoi support this |
| **Bootstrap hooks** | Run scripts after clone | Low | Execute .bootstrap or similar | yadm bootstrap feature |
| **Alternate files by OS/hostname** | Different configs per machine | Medium | Naming convention + symlink logic | yadm ##OS.hostname pattern |
| **Organize by category** | Group related configs visually | Low | UI/display logic | tuck's smart categorization |
| **Change detection & sync** | Auto-detect edits, prompt to commit | Medium | File watching or manual scan | tuck sync command |
| **Doctor/health check** | AI-powered analysis of setup | High | LLM integration, state gathering | Existing dot doctor (unique feature!) |

**Dependencies:**
- Adaptive questioning → Automatic detection (must detect before asking)
- Template generation → Platform detection (need variables to substitute)
- Brewfile generation → Dependency checking (both use package state)
- Single-command bootstrap → All of: dependency checking, conflict handling, symlink creation

**Standout differentiators for interactive wizard:**
1. **Adaptive questioning** - ask about zsh plugins ONLY if zsh detected
2. **Migration intelligence** - detect oh-my-zsh, import themes/plugins
3. **Doctor/health check** - existing unique feature, keep it
4. **One-command bootstrap** - competitive with chezmoi's UX

---

## Anti-Features

Features to deliberately NOT build. Common mistakes in dotfiles tools.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Complex templating DSL** | Steep learning curve, maintenance burden | Use simple variable substitution or detect at runtime ($(brew --prefix)) |
| **All-or-nothing installation** | User can't pick what they want | Interactive selection, modular install |
| **Ignore existing configs** | Loses user's current setup | Detect, offer to migrate or preserve |
| **Require specific directory structure** | Friction for existing users | Accept flexible layouts or migrate gracefully |
| **VCS coupling** | Forces Git workflow | Make Git optional (dotbot is VCS-agnostic) |
| **Platform-specific binary distribution** | Installation friction | Single statically-linked binary or npm/brew install |
| **Manual conflict resolution only** | User must figure out what's wrong | Auto-detect conflicts, offer solutions |
| **No dry-run mode** | Scary to run, fear of breaking system | Show what would happen before doing it |
| **Silent failures** | User doesn't know what broke | Verbose output, clear error messages |
| **Hardcoded tool assumptions** | Breaks if user has different setup | Detect what's installed, adapt |
| **Over-automation without escape hatch** | User can't intervene | Allow manual mode, --skip flags |
| **Copy mode on modern macOS** | macOS 14+ symlinked preferences break | Warn about symlink limitations, offer alternatives |

**Critical: macOS Sonoma (14+) symlink preferences issue**
Mackup's traditional link mode breaks preferences on macOS 14+. The tool added copy mode as workaround. For our wizard: test symlink compatibility, warn users if problems detected.

---

## Feature Dependencies

```
Bootstrap Flow Dependencies:
  Single-command install
    ├── Dependency checking (required tools present?)
    ├── Git clone (if remote repo)
    ├── Directory creation (ensure paths exist)
    ├── Conflict detection (existing files?)
    │   └── Backup system (preserve originals)
    └── Symlink creation (link configs)

Interactive Setup Dependencies:
  Adaptive questioning
    ├── Config file discovery (what exists?)
    ├── Tool detection (what's installed?)
    └── Conditional prompts (ask relevant questions)
        └── Template generation (apply choices)

Maintenance Flow Dependencies:
  Change detection
    ├── File comparison (what changed?)
    ├── Git status (what's staged?)
    └── Sync decision (commit+push?)
```

---

## Setup Experience Patterns

### Pattern 1: Minimal (GNU Stow, dotbot)
1. User clones repo
2. User runs install script
3. Script creates symlinks
4. Done

**Pros:** Simple, transparent, no magic
**Cons:** User must know what to track, manual conflict resolution

### Pattern 2: Git-Native (yadm)
1. User installs yadm
2. `yadm clone <repo>` or `yadm init`
3. `yadm add <files>` (manual selection)
4. Uses home directory as Git working tree

**Pros:** Familiar Git workflow, no symlinks needed
**Cons:** Not interactive, user must know what to track

### Pattern 3: Intelligent (chezmoi, tuck)
1. User runs init command
2. Tool scans system (optional: interactively select)
3. Tool generates config or dotfiles repo
4. Ongoing: tool detects changes, prompts to sync

**Pros:** Automatic detection, smart defaults
**Cons:** More complex, abstracts Git

### Pattern 4: Application Backup (mackup)
1. User installs mackup
2. Configure storage backend (Dropbox, Git, etc.)
3. `mackup backup` - copies 360+ known app configs
4. `mackup restore` - restores on new machine

**Pros:** Zero configuration knowledge needed
**Cons:** Only works for known apps, copy-based (not symlinks on modern macOS)

---

## Recommended Feature Set for Interactive Setup Wizard

### Phase 1: MVP (Table Stakes)
Must have for users to take tool seriously:

1. **Dependency checking** - verify required tools (existing ✓)
2. **Symlink management** - install/uninstall (existing ✓)
3. **Backup before overwrite** - preserve existing files
4. **Conflict detection** - show what's blocking (existing partially ✓)
5. **Git integration** - clone, commit, push
6. **Platform detection** - ARM vs Intel (existing ✓)
7. **Install script** - one-command bootstrap

### Phase 2: Interactive Core (Differentiators)
What makes this tool special:

1. **Config file discovery** - scan ~/.config, ~/, detect configs
2. **Interactive selection** - terminal UI, user chooses what to track
3. **Adaptive questioning** - ask about zsh only if zsh installed
4. **Brewfile generation** - `brew bundle dump` integration (existing ✓)
5. **Migration intelligence** - detect oh-my-zsh, import settings
6. **Template-based generation** - handle paths, hostnames
7. **Single-command bootstrap** - `curl | sh` installs everything

### Phase 3: Maintenance (Differentiators)
Keep dotfiles fresh over time:

1. **Change detection** - detect edits to tracked files
2. **Sync command** - commit and push changes
3. **Untracked detection** - show new configs not tracked (existing ✓)
4. **Doctor command** - health check (existing ✓)
5. **Review system** - mark paths intentionally untracked (existing ✓)

### Phase 4: Advanced (Nice-to-Have)
Power user features:

1. **Secrets management** - integrate with 1Password, etc.
2. **Alternate files** - per-machine configs
3. **Bootstrap hooks** - run scripts after setup
4. **File encryption** - secure sensitive data

---

## Complexity Analysis

| Feature | Implementation Complexity | User-Facing Complexity | Priority |
|---------|--------------------------|------------------------|----------|
| Symlink management | Low | Low | P0 (MVP) |
| Backup system | Low | Low | P0 (MVP) |
| Git integration | Low | Low | P0 (MVP) |
| Conflict detection | Low | Low | P0 (MVP) |
| Dependency checking | Low | Low | P0 (MVP) |
| Config discovery | Medium | Low | P1 (Core) |
| Interactive selection | Medium | Medium | P1 (Core) |
| Adaptive questioning | Medium | Low | P1 (Core) |
| Brewfile generation | Low | Low | P1 (Core) |
| Template generation | High | Medium | P1 (Core) |
| Migration detection | High | Medium | P1 (Core) |
| Single-command bootstrap | Medium | Low | P1 (Core) |
| Change detection | Medium | Low | P2 (Maintenance) |
| Secrets management | High | High | P3 (Advanced) |
| File encryption | High | Medium | P3 (Advanced) |
| Alternate files | High | Medium | P3 (Advanced) |

**Risk areas (high complexity, high value):**
- **Template generation** - needed for cross-machine support
- **Migration detection** - needed for oh-my-zsh import
- **Adaptive questioning** - core differentiator

---

## Competitive Positioning

### Table Stakes Parity
To be taken seriously, must match:
- GNU Stow: symlink simplicity
- yadm: Git integration
- dotbot: idempotent install
- All tools: backup existing files

### Differentiation Strategy
Beat competitors on:
1. **Interactive onboarding** - tuck has this, others don't
2. **Adaptive questioning** - NO ONE does this well
3. **Migration intelligence** - mackup has app presets, we need oh-my-zsh/zinit detection
4. **Doctor command** - UNIQUE (existing feature, leverage it!)
5. **Mac-specific optimizations** - everyone is cross-platform, we're Mac-only

### Avoid These Pitfalls
Learn from competitors' mistakes:
- chezmoi: powerful but complex (Go templates learning curve)
- mackup: macOS Sonoma symlink breakage
- yadm: not interactive, manual file selection
- GNU Stow: too minimal, no intelligence
- dotbot: requires learning YAML config format

---

## Sources

### Official Documentation
- [chezmoi.io](https://www.chezmoi.io/) - Templates, password managers, quick start
- [yadm.io/docs/overview](https://yadm.io/docs/overview) - Alternate files, encryption, bootstrap
- [github.com/anishathalye/dotbot](https://github.com/anishathalye/dotbot) - Linking, cleaning, VCS-agnostic design
- [github.com/lra/mackup](https://github.com/lra/mackup) - Application backup, 360+ app support
- [tuck.sh](https://tuck.sh/) - Automatic detection, interactive prompts
- [gnu.org/software/stow](https://www.gnu.org/software/stow/) - Symlink farm manager

### Community Resources
- [webpro/awesome-dotfiles](https://github.com/webpro/awesome-dotfiles) - Curated list of tools and resources
- [dotfiles.github.io](https://dotfiles.github.io/) - Tutorials, best practices
- [daytona.io/dotfiles/ultimate-guide-to-dotfiles](https://www.daytona.io/dotfiles/ultimate-guide-to-dotfiles) - Modern practices
- [Atlassian Git Tutorial: Dotfiles](https://www.atlassian.com/git/tutorials/dotfiles) - Bare repo method

### Recent Articles (2024-2026)
- [Managing dotfiles with Chezmoi](https://natelandau.com/managing-dotfiles-with-chezmoi/) - Tutorial
- [Setting Up Dotfile Management with Yadm](https://adithyana.hashnode.dev/setting-up-dotfile-management-with-yadm-the-best-guide-available) - Comprehensive guide
- [Dotfile management with YADM](https://medium.com/@julius.dehner/how-i-manage-my-dotfiles-with-yadm-4cbdb0d35d34) - User experience
- [How I manage my dotfiles using GNU Stow](https://tamerlan.dev/how-i-manage-my-dotfiles-using-gnu-stow/) - Lightweight approach
- [Setting Up a New Mac with Dotfiles, Brew Bundle, and Mackup](https://respawn.io/posts/dotfiles-brew-bundle-and-mackup) - Mac setup flow

### Homebrew & Mac-Specific
- [docs.brew.sh/Brew-Bundle-and-Brewfile](https://docs.brew.sh/Brew-Bundle-and-Brewfile) - Official Brewfile docs
- [Automate macOS setup with a brewfile](https://www.itsthatlady.dev/blog/automate-macos-setup-with-a-brewfile/) - Automation guide

---

## Research Confidence

| Area | Confidence | Rationale |
|------|-----------|-----------|
| Table stakes features | HIGH | Verified across multiple mature tools (chezmoi, yadm, stow, dotbot) |
| Differentiators | HIGH | Observed in tuck (2026), chezmoi templates, mackup app detection |
| Anti-features | MEDIUM | Inferred from Mackup macOS 14 issues, chezmoi complexity feedback |
| Complexity estimates | MEDIUM | Based on implementation understanding, not measured data |
| Setup experience patterns | HIGH | Documented in official docs and recent tutorials (2024-2026) |
| Competitive gaps | HIGH | Interactive setup + adaptive questioning verified as rare/missing |

---

## Open Questions for Requirements Phase

1. **How deep should migration intelligence go?**
   - Just oh-my-zsh detection? Or zinit, antigen, zplug too?
   - Should we parse existing configs or just detect presence?

2. **What's the right level of templating?**
   - Simple variable substitution (${HOME}, ${HOMEBREW_PREFIX})?
   - Or full templating engine like chezmoi's Go templates?

3. **Interactive UI framework?**
   - Terminal prompts (inquirer-style)?
   - Or TUI with cursor navigation (charmbracelet/gum)?

4. **Bootstrap installation method?**
   - npm install -g?
   - Homebrew tap?
   - curl | sh with Bun installation?

5. **How to handle secrets?**
   - Just .gitignore them?
   - Or integrate with password managers (P3 feature)?

These will be resolved during requirements definition and planning.
