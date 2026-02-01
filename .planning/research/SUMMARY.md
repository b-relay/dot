# Project Research Summary

**Project:** dot CLI v2.1 Polish & Self-Update
**Domain:** CLI dotfiles management enhancement
**Researched:** 2026-02-01
**Confidence:** HIGH

## Executive Summary

v2.1 enhances the existing dot CLI with self-update capability, improved diagnostics, and better brewfile sync UX. The research reveals this is a pure-enhancement release that requires **zero new dependencies** — all features can be implemented using Bun's built-in APIs, Node.js primitives, and the existing @clack/prompts library.

The recommended approach prioritizes safety over speed: implement atomic binary replacement with signature verification first, then layer on diagnostics and UX improvements. The biggest risk is the self-update mechanism itself — ETXTBSY errors, signature verification gaps, and state file corruption are well-documented pitfalls that must be addressed from day one, not retrofitted later.

The research shows strong confidence in the technical approach (verified patterns from rustup, gh, mise) but highlights two active Homebrew bugs (autoremove conflict, tap ordering) that constrain what we can safely implement in brewfile sync. The recommendation is to enhance what works today rather than promise features blocked by upstream issues.

## Key Findings

### Recommended Stack

**Zero new dependencies required.** All v2.1 features leverage existing infrastructure.

**Core capabilities already available:**
- **Bun fetch()**: GitHub Releases API access for version checks and binary downloads — faster than axios/node-fetch, supports HTTP/2 natively
- **Node.js fs/promises**: Atomic file operations via rename() for binary replacement and state file safety
- **@clack/prompts**: Interactive UI for update confirmation and brewfile config — already proven in syncConfig()
- **Bun shell ($)**: Version detection via subprocess execution — already used throughout codebase

**Notable anti-recommendations:**
- DON'T add semver library (our simple v0.x.y format needs only 20 lines of comparison logic)
- DON'T add axios/node-fetch (Bun's fetch is faster and Web API standard)
- DON'T add update frameworks like update-notifier (1.2MB overhead for features we don't need)

### Expected Features

**Must have (table stakes):**
- **Self-update: Version checking** — Users expect `dot update` to check GitHub releases and compare semver
- **Self-update: Platform detection** — Must download correct binary for arm64/x86_64 architecture
- **Self-update: Prompt confirmation** — Never update without explicit user consent (safety)
- **Diagnostics: Tool versions** — `dot doctor` should show "git 2.43.0" not just "git installed"
- **Brewfile: Dynamic type discovery** — Parse brew bundle output to discover vscode/mas/whalebrew instead of hardcoding

**Should have (competitive):**
- **Self-update: Changelog preview** — Show "What's new in 0.2.0" before updating (low effort, high value)
- **Diagnostics: Terminal detection** — Report iTerm2 vs other terminals (useful for Nerd Font debugging)
- **Diagnostics: Shell/Homebrew info** — Show shell version and Homebrew prefix for complete env picture
- **Brewfile: Type counts** — Show "vscode (42 extensions)" in config UI to inform exclusion decisions

**Defer (v2+):**
- **Self-update: Background checks** — Passive update notifications like gh CLI (requires state management complexity)
- **Self-update: Rollback UI** — Interactive rollback after failed update (backup strategy handles this)
- **Diagnostics: Version warnings** — "Git 2.30.0 is outdated, update to 2.43.0" (maintenance burden)
- **Brewfile: Interactive review** — Diff view of packages being added/removed (complex, low ROI)

### Architecture Approach

v2.1 follows the established single-entry-point pattern (index.ts command dispatch) while extracting complex logic to src/ modules. Self-update gets a new src/update.ts module (replacing current stub), diagnostics adds src/diagnostics.ts for version parsing utilities, and brewfile enhancements live inline within existing sync functions.

**Major components:**
1. **src/update.ts** — GitHub Releases API interaction, binary download with checksum validation, atomic replacement with backup/rollback
2. **src/diagnostics.ts** — Tool version extraction from --version output, stderr/stdout parsing with flexible regex, graceful degradation for unsupported formats
3. **index.ts sync enhancements** — Dynamic brewfile type discovery via brew bundle dump parsing, interactive exclusion config via multiselect UI (already exists as syncConfig stub)

**State management strategy:**
- Self-update: Stateless (no persistent tracking of last-check time in v2.1)
- Diagnostics: Ephemeral (no caching between runs)
- Brewfile config: Persist exclusions in existing dot.config.json brewfile.exclude array

**Key integration point:** The doctor-reviewed.json file currently lives in {dotfiles}/.doctor-reviewed.json but should migrate to ~/.config/dot/doctor-reviewed.json (machine-specific, not committed). Migration logic needed.

### Critical Pitfalls

1. **ETXTBSY on binary replacement** — Attempting to overwrite a running executable triggers "text file busy" errors on macOS/Linux. Prevention: Use rename() strategy (move old to .backup, write new to original path, delete backup after verification) or delete-then-write (delete old while running, write new — deleted inode persists). Do NOT use direct overwrite.

2. **Missing signature verification** — Downloading binaries from GitHub without verifying cryptographic signatures enables MITM attacks and supply chain compromise. Prevention: Use GitHub Artifact Attestations (gh attestation verify) or minimum SHA256 checksum validation. Must ship with verification from day one, not add later.

3. **State file corruption** — Writing ~/.config/dot/state.json without atomic operations can corrupt the file if update crashes mid-write, breaking all future dot commands. Prevention: Write to .state.json.tmp, fsync, rename to state.json (atomic on POSIX). Add recovery logic to load from .bak if main file corrupt.

4. **Stderr/stdout parsing fragility** — Tools change --version output format or add warnings to stderr, breaking version detection. .NET CLI moved diagnostics to stderr in 2026, breaking many parsers. Prevention: Capture both stdout and stderr, use flexible semver regex matching anywhere in output (not just line 1), gracefully degrade to "installed (version unknown)" on parse failure.

5. **Homebrew autoremove conflict (ACTIVE BUG)** — brew bundle --cleanup triggers autoremove which ignores your brewfile and removes explicitly-listed packages (Homebrew issue #21350, active as of Jan 2026). Prevention: Do NOT recommend or implement --cleanup flag. Wait for Homebrew fix. Document limitation.

## Implications for Roadmap

Based on research, suggested phase structure prioritizes safety and minimizes dependencies between features:

### Phase 1: Self-Update Foundation
**Rationale:** Core update mechanism must be bulletproof before adding convenience features. Atomic replacement, signature verification, and state safety are non-negotiable table stakes that can't be retrofitted.

**Delivers:** Working `dot update` command that checks GitHub releases, downloads correct binary for architecture, verifies integrity, and replaces current binary with backup/rollback strategy.

**Addresses:**
- Version checking and platform detection (table stakes from FEATURES.md)
- Prompt confirmation before updating (safety requirement)
- Changelog preview (quick win differentiator)

**Avoids:**
- ETXTBSY pitfall via rename() strategy
- Signature verification gap via GitHub attestations or checksums
- State file corruption via atomic write-then-rename

**Stack elements:** Bun fetch(), Node.js fs/promises rename(), @clack/prompts confirm()

**Architecture:** New src/update.ts module with clear separation: checkForUpdates(), downloadRelease(), replaceBinary()

**Estimated effort:** 4-5 tasks, ~4-6 hours (includes GitHub Actions setup for releases)

**Research needs:** SKIP — well-documented pattern from rustup/gh/mise, high-confidence sources

### Phase 2: Enhanced Diagnostics
**Rationale:** Extends existing doctor() infrastructure with version reporting. No external dependencies, well-scoped, minimal integration surface. Can develop in parallel with Phase 1.

**Delivers:** `dot doctor` output shows tool versions alongside installation status. Terminal, shell, and Homebrew environment info for debugging.

**Addresses:**
- Tool version display (table stakes)
- Terminal detection for iTerm2 (differentiator)
- Shell/Homebrew info (differentiator)

**Avoids:**
- Stderr/stdout fragility via capturing both streams + flexible parsing
- Shell alias false positives via command -v instead of which

**Stack elements:** Bun shell ($) for subprocess execution, regex parsing for version extraction

**Architecture:** New src/diagnostics.ts module exports getToolVersions(). Integration point: enhance doctor() to call getToolVersions() in parallel with existing checkDependencies()

**Estimated effort:** 2-3 tasks, ~2 hours

**Research needs:** SKIP — straightforward subprocess + parsing, high-confidence implementation

### Phase 3: Brewfile Sync UX
**Rationale:** Lowest risk phase — enhances existing sync functionality without new modules or external APIs. Interactive UI pattern already proven in syncConfig() stub.

**Delivers:** Dynamic brewfile type discovery (no more hardcoded ["vscode"]), interactive multiselect for exclusion config with type counts.

**Addresses:**
- Dynamic type discovery (table stakes)
- Type counts in UI (differentiator)
- Configurable exclusions (already implemented in schema, needs UI)

**Avoids:**
- Homebrew autoremove conflict by NOT implementing --cleanup (active bug)
- Homebrew tap path confusion via existing getPackageBaseName() normalization

**Stack elements:** @clack/prompts multiselect (already used), brew bundle dump parsing

**Architecture:** Inline enhancements to existing sync() and syncConfig() functions in index.ts. No new modules needed.

**Estimated effort:** 1-2 tasks, ~1 hour

**Research needs:** SKIP — extends existing code, well-understood patterns

### Phase 4: Doctor-Reviewed Migration
**Rationale:** Simple file location change with backward compatibility. Can be developed independently and merged anytime. Low risk, foundational cleanup.

**Delivers:** .doctor-reviewed.json moves from {dotfiles}/ to ~/.config/dot/ (machine-specific location). Auto-migration on first doctor run.

**Addresses:** Data location issue (reviewed paths are machine-specific, shouldn't be committed)

**Stack elements:** Node.js fs/promises for file operations, existing pathExists() helper

**Architecture:** Config type update (reviewedFile path) + migration logic in doctor() startup

**Estimated effort:** 1 task, ~30 minutes

**Research needs:** SKIP — trivial file move with migration

### Phase Ordering Rationale

- **Phases 1-3 have zero dependencies** on each other — can develop in parallel after requirements finalized
- **Phase 1 is highest priority** because self-update is the headline feature and highest risk
- **Phase 2 is lowest risk** so it's a good parallel work stream while waiting for GitHub release infrastructure
- **Phase 3 is pure UX enhancement** of existing functionality — can ship independently
- **Phase 4 is independent cleanup** that can merge anytime without blocking other phases

**Critical path:** Phase 1 (Self-Update) requires external setup (GitHub Actions workflow for building/releasing binaries) before it can be fully tested. Phases 2-4 can complete while waiting for release infrastructure.

**Parallel execution strategy:** Start Phase 1 + Phase 2 simultaneously. Complete Phase 4 as quick win. Ship Phase 3 when ready (independent timeline).

### Research Flags

**All phases: SKIP deeper research** — High confidence in technical approach, well-documented patterns from established CLIs, no niche domains or sparse documentation.

Phases with standard patterns (no research-phase needed):
- **Phase 1:** Self-update follows rustup/gh/mise patterns with verified sources (GitHub API docs, go-github-selfupdate, self-replace crate)
- **Phase 2:** Version parsing is straightforward subprocess + regex with clear edge cases documented
- **Phase 3:** Brewfile sync extends existing working code with official Homebrew documentation
- **Phase 4:** File migration is trivial

**External blockers:**
- **Phase 1** requires GitHub Actions workflow for binary builds (one-time setup, not research)
- **Phase 3** constrained by active Homebrew bugs (#21350 autoremove, #21416 tap ordering) — document limitations, don't implement blocked features

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies, all capabilities verified in existing Bun APIs. Sources: official Bun docs, verified usage in current codebase |
| Features | HIGH | Verified with Context7, official docs (GitHub API, Homebrew, iTerm2), and real-world CLI patterns (gh, rustup, mise, brew) |
| Architecture | MEDIUM | Integration patterns straightforward but binary replacement requires careful testing on real macOS hardware (arm64/x86_64). Prototyping recommended for Phase 1 |
| Pitfalls | HIGH | ETXTBSY, signature verification, and atomic writes are well-documented issues with verified solutions. Homebrew bugs (#21350, #21416) are active as of Jan 2026 with tracked GitHub issues |

**Overall confidence:** HIGH (ready for roadmap creation)

### Gaps to Address

**Phase 1 (Self-Update):**
- GitHub Actions workflow for binary builds needs creation (external to code)
- Binary signing/attestation strategy needs decision (checksums minimum, attestations ideal)
- Test on real macOS hardware required (can't fully mock ETXTBSY, rename() atomicity)

**Phase 2 (Diagnostics):**
- Version parsing edge cases need real-world testing (run against actual installed tools, not mocks)
- iTerm2 detection in tmux sessions needs verification (ITERM_SESSION_ID fallback)

**Phase 3 (Brewfile Sync):**
- Homebrew bug #21350 (autoremove) blocks --cleanup implementation — track upstream fix
- Homebrew bug #21416 (tap ordering) may cause bootstrap failures — document "run twice" workaround

**Phase 4 (Doctor-Reviewed):**
- No gaps — straightforward file migration

**Validation strategy:**
- Phase 1: Manual testing on macOS (arm64 required, x86_64 recommended for cross-arch verification)
- Phase 2: Integration tests with real tool output (no mocks for --version parsing)
- Phase 3: Test with custom taps to verify getPackageBaseName() normalization
- Phase 4: Test migration from old location to new location

## Sources

### Primary (HIGH confidence)

**Stack Research:**
- [GitHub Releases API Documentation](https://docs.github.com/en/rest/releases) — API endpoints for version discovery
- [Bun HTTP/Fetch API](https://bun.sh/docs/api/http) — Native fetch capabilities
- [@clack/prompts npm](https://www.npmjs.com/package/@clack/prompts) — Interactive UI library (already installed)
- [Homebrew JSON API](https://formulae.brew.sh/docs/api/) — brew info --json=v2 for package metadata

**Features Research:**
- [GitHub CLI update check pattern](https://github.com/cli/cli/issues/743) — Version checking UX
- [rustup self update behavior](https://rust-lang.github.io/rustup/basics.html) — Package manager detection
- [mise self-update](https://mise.jdx.dev/cli/self-update.html) — CLI update patterns
- [Homebrew Bundle Documentation](https://docs.brew.sh/Brew-Bundle-and-Brewfile) — Brewfile format specification
- [Homebrew 5.0.0 Release](https://brew.sh/2025/11/12/homebrew-5.0.0/) — Type additions (go package support)

**Architecture Research:**
- [GitHub - rhysd/go-github-selfupdate](https://github.com/rhysd/go-github-selfupdate) — Binary self-update pattern reference
- [GitHub - mitsuhiko/self-replace](https://github.com/mitsuhiko/self-replace) — Binary replacement utility patterns
- [Homebrew Brew-Bundle-and-Brewfile](https://docs.brew.sh/Brew-Bundle-and-Brewfile) — Official brewfile documentation

**Pitfalls Research:**
- [GitHub Artifact Attestations](https://github.blog/news-insights/product-news/introducing-artifact-attestations-now-in-public-beta/) — Signature verification via attestations
- [GitHub CLI attestation verify](https://cli.github.com/manual/gh_attestation_verify) — Verification implementation
- [ETXTBSY issue on chrome-aws-lambda](https://github.com/alixaxel/chrome-aws-lambda/issues/187) — Binary replacement pitfall
- [Rust self-replace crate](https://crates.io/crates/self-replace/1.3.6) — Cross-platform binary replacement
- [Homebrew issue #21350](https://github.com/homebrew/brew/issues/21350) — Active autoremove conflict bug
- [Homebrew issue #21416](https://github.com/homebrew/brew/issues/21416) — Active tap ordering bug

### Secondary (MEDIUM confidence)

**Atomic Writes:**
- [Blog: PSA Avoid Data Corruption](https://blog.elijahlopez.ca/posts/data-corruption-atomic-writing/) — Write-then-rename pattern
- [npm/write-file-atomic](https://github.com/npm/write-file-atomic) — Reference implementation
- [Crash-safe JSON at scale](https://dev.to/constanta/crash-safe-json-at-scale-atomic-writes-recovery-without-a-db-3aic) — Recovery strategies

**Version Detection:**
- [.NET CLI stderr breaking change](https://learn.microsoft.com/en-us/dotnet/core/compatibility/sdk/10.0/dotnet-cli-stderr-output) — Real-world parsing fragility example
- [iTerm2 Detection Methods](https://groups.google.com/g/iterm2-discuss/c/MpOWDIn6QTs) — Canonical TERM_PROGRAM detection

**Config Migration:**
- [Buf CLI v2 migration](https://buf.build/docs/migration-guides/migrate-v2-config-files/) — Auto-migration approach
- [Azure CLI breaking changes 2026](https://learn.microsoft.com/en-us/cli/azure/upcoming-breaking-changes?view=azure-cli-latest) — Scheduled breaking changes patterns

---
*Research completed: 2026-02-01*
*Ready for roadmap: yes*
