# External Integrations

**Analysis Date:** 2026-01-25

## APIs & External Services

**Claude AI:**
- **Service:** Claude AI (Anthropic)
- **What it's used for:** System analysis and recommendations in `dot doctor` command
  - Analyzes symlink status, git state, dotfiles, and untracked configs
  - Provides recommendations via Claude Haiku model
- **CLI Client:** `claude` command-line tool
- **Auth:** Environment configuration required (handled by `claude` CLI setup)
- **Integration:** Shell invocation via `$` template in `dot/index.ts:550`
  ```typescript
  await $`claude -p ${prompt} --model haiku`;
  ```
- **Error Handling:** Exits with code 1 if `claude` CLI not installed/configured

**Homebrew:**
- **Service:** Homebrew package manager
- **What it's used for:** System package management and tracking
  - `dot sync` command generates brewfile from current system state
- **CLI Client:** `brew` command
- **Integration:** Shell invocation via `$` template in `dot/index.ts:228`
  ```typescript
  await $`brew bundle dump --describe -f --file=/dev/stdout`.text();
  ```

## Data Storage

**File System Only:**
- No databases, APIs, or cloud storage
- All configuration is file-based and local to user's system

**Configuration Files (Tracked in Git):**
- `zsh/` - Shell configuration files
- `git/.gitconfig` - Git user configuration
- `vscode/settings.json` - VS Code user settings
- `jj/config.toml` - Jujutsu VCS configuration
- `tmux/tmux.conf` - Tmux configuration
- `iterm2/brendon-default.json` - iTerm2 profile export
- `homebrew/brewfile` - Homebrew package manifest

**Generated/Untracked Files:**
- `.doctor-reviewed.json` - JSON file tracking reviewed paths (90-day expiry)
  - Location: `${DOTFILES}/.doctor-reviewed.json`
  - Format: `{ "path": "YYYY-MM-DD" }` (path → review date mapping)
  - Purpose: Prevents doctor from re-recommending paths user has intentionally skipped

**No File Storage:**
- All configs are committed to repository
- No remote file storage or CDN integration

**No Caching:**
- No persistent cache layer beyond OS filesystem cache
- No Redis, memcached, or similar

## Authentication & Identity

**Git Signing:**
- **Auth Provider:** SSH key-based signing (custom implementation, not OAuth)
- **Key Location:** `~/.ssh/id_github_ed25519`
- **Setup:** Git config in `git/.gitconfig` lines 4, 40-42
  ```ini
  [gpg]
  format = ssh
  [gpg "ssh"]
  allowedSignersFile = /Users/brendon/.ssh/allowed_signers
  ```
- **Implementation:** Uses native git commit signing via SSH keys
  - All commits auto-signed: `[commit] gpgsign = true`
  - All tags auto-signed: `[tag] gpgSign = true`

**OS Keychain:**
- **Service:** macOS keychain
- **Use:** Git credential helper for HTTPS auth
- **Config:** `git/.gitconfig` line 33
  ```ini
  [credential]
  helper = osxkeychain
  ```

**GPG Integration:**
- **Tool:** GnuPG (installed via Homebrew)
- **Used for:** Git signing backend fallback and OpenPGP operations
- **Agent:** `pinentry-mac` for passphrase prompts
- **Env var:** `GPG_TTY` set in `zsh/zshrc` for interactive passphrase input

## Code Editors & IDEs

**VS Code:**
- **Settings file:** `vscode/settings.json` (symlinked to `~/Library/Application Support/Code/User/settings.json`)
- **Integrations configured:**
  - **Prettier** - Code formatter (esbenp.prettier-vscode)
  - **Rust Analyzer** - Rust language support
  - **Python** - Python language support with interpreter at `/Library/Frameworks/Python.framework/Versions/3.10/bin/python3`
  - **GitLens** - Git blame and history
  - **Material Icon Theme** - Icon theming
  - **GitHub Copilot** - AI code completion (disabled by default)
  - **Shell Format** - Shell script formatting

## Monitoring & Observability

**Error Tracking:** Not applicable - no remote logging

**Logs:**
- **Approach:** Console-only logging via `console.log()` statements
  - No structured logging framework
  - No log aggregation service
  - Output goes to stdout/stderr directly

**File System Monitoring:** Node.js `fs` module for file stats and permissions

## CI/CD & Deployment

**Hosting:**
- **Target:** Local macOS machine
- **Distribution:** Compiled binary in `~/.local/bin/dot`
- **Build process:** `bun build --compile` creates self-contained binary

**CI Pipeline:** Not used - manual build and deploy

**Deployment:**
- Build command: `cd dot && bun run build`
- Deploy command: `cd dot && bun run deploy` (copies to `~/.local/bin/dot` and chmod +x)
- No automated testing in CI (tests run locally only)

## Environment Configuration

**Required env vars:**

- `HOME` - User home directory (required, defaults from shell)
- `PATH` - System path (used by shell commands like `git`, `brew`, `claude`)

**Required external commands (in PATH):**

- `git` - Git version control
- `brew` - Homebrew package manager (for `dot sync` command)
- `claude` - Claude CLI tool (for `dot doctor` command)

**Optional env vars (from zsh/zprofile):**

- `DOTFILES` - Set to `${HOME}/.dotfiles`
- `DOTCONFIG` - Set to `${HOME}/.config`
- `ZDOTDIR` - Set to `${DOTCONFIG}/zsh`
- `GPG_TTY` - Set to `$(tty)` in interactive shells
- `TMUX_CONFIG` - Set to `${DOTCONFIG}/tmux/tmux.conf`
- `BUN_INSTALL` - Set to `${HOME}/.bun`
- `PATH` - Extended with `.local/bin`, `.bun/bin`, Postgres, Rust, Python, gcloud paths

**Secrets location:**

- SSH keys: `~/.ssh/` (system managed, not in this repo)
- Git credentials: macOS keychain (system managed via osxkeychain helper)
- GPG keys: `~/.gnupg/` (system managed)

## Webhooks & Callbacks

**Incoming:** Not applicable - this is a CLI tool, not a web service

**Outgoing:** Not applicable - no HTTP callbacks or webhooks triggered

**Git Hooks:** Not detected in this codebase

## System Integrations

**Shell Environment:**
- **Interactive Shell Initialization:**
  - `zshenv` → `zprofile` → `zshrc` (executed in order)
  - Sources all files in `zsh/config/*.zsh` and `zsh/plugins/*.zsh`
- **Plugins integrated:**
  - `zsh-autosuggestions` - Fish-like completions
  - `zsh-history-substring-search` - History substring search via arrow keys
  - `fzf` - Fuzzy finding for history/files
  - `zoxide` - Smart directory navigation
  - `fnm` - Node version management with auto-switching
  - `starship` - Modern shell prompt

**Starship Prompt:**
- Config: `zsh/starship.toml`
- Integrations:
  - Git branch and status display
  - Module configuration for language versions
  - Theme: Catppuccin Mocha (referenced in docs)

**Terminal/iTerm2:**
- iTerm2 profile exported to `iterm2/brendon-default.json`
- Not directly symlinked; manual import required
- Contains terminal appearance and behavior settings

**Tmux:**
- Config: `tmux/tmux.conf` (symlinked)
- Referenced in `zsh/zshrc` via `TMUX_CONFIG` variable

## Version Control Specific Integrations

**Git:**
- Editor: VS Code (`code --wait`)
- Diff tool: VS Code (`code --wait --diff`)
- Merge tool: VS Code Insiders (`code --wait --merge`)
- Signing: SSH key-based (Ed25519)
- Credentials: macOS keychain
- Default branch: `main`

**Jujutsu (jj):**
- SSH signing backend: `/Users/brendon/.ssh/id_github_ed25519`
- User config: `jj/config.toml`
- Signing behavior: `own` (signs own commits)

---

*Integration audit: 2026-01-25*
