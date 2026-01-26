# External Integrations

**Analysis Date:** 2026-01-26

## APIs & External Services

**Claude AI:**
- Service: Anthropic Claude API via CLI
- What it's used for: Intelligent analysis of dotfiles setup and configuration issues in `doctor()` command
- SDK/Client: Command-line invocation (`claude` CLI tool)
- Auth: Claude CLI configuration (external, not managed by dot)
- Implementation: `index.ts:1025-1032` in `doctor()` function
- Model: Haiku (specified as `--model haiku`)
- Invocation: Passes formatted JSON context with dotfiles state, symlink status, git changes, and architecture info

## Package Management Integration

**Homebrew (brew):**
- Integration: Package manifest parsing and sync
- Brewfile location: `~/.dotfiles/homebrew/brewfile`
- Operations:
  - Parse brewfile: `parseBrewfile()` at `index.ts:287-333`
  - Get installed packages: `getInstalledPackages()` at `index.ts:335-357`
  - Sync detection: `checkBrewfileSync()` at `index.ts:365-413`
- Architecture-aware paths (`index.ts:1007`):
  - arm64 Macs: `/opt/homebrew`
  - x86_64 Macs: `/usr/local`
- Commands executed:
  - `brew list --formula -1` - List installed formulae
  - `brew list --cask -1` - List installed casks

## Shell Integration

**System Command Execution:**
- Tool: Bun `$` (shell command runner) from `index.ts:1`
- Used for:
  - Checking tool installation: `which <command>` in `isToolInstalled()` at `index.ts:182-185`
  - Checking Homebrew packages: `brew list` commands at `index.ts:339-354`
- Pattern: `await $\`command\`.nothrow().quiet()` for safe execution

## File System Integration

**Local File Storage:**
- Dotfiles repository: `~/.dotfiles` (configured in `createConfig()` at `index.ts:102-125`)
- XDG config directory: `~/.config` (standard location)
- Review tracking file: `~/.dotfiles/.doctor-reviewed.json`
  - Stores reviewed paths and expiry dates
  - Implementation: `readReviewedPaths()`, `writeReviewedPaths()`, `markAsReviewed()`
  - Expiry: 90 days (defined as `REVIEW_EXPIRY_DAYS` at `index.ts:15`)

**Symlink Targets:**
Managed links in `createConfig()` at `index.ts:114-123`:
- `~/.dotfiles/zsh/zshenv` → `~/.zshenv`
- `~/.dotfiles/zsh/zprofile` → `~/.config/zsh/.zprofile`
- `~/.dotfiles/zsh/zshrc` → `~/.config/zsh/.zshrc`
- `~/.dotfiles/zsh/starship.toml` → `~/.config/starship.toml`
- `~/.dotfiles/git/.gitconfig` → `~/.config/git/config`
- `~/.dotfiles/tmux/tmux.conf` → `~/.config/tmux/tmux.conf`
- `~/.dotfiles/vscode/settings.json` → `~/Library/Application Support/Code/User/settings.json`
- `~/.dotfiles/jj/config.toml` → `~/.config/jj/config.toml`

## System Integration

**Font Detection:**
- Checks for JetBrains Mono Nerd Font
- Font directories checked: `~/Library/Fonts`, `/Library/Fonts`
- Implementation: `checkNerdFont()` at `index.ts:199-217`
- Pattern: Looks for filenames containing both 'JetBrainsMono' and 'Nerd'

**Git Integration:**
- Scans for uncommitted changes in dotfiles repo
- Reports architecture-specific hardcoded paths (different for arm64 vs x86_64)
- Implementation: `scanForHardcodedPaths()` and git status reporting
- Architecture detection: `process.arch` at `index.ts:446`

**Dependency Management:**
- Checks system dependencies via `which` command
- Validates installation of required tools:
  - `brew`, `starship`, `cargo`, `fnm`, `zoxide` (required)
  - `fzf`, `vivid`, `eza`, `bun` (optional/recommended)
- Implementation: `checkDependencies()` at `index.ts:187-197`

## Authentication & Identity

**Auth Provider:**
- None required for dot CLI itself
- Claude AI integration uses external Claude CLI authentication (configured separately)
- All file operations use user's file system permissions

## Environment Configuration

**Required Environment Variables:**
- `HOME` - User home directory (enforced at runtime in `createConfig()`)

**Optional Environment Variables:**
- `REVIEW_EXPIRY_DAYS` - Not configurable; hardcoded to 90 days at `index.ts:15`

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None

---

*Integration audit: 2026-01-26*
