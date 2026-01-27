# Domain Pitfalls

**Domain:** Dotfiles Management and Interactive CLI Setup Wizards
**Researched:** 2026-01-27
**Confidence:** HIGH

This document catalogs pitfalls specific to building dotfiles managers and interactive setup wizards, with particular focus on shell configuration, symlink management, and Mac portability.

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or major issues.

### Pitfall 1: No Backup Before Overwrite

**What goes wrong:** Installing dotfiles overwrites existing configs without backing them up first. Users lose their working configurations and can't recover.

**Why it happens:** Developers focus on the "happy path" of fresh installations and forget users might have existing configs they want to keep.

**Consequences:**
- Permanent data loss of working configurations
- User anger and loss of trust
- No rollback path when installation fails mid-way
- Breaking production environments

**Prevention:**
- ALWAYS backup existing files before creating symlinks
- Create timestamped backup directories (e.g., `.dotfiles-backup-2026-01-27`)
- Show users what was backed up and where
- Make backup location configurable
- Test with existing configs, not just fresh environments

**Detection:**
- User reports "lost my config"
- No backup directory exists in filesystem after install
- Install script has no backup logic in code

**Phase mapping:** Setup wizard phase MUST include backup logic before any symlink creation.

### Pitfall 2: Interrupted Installation Leaves System Broken

**What goes wrong:** Wizard is interrupted (Ctrl+C, network failure, permission error) mid-installation, leaving symlinks partially created, shell configs half-written, and system in an unusable state.

**Why it happens:** Installation steps aren't atomic or transactional. Wizards assume happy path completion.

**Consequences:**
- Shell won't start (broken .zshrc)
- PATH is corrupted
- Some configs work, others don't (debugging nightmare)
- User can't easily recover or retry
- No clear "cleanup" command to reset

**Prevention:**
- Make installation steps idempotent (safe to run multiple times)
- Track installation state in a progress file
- Implement `--resume` flag to continue failed installations
- Validate prerequisites before touching ANY files
- Create all symlinks in a staging area, then swap atomically if possible
- Provide explicit `dot cleanup` command that removes partial installs
- Use exit traps to cleanup on unexpected termination

**Detection:**
- Some symlinks exist, others don't
- Backup directories exist but restoration wasn't completed
- State file shows "in_progress" status
- User reports "it stopped halfway and now my shell is broken"

**Phase mapping:**
- Phase 1 (Setup wizard): Implement state tracking and idempotency
- Phase 2 (Error handling): Add rollback and cleanup commands

### Pitfall 3: ZDOTDIR Without XDG_CONFIG_HOME Fallback

**What goes wrong:** Setting `ZDOTDIR="${XDG_CONFIG_HOME}/zsh"` breaks when `XDG_CONFIG_HOME` isn't set (SSH login, console, non-interactive shells). Zsh can't find its config files.

**Why it happens:** Developers test in their interactive shell where XDG variables are already set, missing the bootstrap problem.

**Consequences:**
- Zsh fails to load configuration on SSH login
- Console login broken
- Scripts fail with "command not found" for aliases
- Silent failures in non-interactive contexts

**Prevention:**
- Always use fallback defaults: `export ZDOTDIR=${ZDOTDIR:-$HOME/.config/zsh}`
- Set XDG_CONFIG_HOME in .zshenv before using it elsewhere
- The .zshenv file MUST live in $HOME (can't be moved to XDG)
- Test in multiple contexts: interactive shell, SSH, console, `zsh -c 'echo test'`
- Document the "bootstrap" requirement clearly

**Detection:**
- SSH login shows "command not found" for basic commands
- `echo $ZDOTDIR` returns empty in SSH sessions
- .zshenv doesn't set XDG_CONFIG_HOME before using it
- No fallback patterns in export statements

**Phase mapping:** Zsh configuration phase must include robust XDG handling with fallbacks.

### Pitfall 4: Architecture-Specific Homebrew Paths

**What goes wrong:** Hardcoding `/opt/homebrew` (Apple Silicon) or `/usr/local` (Intel) breaks when dotfiles are used on the other architecture.

**Why it happens:** Developer only tests on their own Mac architecture.

**Consequences:**
- PATH includes wrong Homebrew location
- Commands not found
- Wrong architecture binaries loaded (Rosetta overhead)
- Dotfiles not portable between machines

**Prevention:**
- Use `$(brew --prefix)` in shell configs instead of hardcoded paths
- Dynamically detect architecture: `uname -m` or `process.arch`
- Set architecture-aware path variables at runtime
- Never commit hardcoded architecture paths
- Add linter/doctor check for hardcoded paths like the existing tool does
- Test on both ARM and Intel Macs (or use virtualization)

**Detection:**
- Grep for `/opt/homebrew` or `/usr/local/opt` in config files
- PATH includes both homebrew locations (indicates workaround, not solution)
- Commands fail with "command not found" after architecture migration
- Doctor command finds hardcoded path issues (already implemented!)

**Phase mapping:** Architecture detection is already implemented - wizard must USE it when generating configs.

### Pitfall 5: Missing Dependency Detection Too Late

**What goes wrong:** Wizard starts installation, gets 80% through, then fails because a required tool isn't installed. User has to manually clean up partial state.

**Why it happens:** Dependency checks happen during installation steps rather than upfront validation.

**Consequences:**
- Broken partial installations
- Frustrating user experience
- Time wasted on failed setups
- Difficult recovery

**Prevention:**
- Run ALL dependency checks BEFORE touching any files (preflight check)
- Show complete list of missing dependencies at once, not one at a time
- Offer to install missing dependencies automatically (with consent)
- Separate "required" from "recommended" dependencies clearly
- Support --force flag to bypass checks (already implemented!)
- Provide clear install commands for missing tools

**Detection:**
- Installation fails after creating some symlinks
- Error messages about missing tools appear mid-installation
- No preflight validation function exists
- Dependency checks are scattered throughout installation code

**Phase mapping:** Setup wizard phase must validate ALL dependencies before starting installation.

---

## Moderate Pitfalls

Mistakes that cause delays, confusion, or technical debt.

### Pitfall 6: Shell Detection Assumes Interactive Context

**What goes wrong:** Setup wizard assumes it's running in an interactive terminal and uses prompts/colors/TUI elements. Breaks when run via scripts, CI/CD, or SSH with no TTY.

**Why it happens:** Developers test interactively and forget about automation use cases.

**Consequences:**
- Hangs waiting for input that never comes
- Garbled output when colors/ANSI codes aren't supported
- Can't be scripted or automated
- Fails in CI/CD pipelines

**Prevention:**
- Check if stdin is a TTY: `process.stdin.isTTY` (Node/Bun)
- Provide `--non-interactive` flag with sensible defaults
- Any flag passed should disable interactive prompts
- Degrade gracefully when not interactive (no prompts, plain text)
- Required inputs must be providable via flags/env vars
- Document both interactive and non-interactive usage

**Detection:**
- Script hangs when called from cron or CI
- No check for TTY in code
- Prompts appear without checking interactive state
- No `--non-interactive` or `--yes` flag exists

**Phase mapping:** Setup wizard phase must detect interactivity and provide non-interactive mode.

### Pitfall 7: Symlink Target Ambiguity (Relative vs Absolute)

**What goes wrong:** Creating symlinks with relative paths breaks when accessed from different working directories. Or using absolute paths with hardcoded usernames breaks portability.

**Why it happens:** Confusion about how symlinks resolve paths and what "relative" means.

**Consequences:**
- Broken symlinks that appear valid
- Configs work in some directories but not others
- Can't share dotfiles between users
- Mysterious "file not found" errors

**Prevention:**
- Always create symlinks with absolute source paths resolved at install time
- Never hardcode usernames in paths - use $HOME
- Normalize/resolve all paths before creating symlinks (existing code does this!)
- Verify symlink targets after creation
- Test by accessing from different directories

**Detection:**
- Symlinks contain relative paths like `../dotfiles/zsh/zshrc`
- Symlinks include username like `/Users/clay/.dotfiles/...`
- `readlink` shows relative path when you expected absolute
- Doctor command shows "wrong-target" status

**Phase mapping:** Symlink creation must always resolve to absolute paths with $HOME expansion.

### Pitfall 8: Config File Load Order Confusion

**What goes wrong:** Putting PATH in .zshrc instead of .zprofile. Putting functions in .zshenv. Wrong load order causes duplicate PATH entries, slow shells, or missing variables.

**Why it happens:** .zshrc and .zprofile look identical, tutorials don't explain differences, developers cargo-cult from bash without understanding zsh.

**Consequences:**
- PATH grows on every subshell (duplicate entries)
- Slow shell startup from redundant initialization
- Variables not available where expected
- Environment pollution

**Prevention:**
- Document clear file purposes in wizard:
  - `.zshenv` - Always loaded (keep minimal, set ZDOTDIR/XDG here)
  - `.zprofile` - Login shells only (PATH, environment variables)
  - `.zshrc` - Interactive shells (aliases, functions, prompt, plugins)
  - `.zlogin` - Rarely needed (post-profile actions)
- Generate configs in appropriate files based on content type
- Add comments in generated files explaining their purpose
- Validate that generated configs follow these rules
- Test shell startup time and PATH duplication

**Detection:**
- PATH has duplicate entries: `echo $PATH | tr ':' '\n' | sort | uniq -d`
- `time zsh -i -c exit` is slow (>500ms)
- Aliases defined in .zprofile instead of .zshrc
- Environment variables set in .zshrc instead of .zprofile

**Phase mapping:** Zsh configuration phase must enforce correct file organization.

### Pitfall 9: Oh-My-Zsh Bloat Assumption

**What goes wrong:** Wizard automatically installs Oh-My-Zsh without asking. Shell startup becomes slow (300-500ms+). Users inherit framework they don't need.

**Why it happens:** Popular tutorials recommend Oh-My-Zsh. Developers think "everyone uses it."

**Consequences:**
- Slow shell startup time
- Unnecessary complexity and dependencies
- Difficult to remove once installed
- Performance degradation on large repos (git status checks)

**Prevention:**
- ASK user if they want Oh-My-Zsh vs vanilla zsh vs other frameworks
- Show tradeoffs: convenience vs performance vs simplicity
- Support vanilla zsh with just what's needed (starship + few plugins)
- If using Oh-My-Zsh, disable unused plugins
- Measure and report shell startup time after setup
- Consider modern alternatives: zinit, antigen, or no framework

**Detection:**
- Shell startup time > 300ms
- .zshrc sources Oh-My-Zsh framework
- Multiple unused plugins enabled
- User didn't choose framework - it was installed automatically

**Phase mapping:** Setup wizard must ask about plugin management preference, not assume.

### Pitfall 10: Secrets in Version Control

**What goes wrong:** SSH keys, GPG keys, API tokens, .env files get committed to dotfiles repo. Accidentally pushed to public GitHub.

**Why it happens:** Wizard migrates ALL dotfiles including secrets. User doesn't realize what got committed.

**Consequences:**
- Security breach - keys exposed publicly
- Need to revoke and regenerate all credentials
- Compliance violations
- Embarrassment and potential account compromise

**Prevention:**
- Never version control SSH keys, GPG keys, or tokens
- Add explicit .gitignore for secrets: `**/*.key`, `**/*.pem`, `.env*`, etc.
- Wizard should DETECT secrets and warn before adding
- Store secrets in `.dotfiles/secrets/` directory (gitignored but still symlinked)
- Prompt user before migrating any key files
- Run secrets scanner on generated repo
- Add pre-commit hook to prevent secret commits

**Detection:**
- .gitignore doesn't exist or is minimal
- `git ls-files` includes .ssh/id_rsa or similar
- Scanning with tools like gitleaks shows secrets
- No warning/detection logic for key files in code

**Phase mapping:** Setup wizard must implement secret detection and safe handling from day one.

### Pitfall 11: Wizard Doesn't Track What It Changed

**What goes wrong:** After wizard runs, user doesn't know what was modified, what was created, or how to undo changes.

**Why it happens:** Wizard just does things without logging or reporting.

**Consequences:**
- User can't audit changes
- Difficult to debug problems
- No paper trail for troubleshooting
- Can't undo specific parts

**Prevention:**
- Log every file operation: created, modified, backed up, symlinked
- Save operation log to `.dotfiles/.install-log-YYYY-MM-DD.json`
- Print summary at end: "Created X files, backed up Y files, installed Z tools"
- Implement `dot show-changes` command to review what was done
- Make log human-readable and machine-parseable
- Include timestamps and operation status (success/failed/skipped)

**Detection:**
- No install log file exists
- User asks "what did it change?"
- No summary output after installation
- Can't answer "when was this last modified?"

**Phase mapping:** All phases that modify files must log operations.

---

## Minor Pitfalls

Mistakes that cause annoyance but are fixable.

### Pitfall 12: Assume Default Shell is Zsh

**What goes wrong:** Wizard assumes zsh is the default shell and starts configuring it. User is actually running bash or fish.

**Why it happens:** macOS Catalina+ defaults to zsh, so developers forget to check.

**Consequences:**
- Generates zsh configs user never uses
- Doesn't configure their actual shell
- Confusion about why configs aren't loading

**Prevention:**
- Check current shell: `echo $SHELL` and `ps -p $$ -o comm=`
- Check default shell for user: `dscl . -read /Users/$USER UserShell`
- ASK user which shell they want to configure
- Offer to change default shell if different from desired
- Support bash configs for users who prefer bash

**Detection:**
- No shell detection in wizard code
- Assumes /bin/zsh without checking
- User reports "my bash shell isn't configured"
- $SHELL check missing from preflight

**Phase mapping:** Setup wizard must detect and confirm shell choice.

### Pitfall 13: Silent Failures in Background Operations

**What goes wrong:** Homebrew installs, git clones, or plugin downloads fail silently. User thinks installation succeeded but features don't work.

**Why it happens:** Background operations aren't checked for exit codes or errors.

**Consequences:**
- Incomplete installations that appear successful
- User discovers problems later when trying to use feature
- Difficult to debug ("but I installed it!")

**Prevention:**
- Check exit codes for all subprocess calls
- Show progress for long operations
- Report failures immediately and clearly
- Aggregate errors and show all at end
- Offer retry mechanism for failed operations
- Don't continue if critical dependencies failed

**Detection:**
- No exit code checks after spawning processes
- No error handling around network operations
- Success message shows even when steps failed
- User reports "installed but doesn't work"

**Phase mapping:** All installation operations need error handling.

### Pitfall 14: No Version Pinning for Templates

**What goes wrong:** Wizard fetches latest template from main branch. Template changes break existing installations or introduce incompatibilities.

**Why it happens:** Convenient to just use HEAD, forget about stability.

**Consequences:**
- Reproducibility lost
- "Works on my machine" problems
- Breaking changes affect all new users
- Can't bisect issues

**Prevention:**
- Pin template versions or use tagged releases
- Let users choose template version
- Test templates before promoting to stable
- Version wizard separately from templates
- Document template compatibility in wizard

**Detection:**
- Fetches from main/master without version check
- No version field in config
- Template URL has no version or tag
- User can't choose which template version

**Phase mapping:** Setup wizard should support versioned templates.

### Pitfall 15: Assume Homebrew is Installed

**What goes wrong:** Wizard tries to install packages with brew before checking if Homebrew exists.

**Why it happens:** "Every Mac developer has Homebrew" assumption.

**Consequences:**
- Installation fails with cryptic errors
- User confused why brew command not found
- Manual intervention required

**Prevention:**
- Check for Homebrew in preflight: `which brew`
- Offer to install Homebrew if missing
- Show installation command: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
- Continue without Homebrew if user declines (skip package management)

**Detection:**
- No brew existence check in code
- brew commands run without validation
- User reports "brew: command not found" error

**Phase mapping:** Preflight checks must verify Homebrew or offer installation.

### Pitfall 16: Starship Prompt Timeout on Monorepos

**What goes wrong:** Starship prompt configured with default 500ms timeout. Hangs in large monorepos waiting for git status.

**Why it happens:** Default timeout too aggressive for large repositories.

**Consequences:**
- Slow prompt in monorepos
- Frequent timeouts
- Poor user experience in work environments

**Prevention:**
- Configure reasonable Starship timeouts (2000ms+)
- Disable expensive modules in monorepo-heavy environments
- Document timeout configuration
- Let user customize timeout during setup
- Test in repos with 10k+ files

**Detection:**
- starship.toml has default timeout
- Prompt is slow in large git repos
- Timeout warnings in shell
- `command_timeout` not set to reasonable value

**Phase mapping:** Starship configuration should include performance tuning.

### Pitfall 17: Ignore Existing Plugin Managers

**What goes wrong:** User already has zinit/antigen/oh-my-zsh installed. Wizard installs another plugin manager, causing conflicts.

**Why it happens:** Wizard doesn't detect existing installations.

**Consequences:**
- Conflicting plugin managers
- Duplicate plugin loading
- Slow shell startup
- Configuration conflicts

**Prevention:**
- Detect existing plugin managers before installation
- Ask user if they want to keep existing or switch
- Don't install if one exists unless explicitly requested
- Migrate from old to new if user wants to switch
- Document migration path

**Detection:**
- .zshrc already sources oh-my-zsh, zinit, etc.
- Plugin manager directories already exist
- No detection logic for existing managers
- User reports "plugins loaded twice"

**Phase mapping:** Setup wizard must detect and handle existing plugin managers.

### Pitfall 18: Forget to Stage ~/.zshenv

**What goes wrong:** Wizard creates .zshrc, .zprofile in dotfiles repo but leaves .zshenv in ~/ only. User's .zshenv isn't version controlled.

**Why it happens:** .zshenv MUST be in ~/ for zsh to bootstrap, so developers think it can't be in dotfiles repo.

**Consequences:**
- Incomplete dotfiles backup
- ZDOTDIR bootstrap lost when moving to new machine
- Critical XDG setup not version controlled

**Prevention:**
- Keep source .zshenv in dotfiles repo
- Symlink ~/.zshenv -> ~/.dotfiles/zsh/zshenv (this is already in the code!)
- Document why .zshenv must be symlinked
- Test that bootstrap works from fresh checkout

**Detection:**
- .zshenv not in git ls-files
- No symlink from ~/.zshenv to dotfiles
- LINKS config missing .zshenv entry
- Fresh install doesn't create ~/.zshenv symlink

**Phase mapping:** Zsh setup must include .zshenv in symlink creation (already in LINKS map!).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|----------------|------------|
| Bootstrap/Initial Setup | No backup before overwrite (Critical #1) | Implement backup-first strategy from day one |
| Bootstrap/Initial Setup | Missing dependencies detected late (Critical #5) | Comprehensive preflight checks before any file operations |
| State Management | Interrupted installation (Critical #2) | Add state tracking and idempotency to all operations |
| Zsh Configuration | ZDOTDIR without XDG fallback (Critical #3) | Use fallback patterns, test in non-interactive contexts |
| Zsh Configuration | Config file load order (Moderate #8) | Document and enforce correct file organization |
| Zsh Configuration | Oh-My-Zsh bloat (Moderate #9) | Make framework choice explicit, measure performance |
| Symlink Creation | Relative vs absolute paths (Moderate #7) | Always resolve to absolute paths with $HOME |
| Architecture Detection | Hardcoded Homebrew paths (Critical #4) | Use $(brew --prefix), dynamic detection |
| Secret Management | Secrets in version control (Moderate #10) | Detect and exclude secrets, add .gitignore rules |
| Interactive Wizard | Non-TTY context (Moderate #6) | Check for TTY, provide non-interactive mode |
| Installation Logging | No change tracking (Moderate #11) | Log all operations with timestamps |
| Shell Detection | Assume default shell (Minor #12) | Detect and confirm shell choice |
| Error Handling | Silent failures (Minor #13) | Check exit codes, report errors clearly |
| Plugin Management | Ignore existing managers (Minor #17) | Detect and handle existing installations |
| Homebrew Integration | Assume brew installed (Minor #15) | Check existence, offer installation |
| Performance | Starship timeout in monorepos (Minor #16) | Configure reasonable timeouts |

---

## Testing Checklist to Catch Pitfalls Early

Run these tests to catch pitfalls before users do:

**Environment Testing:**
- [ ] Fresh Mac with no existing configs
- [ ] Mac with existing bash configs
- [ ] Mac with existing zsh + oh-my-zsh
- [ ] Intel Mac (x86_64)
- [ ] Apple Silicon Mac (ARM64)
- [ ] SSH login (non-interactive context)
- [ ] Script execution (no TTY)

**Failure Scenarios:**
- [ ] Ctrl+C during installation
- [ ] Missing Homebrew
- [ ] Missing required dependency
- [ ] Network failure during git clone
- [ ] Existing files at symlink targets
- [ ] Permission denied errors
- [ ] Disk full

**Configuration Scenarios:**
- [ ] XDG_CONFIG_HOME not set
- [ ] Custom ZDOTDIR already set
- [ ] Non-standard shell ($SHELL != /bin/zsh)
- [ ] Large monorepo (10k+ files)
- [ ] Dotfiles with secrets (.env, .ssh keys)

**Recovery Scenarios:**
- [ ] Run installation twice (idempotency)
- [ ] Run after partial failed install
- [ ] Rollback/uninstall after complete install
- [ ] Restore from backup

---

## Sources

### Dotfiles Management
- [Arch Wiki - Dotfiles](https://wiki.archlinux.org/title/Dotfiles)
- [Manage Your Dotfiles Like a Superhero](https://www.jakewiesler.com/blog/managing-dotfiles)
- [The Ultimate Guide to Mastering Dotfiles](https://www.daytona.io/dotfiles/ultimate-guide-to-dotfiles)
- [How to Store Dotfiles - Atlassian Git Tutorial](https://www.atlassian.com/git/tutorials/dotfiles)
- [Git-based dotfile management without symlinks](https://www.stefanjudis.com/notes/git-based-dotfile-management-without-symlinks/)

### CLI Wizard UX
- [UX patterns for CLI tools](https://lucasfcosta.com/2022/06/01/ux-patterns-cli-tools.html)
- [Creating a setup wizard (and when you shouldn't)](https://blog.logrocket.com/ux-design/creating-setup-wizard-when-you-shouldnt/)
- [Command Line Interface Guidelines](https://clig.dev/)
- [NN/G - Wizards: Definition and Design Recommendations](https://www.nngroup.com/articles/wizards/)

### Zsh Configuration
- [You probably don't need Oh My Zsh](https://rushter.com/blog/zsh-shell/)
- [How Do Zsh Configuration Files Work? - freeCodeCamp](https://www.freecodecamp.org/news/how-do-zsh-configuration-files-work/)
- [My Updated ZSH Config 2025](https://scottspence.com/posts/my-updated-zsh-config-2025)
- [Moving to zsh, part 2: Configuration Files](https://scriptingosx.com/2019/06/moving-to-zsh-part-2-configuration-files/)
- [Zsh - ArchWiki](https://wiki.archlinux.org/title/Zsh)
- [Hacker News - ZDOTDIR discussion](https://news.ycombinator.com/item?id=11515938)

### Architecture & Homebrew Portability
- [Homebrew on Apple Silicon Macs](https://andre.arko.net/2021/02/11/homebrew-on-apple-silicon-macs/)
- [Setup Homebrew on Apple Silicon](https://noahpeeters.de/posts/apple-silicon/homebrew-setup/)
- [Migrating Homebrew from Intel to Apple Silicon](https://ericswpark.com/blog/2023/2023-06-17-migrating-homebrew-from-intel-to-asi-mac/)

### Shell Detection
- [How to Determine Your Shell Type](https://www.codestudy.net/blog/how-do-i-tell-what-type-my-shell-is/)
- [Bash Check If Shell Is Interactive - nixCraft](https://www.cyberciti.biz/faq/linux-unix-bash-check-interactive-shell/)
- [Is this Shell Interactive? - Bash Manual](https://www.gnu.org/software/bash/manual/html_node/Is-this-Shell-Interactive_003f.html)

### macOS Shell Migration
- [Shell Configuration - Zsh Mac 2026](https://mac.install.guide/terminal/configuration)
- [Complete Guide to macOS Shell Configuration](https://osxhub.com/macos-shell-configuration-zsh-environment-variables/)
- [Moving to zsh - Scripting OS X](https://scriptingosx.com/2019/06/moving-to-zsh-part-2-configuration-files/)

---

**Next Steps:**
1. Use these pitfalls to inform roadmap phase structure
2. Flag phases that need deeper research for specific pitfalls
3. Create testing strategy covering failure scenarios above
4. Build prevention strategies into wizard from day one, not as afterthought
