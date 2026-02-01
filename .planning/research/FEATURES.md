# Features Research: v2.1

**Domain:** CLI dotfiles management tool for macOS
**Researched:** 2026-02-01
**Confidence:** HIGH (verified with Context7, official docs, and ecosystem examples)

## Executive Summary

This research covers expected behavior and UX patterns for four feature areas in v2.1:
1. **Self-Update** - GitHub releases-based binary updates with semantic versioning
2. **Enhanced Diagnostics** - Tool version reporting and environment detection
3. **Brewfile Sync UX** - Interactive filtering and dynamic type discovery
4. **Doctor Ignore** - Already implemented, included for completeness

The research draws from established CLI tools (gh, rustup, brew, mise) and documented best practices in the 2026 ecosystem.

---

## Self-Update Features

### Table Stakes

| Feature | Why Expected | Complexity | Implementation Notes |
|---------|--------------|------------|---------------------|
| Version checking | Users expect CLIs to check for updates | Low | Fetch GitHub releases API, compare semver |
| Prompt before updating | Safety - never update without confirmation | Low | Use clack prompts (already in project) |
| Platform detection | Must download correct binary (arm64/x86_64) | Low | Already have `getArchitecture()` |
| Graceful failure | Network/API failures shouldn't crash | Low | Try-catch with clear error messages |
| Manual fallback | Show manual update steps if auto fails | Low | Print git pull + bun deploy commands |
| Current version display | Show "You have X, latest is Y" | Low | Use VERSION constant from index.ts |

**Dependencies on existing features:**
- `VERSION` constant (line 27 in index.ts)
- `getArchitecture()` function (line 553)
- Clack prompts library (already imported)

**Pattern to follow:**
```
$ dot update
Checking for updates...

Current version: 0.1.0
Latest version:  0.2.0

• New in 0.2.0:
  - Self-update from GitHub releases
  - Enhanced diagnostics

? Update to 0.2.0? (Y/n)
```

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Background check notification | Like gh CLI - check once/24h, notify passively | Medium | Store last-check timestamp in state.json |
| Changelog preview | Show what's new before updating | Low | Parse GitHub release notes |
| Rollback capability | Backup old binary, offer rollback if new version fails | Medium | Save ~/.local/bin/dot.backup before replacing |
| Pre-release channel | Allow users to opt into beta versions | Medium | Add config flag, filter releases by pre-release tag |
| Skip version | "Don't notify me about this version again" | Low | Store in state.json |

**Recommended for v2.1:** Changelog preview (low effort, high value)

**Defer to v2.2+:** Background checks (requires state management complexity)

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Auto-update without prompt | Breaks user trust, violates expectations | Always require explicit confirmation |
| Update via package manager when installed via Homebrew | Conflicts with brew's version management (rustup pattern) | Detect installation method, error with "use brew upgrade" |
| Silent failures | Leaves users confused about update state | Always show error + manual fallback instructions |
| Downloading all platforms | Wastes bandwidth, increases attack surface | Only fetch binary for current platform |
| Update during critical operations | Mid-install update check is annoying | Skip update checks during install/uninstall |

**Critical insight from rustup:** When installed via package manager (Homebrew), disable self-update and tell users to use their package manager instead. This prevents version conflicts.

---

## Enhanced Diagnostics Features

### Table Stakes

| Feature | Why Expected | Complexity | Implementation Notes |
|---------|--------------|------------|---------------------|
| Show tool versions | Users need to verify installed versions | Low | Run `tool --version` for each dependency |
| Detect missing tools | doctor should report what's not installed | Low | Already have `isToolInstalled()` |
| Installation hints | Tell users HOW to install missing tools | Low | Already have `brewPackage` field in deps |
| Error handling | Some tools might not support --version | Low | Try common patterns: --version, -v, version |
| Formatted output | Clear, scannable version listing | Low | Use clack log with icons |

**Dependencies on existing features:**
- `checkDependencies()` function (line 286)
- `isToolInstalled()` function (line 281)
- Dependency config in dot.config.json

**Expected output pattern:**
```
Required:
  ✓ zsh 5.9
  ✓ git 2.43.0
  ✗ stow (brew install stow)

Recommended:
  ✓ starship 1.17.1
  ○ tmux (brew install tmux)
```

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Terminal detection | Show if using iTerm2 (for Nerd Font features) | Low | Check `$TERM_PROGRAM` env var |
| Version warnings | Warn if tool version is outdated/incompatible | Medium | Requires hardcoding min versions |
| Shell detection | Report current shell and version | Low | Parse `$SHELL` and run `$SHELL --version` |
| Homebrew prefix | Show detected Homebrew location | Low | Run `brew --prefix` (already using this pattern) |
| macOS version | Report OS version for compatibility checks | Low | Parse `sw_vers` output |
| Performance metrics | Show startup time, command execution speed | High | Requires instrumentation |

**Recommended for v2.1:** Terminal detection, Shell detection, Homebrew prefix (all low-effort, useful for debugging)

**Defer:** Version warnings (needs maintenance), Performance metrics (complex)

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Running every tool command | Slow, fragile if tool has issues | Only check tools defined in dependencies config |
| Deep version parsing | Breaks with non-semantic versions | Display version string as-is, don't parse |
| Failing doctor if recommended deps missing | Too strict - doctor should inform, not block | Only block install command on missing required deps |
| Network calls for version checking | Slow, fails offline | Only check local installed versions |

---

## Brewfile Sync UX Features

### Table Stakes

| Feature | Why Expected | Complexity | Implementation Notes |
|---------|--------------|------------|---------------------|
| Detect all package types | Users install formula, cask, mas, vscode | Medium | Parse `brew bundle dump` output dynamically |
| Preserve comments | Brewfile descriptions are valuable | Low | Already implemented (line 412) |
| Show exclusion config | Tell users what's being filtered | Low | Already show in sync (line 868-874) |
| Configurable exclusions | Different users want different exclusions | Low | Already implemented via sync config |
| Alphabetical sorting | Makes brewfile readable and diffable | Low | Brew bundle dump already sorts |

**Dependencies on existing features:**
- `filterBrewfile()` function (line 777)
- `syncConfig()` command (line 808)
- Brewfile config in dot.config.json

**Current gap:** Hardcoded exclusion list in EXCLUDE_DESCRIPTIONS (line 799). Should dynamically discover types from `brew bundle dump` output.

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Dynamic type discovery | Auto-detect new brew bundle types (go, whalebrew) | Low | Parse dump output, extract unique prefixes |
| Type counts in config UI | "vscode (42 extensions)" helps informed decisions | Low | Count packages of each type before showing multiselect |
| Dry-run mode | Preview changes before writing file | Low | Add --dry-run flag, show diff instead of writing |
| Interactive review | Show packages being added/removed, confirm | Medium | Requires diffing old vs new brewfile |
| Category grouping in brewfile | Group by type with comments | Low | Add "# Formulae" "# Casks" headers |

**Recommended for v2.1:** Dynamic type discovery, Type counts (both enhance existing sync config)

**Defer:** Interactive review (complex), Category grouping (cosmetic)

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Auto-commit brewfile changes | Takes away user control | Show git status, let user review and commit |
| Removing packages not in brewfile | Destructive, unexpected | Only warn about untracked packages in doctor |
| Modifying brewfile without user action | Surprising behavior | Only update on explicit `dot sync` command |
| Default to excluding everything | Hides useful packages | Default to sensible exclusions (vscode) |

**Pattern insight:** Homebrew 5.0 (Nov 2025) added `go` package support. The current hardcoded approach will miss future additions. Dynamic discovery future-proofs the tool.

---

## Doctor Ignore Features

**Status:** Already implemented (lines 1123-1157)

### Table Stakes

| Feature | Why Expected | Complexity | Implementation Notes |
|---------|--------------|------------|---------------------|
| Mark path as reviewed | Stops Claude from recommending it | Low | ✓ Implemented via .doctor-reviewed.json |
| Expiry mechanism | Paths should be re-checked eventually | Low | ✓ 90-day expiry implemented |
| Both file and directory support | Users want to ignore entire dirs | Low | ✓ Works with any path |
| Clear expiry date display | Users need to know when review expires | Low | ✓ Shows expiry date on ignore |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Interactive path browser | Easier than typing full paths | Low | ✓ Already implemented with --cwd flag |
| Bulk ignore | Ignore multiple paths at once | Medium | Would need multiselect UI |
| Permanent ignore | Some paths never need review | Low | Could add --permanent flag (no expiry) |
| Ignore patterns | Ignore by glob instead of exact path | Medium | Would need pattern matching in doctor |

**Current implementation is solid.** No critical gaps for v2.1.

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Ignoring symlink targets | Confusing - should ignore the symlink itself | Normalize to the symlink path, not resolved path |
| No expiry option | Stale ignores accumulate forever | Keep 90-day expiry, add --permanent for exceptions |
| Global ignore list | Path-specific, tied to this dotfiles setup | Keep in .doctor-reviewed.json in repo |

---

## Feature Dependencies Graph

```
Self-Update
├─ Requires: VERSION constant, getArchitecture()
├─ Enhances: update command (currently placeholder)
└─ Blocks: None

Enhanced Diagnostics
├─ Requires: checkDependencies(), isToolInstalled()
├─ Enhances: doctor command
└─ Integrates with: Terminal detection → iTerm2 dep recommendations

Brewfile Sync UX
├─ Requires: filterBrewfile(), syncConfig()
├─ Enhances: sync command, sync config command
└─ Enables: Dynamic type discovery → future-proof exclusions

Doctor Ignore
├─ Status: Already complete
└─ Enhances: doctor command
```

---

## MVP Recommendations for v2.1

**Must implement (table stakes):**
1. Self-update: Version checking, platform detection, prompt confirmation
2. Diagnostics: Tool versions in doctor output
3. Brewfile: Dynamic type discovery in sync config

**Should implement (quick wins):**
1. Self-update: Changelog preview (show what's new)
2. Diagnostics: Terminal detection, shell info, Homebrew prefix
3. Brewfile: Type counts in config UI

**Defer to v2.2+ (complex or low ROI):**
1. Self-update: Background checks, rollback, pre-release channel
2. Diagnostics: Version warnings, performance metrics
3. Brewfile: Interactive review, category grouping

---

## Implementation Priorities by Complexity

### Low Complexity (implement first)
- Self-update: GitHub API fetch, semver comparison, changelog preview
- Diagnostics: Version display, terminal detection, shell detection
- Brewfile: Dynamic type discovery, type counts

### Medium Complexity (implement second)
- Self-update: Binary download, replacement logic, backup/rollback
- Diagnostics: Version warnings (requires min-version config)
- Brewfile: Interactive review (diff display)

### High Complexity (defer or skip)
- Self-update: Background check notifications (state management)
- Diagnostics: Performance instrumentation
- Brewfile: Smart conflict resolution

---

## Sources

### CLI Best Practices
- [Command Line Interface Guidelines](https://clig.dev/)
- [CLI UX Best Practices - Evil Martians](https://evilmartians.com/chronicles/cli-ux-best-practices-3-patterns-for-improving-progress-displays)
- [Best Practices Building a CLI Tool - Zapier](https://zapier.com/engineering/how-to-cli/)

### Self-Update Patterns
- [go-github-selfupdate](https://github.com/rhysd/go-github-selfupdate)
- [GitHub CLI update check pattern](https://github.com/cli/cli/issues/743)
- [rustup self update behavior](https://rust-lang.github.io/rustup/basics.html)
- [mise self-update](https://mise.jdx.dev/cli/self-update.html)

### Diagnostics Patterns
- [Salesforce CLI Doctor](https://developer.salesforce.com/docs/platform/salesforce-cli-plugin/guide/integrate-doctor.html)
- [New Relic Diagnostics CLI](https://github.com/newrelic/newrelic-diagnostics-cli)
- [iTerm2 Terminal Detection](https://groups.google.com/g/iterm2-discuss/c/MpOWDIn6QTs)

### Brewfile Patterns
- [Homebrew Bundle Documentation](https://docs.brew.sh/Brew-Bundle-and-Brewfile)
- [Homebrew 5.0.0 Release](https://brew.sh/2025/11/12/homebrew-5.0.0/)
- [Brewfile Tips](https://gist.github.com/ChristopherA/a579274536aab36ea9966f301ff14f3f)

### Interactive Prompts
- [Interactive CLI Patterns](https://blog.logrocket.com/7-tui-libraries-interactive-terminal-apps/)
- [Confirmation Prompt Best Practices](https://www.baeldung.com/linux/bash-interactive-prompts)
- [taproom - Homebrew TUI](https://github.com/hzqtc/taproom)

### Semantic Versioning
- [Semantic Versioning 2.0.0](https://semver.org/)
- [semantic-release](https://github.com/semantic-release/semantic-release)
