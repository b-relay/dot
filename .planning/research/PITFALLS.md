# Pitfalls Research: v2.1 CLI Enhancement Features

**Domain:** CLI tool enhancement (self-update, diagnostics, brewfile UX)
**Researched:** 2026-02-01
**Confidence:** HIGH (verified with official sources + real-world issues from 2026)

## Executive Summary

Adding self-update, enhanced diagnostics, and interactive config to an existing CLI presents specific risks that differ from greenfield development. The most critical pitfalls cluster around:

1. **Self-update security** - signature verification, MITM attacks, supply chain risks
2. **Binary replacement mechanics** - ETXTBSY errors, race conditions, atomic operations
3. **Config migration** - breaking changes, data loss, backward compatibility
4. **Version parsing fragility** - stderr/stdout mixing, unstable CLI output formats
5. **Brewfile sync edge cases** - tap paths, autoremove conflicts, order dependencies

This research focuses on **mistakes when ADDING these features** to your zero-dependency Bun binary, not general CLI best practices.

---

## Critical Pitfalls

### Self-Update: Running Binary Replacement (ETXTBSY)

**What goes wrong:**
On macOS/Linux, attempting to overwrite a currently-running executable triggers ETXTBSY (text file busy). The `dot update` command will download the new binary but fail to replace itself because the OS prevents writing to an executable that's currently executing.

**Why it happens:**
Unix-like systems lock executable files while they're running to maintain memory-mapped execution integrity. Naive implementation: `fetch(newBinary) -> writeFile(currentPath)` will fail.

**Consequences:**
- Update command fails mid-stream, leaving user with old version
- Potential for corrupt binary if write partially succeeds before lock
- Poor UX: "update succeeded" but version unchanged

**Prevention:**
1. **Rename strategy**: Move old binary to `.old` suffix, write new binary to original path, delete `.old` on next run
2. **Delete-then-write**: Delete old binary first (allowed even while running), then write new (works because deleted inode persists until process exits)
3. **Exec replacement**: Download to temp path, exec() the new binary with "finalize-update" flag that replaces the old binary after current process exits

**Warning signs:**
- ETXTBSY errors in update logs
- Update command reports success but `dot --version` shows old version
- Binary corruption after failed update

**Detection:**
```bash
# Test: try overwriting running binary
cp dot dot.test
./dot.test update  # Should handle ETXTBSY gracefully
dot --version  # Should show new version after update
```

**Phase to address:** Phase 1 (Self-Update MVP) - core update mechanism must handle this from the start

**Source confidence:** HIGH
- [GitHub issue on chrome-aws-lambda ETXTBSY](https://github.com/alixaxel/chrome-aws-lambda/issues/187)
- [Rust self-replace crate documentation](https://crates.io/crates/self-replace/1.3.6) - addresses cross-platform binary replacement
- [Golang binary self-update](https://medium.com/@jordane.gengo/golang-binary-self-update-home-made-solution-b5508c320de5) - rename strategy

---

### Self-Update: Missing Signature Verification

**What goes wrong:**
Downloading a binary from GitHub releases without verifying cryptographic signatures allows attackers to serve malicious binaries via MITM attacks, compromised CDN, or DNS hijacking.

**Why it happens:**
Developers focus on "fetch latest release" functionality and defer security "for later." GitHub provides release URLs openly, making implementation appear simple without signatures.

**Consequences:**
- Users could execute attacker-controlled code with full system privileges
- Supply chain attack vector (compromised release pipeline)
- Reputational damage if exploited

**Prevention:**
1. **Use GitHub Artifact Attestations** (available in 2026): Generate signed attestations during release via `actions/attest-build-provenance`
2. **Verify before exec**: `gh attestation verify PATH --repo OWNER/REPO` before replacing binary
3. **Checksum verification** (minimum): Download SHA256 checksum file, verify before install
4. **Fail closed**: If verification unavailable/fails, abort update with clear error

**Warning signs:**
- No signature/checksum verification in update code
- Direct `curl | sh` pattern without validation
- Skipping verification "temporarily" to unblock feature

**Detection:**
- Code review: search for `fetch(releaseUrl)` without subsequent verification
- Test: MITM proxy serving fake binary should fail verification

**Phase to address:** Phase 1 (Self-Update MVP) - must ship with verification, not add later

**Source confidence:** HIGH
- [GitHub Artifact Attestations GA](https://github.blog/news-insights/product-news/introducing-artifact-attestations-now-in-public-beta/)
- [GitHub CLI attestation verify](https://cli.github.com/manual/gh_attestation_verify)
- [GitHub Security Advisory on Critical Vulnerabilities](https://cyble.com/blog/github-releases-security-advisory-on-critical-vulnerability-in-self-hosted-environments/)

---

### Self-Update: Atomic State File Corruption

**What goes wrong:**
Writing `~/.config/dot/state.json` during update without atomic writes can corrupt the file if update crashes mid-write. Subsequent `dot` commands fail with JSON parse errors, leaving CLI broken.

**Why it happens:**
Naive `JSON.stringify() -> writeFile()` is not atomic. If process crashes (killed, OOM, power loss) between truncating file and completing write, state file contains partial JSON.

**Consequences:**
- CLI completely broken - all commands fail on state load
- User loses configuration (dotfiles path, last update check timestamp)
- Requires manual recovery or reinstall

**Prevention:**
1. **Write-then-rename**: Write to `.state.json.tmp`, fsync, rename to `state.json` (atomic on POSIX)
2. **Backup before write**: Copy `state.json` to `.state.json.bak` before update
3. **Recoverable reads**: On JSON parse error, try `.bak`, fallback to default state
4. **Never overwrite evidence**: If corrupt, log it for debugging, don't silently replace

**Warning signs:**
- `await Bun.write(stateFile, JSON.stringify(state))` without atomic pattern
- No backup/recovery logic for state file
- JSON parse errors after update interruptions

**Detection:**
```bash
# Test: kill update mid-write
dot update &
PID=$!
sleep 0.5 && kill -9 $PID
dot --version  # Should not fail with JSON parse error
```

**Phase to address:** Phase 1 (Self-Update MVP) - state updates must be atomic

**Source confidence:** HIGH
- [Blog: PSA Avoid Data Corruption by Syncing to the Disk](https://blog.elijahlopez.ca/posts/data-corruption-atomic-writing/)
- [npm/write-file-atomic](https://github.com/npm/write-file-atomic)
- [Dev.to: Crash-safe JSON at scale](https://dev.to/constanta/crash-safe-json-at-scale-atomic-writes-recovery-without-a-db-3aic)

---

## Moderate Pitfalls

### Diagnostics: Stderr/Stdout Parsing Fragility

**What goes wrong:**
Parsing tool versions by running `tool --version` breaks when tools change output format, add warnings to stderr, or use inconsistent streams (some write version to stdout, others to stderr).

**Why it happens:**
Tools don't guarantee stable `--version` output. Warnings, update notifications, or debug info can appear on either stream. Example: `.NET CLI moved diagnostics to stderr in 2026` breaking many parsers.

**Consequences:**
- `dot doctor` reports tools as missing when they're installed (false negative)
- Version parsing returns garbage (e.g., "Warning: deprecated flag" instead of "1.2.3")
- Diagnostics break after tool updates without code changes

**Prevention:**
1. **Capture both streams**: `const { stdout, stderr, exitCode } = await $\`tool --version\`.nothrow()`
2. **Try multiple patterns**: First stdout, fallback to stderr, use exitCode as success indicator
3. **Flexible regex**: Match semantic versioning pattern anywhere in output, not just first line
4. **Graceful degradation**: If version unparseable, report "installed (version unknown)" not "missing"
5. **Test with real tools**: Don't mock - run against actual tool output in tests

**Warning signs:**
- Parsing only stdout without checking stderr
- Strict regex requiring version to be on line 1
- No fallback when version format unexpected

**Detection:**
- Test against multiple tool versions (old and new)
- Inject stderr warnings and verify parsing still works

**Phase to address:** Phase 2 (Enhanced Diagnostics) - version parsing should be robust from start

**Source confidence:** MEDIUM
- [.NET CLI stderr breaking change](https://learn.microsoft.com/en-us/dotnet/core/compatibility/sdk/10.0/dotnet-cli-stderr-output)
- [Claude Code CLI macOS 26 bug](https://github.com/anthropics/claude-code/issues/19663) - stdout/stderr capture issue
- [General CLI best practices: stderr vs stdout](https://blog.codeinside.eu/2025/11/05/understanding-stdin-stdout-and-stderr-in-dotnet/)

---

### Diagnostics: Homebrew Tap Path Confusion

**What goes wrong:**
Brewfile entries like `brew "oven-sh/bun/bun"` (tap path) don't match `brew list` output which shows just `bun`. Your `checkBrewfileSync` will report `bun` as "installed but not in brewfile" even though it IS in brewfile with tap path.

**Why it happens:**
Homebrew supports three package name formats:
- Core formula: `brew "git"`
- Tap with same name: `brew "oven-sh/bun/bun"` (tap/repo/formula)
- Tap with different name: `brew "homebrew/cask/docker"`

`brew list` always returns the formula name only (`bun`), not the full tap path. Your current code handles this correctly via `getPackageBaseName()`, but edge cases exist.

**Consequences:**
- False positives in sync status (reports packages as untracked when they're actually tracked via tap)
- User confusion: "why does `dot doctor` say bun is untracked when it's in my brewfile?"
- Incorrect cleanup suggestions

**Prevention:**
1. **Normalize both sides**: Extract basename from brewfile entries, compare basenames (you already do this)
2. **Check tap membership**: If basename matches, verify formula is from expected tap via `brew info <formula> --json`
3. **Document tap format**: Add comment in brewfile generation explaining tap syntax
4. **Test with tap packages**: Ensure `bun`, `oven-sh/bun/bun`, and `homebrew/bun/bun` all resolve correctly

**Warning signs:**
- `getPackageBaseName()` not applied consistently to both brewfile and installed package names
- Sync status showing false positives for tap-installed packages
- No test coverage for tap path formats

**Detection:**
```bash
# Install via tap
brew install oven-sh/bun/bun
# Check brewfile sync - should NOT report "untracked"
dot doctor  # Look for false positives
```

**Phase to address:** Phase 2 (Brewfile UX) - tap handling must work correctly

**Source confidence:** HIGH
- [Homebrew Bundle documentation](https://docs.brew.sh/Brew-Bundle-and-Brewfile)
- [Homebrew 5.0.0 release notes](https://brew.sh/2025/11/12/homebrew-5.0.0/) - tap syntax updates
- Codebase analysis: `getPackageBaseName()` exists but edge cases possible

---

### Brewfile Sync: Autoremove Conflict (ACTIVE BUG IN 2026)

**What goes wrong:**
`brew bundle --cleanup` triggers autoremove which ignores your brewfile and removes packages that appear to be orphaned dependencies, even if explicitly listed in brewfile. This is a known active bug in Homebrew as of January 2026.

**Why it happens:**
`brew bundle --cleanup` doesn't pass the brewfile package list to the autoremove process, so autoremove treats explicitly-installed packages as orphaned dependencies if another package requires them.

**Consequences:**
- Running `dot sync` followed by `brew bundle cleanup` removes packages unexpectedly
- User loses packages they explicitly want
- Brewfile becomes unreliable for declarative package management

**Prevention:**
1. **Avoid recommending `--cleanup` flag** until Homebrew fixes the issue (track GitHub issue #21350)
2. **Document the limitation**: Warn users that cleanup may remove brewfile packages
3. **Implement manual cleanup**: Parse brewfile + installed packages, show diff, let user manually `brew uninstall` extras
4. **Protected list approach**: If Homebrew fixes issue, use proposed solution of passing brewfile packages as protected list

**Warning signs:**
- Documentation/help text recommends `brew bundle --cleanup` without caveats
- Sync command automatically runs cleanup without user confirmation
- No warning about the active bug

**Detection:**
- Install package A that requires B as dependency
- Add A to brewfile (not B)
- Run `brew bundle --cleanup`
- Check if B was removed (should not be, but will be due to bug)

**Phase to address:** Phase 2 (Brewfile UX) - do NOT implement auto-cleanup, wait for Homebrew fix

**Source confidence:** HIGH
- [Homebrew issue #21350](https://github.com/homebrew/brew/issues/21350) - active as of 2026
- Proposed solutions under discussion, not yet merged

---

### Config Migration: State File Location Change Without Migration Path

**What goes wrong:**
Moving state file from `~/.config/dot/state.json` to a new location (or changing schema) without providing automatic migration breaks existing installations. Users run `dot` commands and get "config not found" errors.

**Why it happens:**
Developer changes config location for better organization, assumes users will "just run init again." Users don't read release notes, expect CLI to continue working after update.

**Consequences:**
- Broken CLI after update - all commands fail
- User loses dotfiles path configuration
- Negative UX: "update broke my setup"
- Support burden: users filing issues

**Prevention:**
1. **Detect old location**: On startup, check for config in old location before failing
2. **Auto-migrate**: If old config found, migrate to new location, show message
3. **Version state file**: Add `"version": 1` field to detect schema changes
4. **Backward compatibility window**: Support both locations for N releases before deprecating old
5. **Migration logging**: Write migration events to stderr so users know what happened

**Warning signs:**
- Changing config paths without migration code
- No version field in state schema
- Assuming users will "just reconfigure"

**Detection:**
- Create old-style state file
- Run updated binary
- Should auto-migrate, not fail

**Phase to address:** Phase 1 (Self-Update MVP) - state file changes need migration from day 1

**Source confidence:** MEDIUM
- [Azure CLI breaking changes 2026](https://learn.microsoft.com/en-us/cli/azure/upcoming-breaking-changes?view=azure-cli-latest) - scheduled breaking changes
- [Buf CLI v2 migration](https://buf.build/docs/migration-guides/migrate-v2-config-files/) - automatic migration approach
- General CLI migration patterns

---

### Brewfile Sync: Tap Installation Order Dependency

**What goes wrong:**
Brewfile entries like `tap "user/repo"` followed by `brew "user/repo/package"` fail during `brew bundle install` if tap isn't installed first. Homebrew 2026 has a known issue where bundle forgets to install taps before their dependents.

**Why it happens:**
`brew bundle install` doesn't properly order operations, attempting to install formulae before their taps are added to the system. This is an active bug in Homebrew (issue #21416).

**Consequences:**
- `brew bundle install --file=brewfile` fails with "No available formula with the name"
- User can't bootstrap new machine from brewfile
- Undermines declarative package management goal

**Prevention:**
1. **Don't use custom taps in initial MVP** - stick to core formulae and official casks
2. **Document the limitation** if supporting taps: "May require running `brew bundle install` twice"
3. **Manual tap ordering**: Pre-parse brewfile, extract `tap` lines, run `brew tap` for each before `brew bundle install`
4. **Test with taps**: Ensure end-to-end test includes custom tap to catch ordering issues

**Warning signs:**
- Brewfile with custom taps not tested on clean machine
- Assuming `brew bundle install` handles order automatically
- No documentation of tap limitations

**Detection:**
```bash
# On clean machine (or after brew untap)
brew bundle install --file=brewfile  # With tap dependencies
# Should work, but may fail due to Homebrew bug
```

**Phase to address:** Phase 2 (Brewfile UX) - document limitation, don't promise support for custom taps

**Source confidence:** HIGH
- [Homebrew issue #21416](https://github.com/homebrew/brew/issues/21416) - active bug report 2026

---

## Minor Pitfalls

### Self-Update: Version Check Rate Limiting

**What goes wrong:**
Checking for updates on every command invocation hits GitHub API rate limits (60 requests/hour unauthenticated), causing update checks to fail silently or slow down all commands.

**Why it happens:**
Developer adds "check for update" to CLI startup without throttling. Every `dot` command invocation makes a GitHub API call.

**Consequences:**
- GitHub rate limit errors after ~60 commands in an hour
- Slower command startup (network latency)
- Poor offline behavior

**Prevention:**
1. **Check interval**: Only check for updates every 24 hours, store last-check timestamp in state
2. **Async check**: Don't block command execution on update check
3. **Graceful degradation**: If check fails (offline, rate limit), silently skip, don't error
4. **Explicit command**: Provide `dot update check` for manual check, don't auto-check

**Warning signs:**
- Update check on every command without caching
- Synchronous update check blocking command startup
- No rate limit handling

**Detection:**
- Run `dot` command 100 times in quick succession
- Should not hit rate limits or slow down

**Phase to address:** Phase 1 (Self-Update MVP) - implement check interval from start

**Source confidence:** MEDIUM (best practices)

---

### Diagnostics: False Positives from Shell Aliases

**What goes wrong:**
`which <command>` returns shell aliases instead of actual binaries, causing `dot doctor` to report tools as installed when they're just aliases pointing to nonexistent commands.

**Why it happens:**
`which` is a shell builtin that resolves aliases. Running via `$\`which tool\`` in Bun executes in subshell that may inherit aliases from user's shell config.

**Consequences:**
- False positives: "git installed" when it's actually an alias to `/usr/local/bin/git` that doesn't exist
- Misleading doctor output
- User confusion

**Prevention:**
1. **Use `command -v`** instead of `which` (POSIX standard, doesn't expand aliases)
2. **Verify executability**: After `which`, check if result is executable file (not alias)
3. **Run without alias expansion**: `$\`bash -c 'command -v tool'\`` to bypass aliases

**Warning signs:**
- Using `which` without verifying result is actual binary
- No test coverage for alias edge cases

**Detection:**
```bash
# Create alias in shell config
alias git='/nonexistent/git'
# Run doctor
dot doctor  # Should not report git as installed
```

**Phase to address:** Phase 2 (Enhanced Diagnostics) - use `command -v` from start

**Source confidence:** LOW (general best practice, no specific 2026 source)

---

### Config Migration: Breaking Changes Without Compatibility

**What goes wrong:**
Changing `dot.config.json` schema (e.g., renaming `links` to `symlinks`) without supporting old schema breaks existing configs. Users update CLI, all commands fail with schema validation errors.

**Why it happens:**
Developer refactors config structure for clarity, validates against new schema, rejects old format.

**Consequences:**
- Broken CLI after update
- User must manually update config file
- Poor update experience

**Prevention:**
1. **Schema versioning**: Add `"version": 1` field, support multiple versions
2. **Auto-upgrade**: Detect old schema, transform to new, write back
3. **Deprecation warnings**: Support old schema with warning before breaking change
4. **Test both schemas**: Ensure CLI works with old and new configs during transition

**Warning signs:**
- Renaming config fields without backward compatibility
- Strict schema validation rejecting old formats
- No schema version field

**Detection:**
- Keep old config file
- Update CLI
- Should auto-migrate or warn, not fail

**Phase to address:** Throughout - config changes need migration logic always

**Source confidence:** MEDIUM
- [.NET 10 breaking changes guide](https://www.gapvelocity.ai/blog/dotnet8-to-dotnet10-migration-guide/)
- General CLI migration patterns

---

### Brewfile Sync: Exclude Filter Regex Escaping

**What goes wrong:**
Building regex pattern from user-provided exclude list (`["vscode", "mas"]`) without escaping special regex characters could allow injection if exclude values contain regex metacharacters (unlikely but possible).

**Why it happens:**
`new RegExp(\`^(${exclude.join('|')})\`)` directly interpolates user input into regex. If exclude list contains `.*` or `[a-z]`, unexpected matching occurs.

**Consequences:**
- Unexpected packages filtered out
- Regex errors if malformed pattern
- Minor security concern (low impact - only affects local brewfile filtering)

**Prevention:**
1. **Escape regex metacharacters**: Use `exclude.map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))`
2. **Whitelist approach**: Only allow known exclude types (`vscode`, `mas`, `whalebrew`)
3. **Test with edge cases**: Include `.`, `*`, `[` in test exclude values

**Warning signs:**
- `new RegExp()` with direct user input
- No escaping of special characters

**Detection:**
```bash
# Add exclude value with regex chars
dot sync config  # Try entering ".*" as exclude
# Should not cause regex errors
```

**Phase to address:** Phase 2 (Brewfile UX) - escape regex or whitelist from start

**Source confidence:** LOW (defensive programming, no specific incident)

---

## Phase-Specific Warnings

| Phase | Likely Pitfall | Mitigation |
|-------|---------------|------------|
| Phase 1: Self-Update MVP | ETXTBSY on binary replacement | Use rename or delete-then-write strategy |
| Phase 1: Self-Update MVP | Missing signature verification | Implement GitHub attestation verification from start |
| Phase 1: Self-Update MVP | State file corruption | Atomic write-then-rename pattern |
| Phase 2: Enhanced Diagnostics | Stderr/stdout parsing fragility | Capture both streams, flexible regex, graceful degradation |
| Phase 2: Brewfile UX | Homebrew autoremove conflict | Avoid `--cleanup` flag, document limitation |
| Phase 2: Brewfile UX | Tap path confusion | Normalize basenames on both sides |
| Phase 3: Interactive Config | Config migration without backward compat | Schema versioning, auto-migration |

---

## Testing Recommendations

### Self-Update Testing
- Test binary replacement on macOS (arm64 and x86_64)
- Test interrupted update (kill mid-download, mid-write)
- Test offline update check (should gracefully degrade)
- Test signature verification with invalid signature

### Diagnostics Testing
- Test version parsing with stderr warnings injected
- Test with tools not installed, installed, and different versions
- Test Homebrew tap path matching (core vs tap formulae)

### Config Migration Testing
- Test upgrade from old state schema to new
- Test old config location to new location migration
- Test with missing state file (should fall back gracefully)

### Brewfile Sync Testing
- Test with custom taps (document ordering limitation)
- Test exclude filter with regex special characters
- Test with packages installed via tap vs core

---

## Sources

**Self-Update Security:**
- [GitHub Artifact Attestations](https://github.blog/news-insights/product-news/introducing-artifact-attestations-now-in-public-beta/)
- [GitHub CLI attestation verify](https://cli.github.com/manual/gh_attestation_verify)
- [GitHub Security Advisory](https://cyble.com/blog/github-releases-security-advisory-on-critical-vulnerability-in-self-hosted-environments/)

**Binary Replacement:**
- [ETXTBSY issue on chrome-aws-lambda](https://github.com/alixaxel/chrome-aws-lambda/issues/187)
- [Rust self-replace crate](https://crates.io/crates/self-replace/1.3.6)
- [Golang binary self-update](https://medium.com/@jordane.gengo/golang-binary-self-update-home-made-solution-b5508c320de5)
- [Bun self-update issue](https://github.com/oven-sh/bun/issues/5727)

**Atomic Writes:**
- [Blog: PSA Avoid Data Corruption](https://blog.elijahlopez.ca/posts/data-corruption-atomic-writing/)
- [npm/write-file-atomic](https://github.com/npm/write-file-atomic)
- [Crash-safe JSON at scale](https://dev.to/constanta/crash-safe-json-at-scale-atomic-writes-recovery-without-a-db-3aic)

**Diagnostics & Parsing:**
- [.NET CLI stderr breaking change](https://learn.microsoft.com/en-us/dotnet/core/compatibility/sdk/10.0/dotnet-cli-stderr-output)
- [Claude Code CLI macOS 26 bug](https://github.com/anthropics/claude-code/issues/19663)

**Homebrew Issues:**
- [Homebrew autoremove conflict #21350](https://github.com/homebrew/brew/issues/21350)
- [Homebrew tap ordering #21416](https://github.com/homebrew/brew/issues/21416)
- [Homebrew Bundle documentation](https://docs.brew.sh/Brew-Bundle-and-Brewfile)
- [Homebrew 5.0.0 release](https://brew.sh/2025/11/12/homebrew-5.0.0/)

**Config Migration:**
- [Azure CLI breaking changes 2026](https://learn.microsoft.com/en-us/cli/azure/upcoming-breaking-changes?view=azure-cli-latest)
- [Buf CLI v2 migration](https://buf.build/docs/migration-guides/migrate-v2-config-files/)
- [.NET 10 migration guide](https://www.gapvelocity.ai/blog/dotnet8-to-dotnet10-migration-guide/)
