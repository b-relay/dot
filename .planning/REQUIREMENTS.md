# Requirements: v2.1 Polish & Self-Update

## Milestone Requirements

### Self-Update
- [ ] **UPDATE-01**: User can check for updates via `dot update` command
- [ ] **UPDATE-02**: User sees current vs latest version comparison
- [ ] **UPDATE-03**: User is prompted before downloading/installing update
- [ ] **UPDATE-04**: Source code is fetched from GitHub and built locally with Bun
- [ ] **UPDATE-05**: User sees release notes/changelog before confirming update

### Enhanced Diagnostics
- [ ] **DIAG-01**: Doctor detects iTerm2 via `$TERM_PROGRAM`, falling back to `/Applications/iTerm.app` check
- [ ] **DIAG-02**: Doctor shows environment info section (shell, Homebrew prefix, architecture)

### Brewfile Sync
- [ ] **BREW-01**: Sync discovers package types dynamically from `brew bundle dump` output
- [ ] **BREW-02**: User is prompted interactively to select which types to exclude
- [ ] **BREW-03**: Exclusion preferences are stored in dot config (not hardcoded)
- [ ] **BREW-04**: No default exclusions - user explicitly chooses
- [ ] **BREW-05**: Remove `sync config` subcommand - inline exclusion flow into `sync`

### Doctor-Reviewed
- [ ] **REVIEW-01**: Reviewed paths stored at `~/.config/dot/reviewed.json` (create dir if needed)
- [ ] **REVIEW-02**: User can specify custom ignore duration when reviewing
- [ ] **REVIEW-03**: User can choose "forever" to permanently ignore a path

### Init Wizard Fixes
- [ ] **INIT-01**: Directory browser skips `/tmp` folders
- [ ] **INIT-02**: Add `--dry-run` flag to test init without making changes
- [ ] **INIT-03**: Non-valuable dotfiles (caches, temp) are annotated with notes
- [ ] **INIT-04**: Investigate and fix false conflict detection bug

## Future Requirements

(None deferred)

## Out of Scope

- **Tool versions in doctor output** — Deferred (adds complexity, versions change frequently)
- **Auto-update without prompting** — Too invasive
- **Background update checks** — Adds latency to every command
- **Auto-cleanup of Homebrew packages** — Blocked by Homebrew bug #21350
- **Pre-built binary downloads** — Build from source locally instead
- **Homebrew installation detection** — No Homebrew install method exists

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| INIT-01 | Phase 7 | Pending |
| INIT-02 | Phase 7 | Pending |
| INIT-03 | Phase 7 | Pending |
| INIT-04 | Phase 7 | Pending |
| REVIEW-01 | Phase 8 | Pending |
| REVIEW-02 | Phase 8 | Pending |
| REVIEW-03 | Phase 8 | Pending |
| BREW-01 | Phase 9 | Pending |
| BREW-02 | Phase 9 | Pending |
| BREW-03 | Phase 9 | Pending |
| BREW-04 | Phase 9 | Pending |
| BREW-05 | Phase 9 | Pending |
| DIAG-01 | Phase 10 | Pending |
| DIAG-02 | Phase 10 | Pending |
| UPDATE-01 | Phase 11 | Pending |
| UPDATE-02 | Phase 11 | Pending |
| UPDATE-03 | Phase 11 | Pending |
| UPDATE-04 | Phase 11 | Pending |
| UPDATE-05 | Phase 11 | Pending |

---
*19 requirements across 5 categories - 100% mapped to phases*
