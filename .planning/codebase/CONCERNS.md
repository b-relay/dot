# Codebase Concerns

**Analysis Date:** 2026-01-25

## Tech Debt

**Code Duplication in getDotfiles:**
- Issue: The home directory and ~/.config directory scanning logic is duplicated nearly verbatim (lines 333-376 and 378-420 in `dot/index.ts`)
- Files: `dot/index.ts` (lines 333-420)
- Impact: Any changes to scanning logic or entry building must be applied in two places. Risk of divergence and maintenance burden.
- Fix approach: Extract the scanning logic into a private helper function `async function scanDirectory(path: string, shouldExclude: (name: string) => boolean, managedTargets: Set<string>): Promise<Dotfile[]>` and call it from both locations.

**Hardcoded LINKS Map:**
- Issue: The symlink definitions are hardcoded in `createConfig()` at lines 37-46 in `dot/index.ts`. Adding new configs requires modifying the index.ts file directly.
- Files: `dot/index.ts` (lines 37-46)
- Impact: Not scalable for config management. All config sources live in this one function. Difficult to version control or organize config definitions.
- Fix approach: Consider moving LINKS to a separate `links.json` or `links.ts` file that can be updated independently. Would allow future `dot sync-links` functionality.

**Swallowed Errors in getDotfiles:**
- Issue: Multiple broad `catch` blocks silently ignore all errors (lines 333-376, 374-375, 378-420, 412-413, 418-419)
- Files: `dot/index.ts` (getDotfiles function)
- Impact: Permission errors, disk I/O issues, or unexpected failures are completely hidden. User receives no warning when a directory can't be scanned.
- Fix approach: Log warnings for directory read failures and file stat failures. At minimum, log which directories/files couldn't be scanned so user knows the report is incomplete.

## Fragile Areas

**Symlink Resolution Path Normalization:**
- Files: `dot/index.ts` (lines 52-89, linksToExpectedResolved and resolveSymlinkTarget)
- Why fragile: The symlink comparison logic is subtle and depends on careful path normalization. The fix at line 4eb2f90 required extensive testing to get right. Any changes to path handling must account for:
  - Absolute vs relative symlink targets
  - .., ., and other path components
  - Canonical paths vs normalized paths (realpath vs resolve)
  - Symlinks that cross filesystem boundaries (on macOS, /var -> /private/var)
- Safe modification: Run full test suite after any changes. The integration tests (dot/tests/integration.test.ts lines 209-264) specifically validate relative symlink resolution—these must continue to pass.
- Test coverage: Well covered by integration tests, but the logic is complex enough that manual verification on actual systems with varied symlink patterns is recommended.

**Doctor Command Dependency on Claude CLI:**
- Files: `dot/index.ts` (lines 549-556)
- Why fragile: The `doctor` command requires the external `claude` CLI tool to be installed and authenticated. Failure is fatal with exit(1). User workflow breaks if:
  - Claude CLI is not in PATH
  - Claude CLI authentication is invalid
  - Claude API is unreachable
  - User doesn't have proper environment configuration
- Safe modification: Consider adding a fallback to JSON output or a simpler local analysis if claude CLI is unavailable. Or make the doctor command graceful degradation—provide the raw analysis data even if Claude analysis fails.
- Test coverage: doctor.test.ts validates data gathering but does not test actual claude CLI invocation (would require mocking shell commands).

**getDotfiles Exclusion List Maintenance:**
- Files: `dot/index.ts` (lines 297-322)
- Why fragile: The hardcoded exclusion patterns (skipNames and skipPatterns) must be kept current as:
  - New tools create new cache/config directories (.cursor, .bun, etc.)
  - History file patterns vary per tool (.lesshst, .python_history, .node_repl_history)
  - Pattern maintenance is manual and easy to forget
- Safe modification: Document the purpose of each entry (what tool/purpose). Consider adding a comment block explaining when each was added and why.
- Test coverage: Some entries are tested (getDotfiles integration tests), but not exhaustive coverage of all patterns.

## Performance Bottlenecks

**Promise.all + File I/O in getDotfiles:**
- Problem: Both home directory and .config scanning use Promise.all() to parallelize stat() calls (lines 335, 381). On systems with slow filesystems or many dotfiles, this can spike I/O and memory.
- Files: `dot/index.ts` (lines 335-372, 381-416)
- Cause: Concurrent stat() calls on all entries in a directory can overwhelm I/O on slow systems. Not normally a problem on modern SSDs but problematic on network mounts or older systems.
- Improvement path: Could implement a configurable concurrency limit (e.g., pool of 4-8 concurrent operations) if this becomes an issue. For now, acceptable since most home directories are small.

**JSON.stringify in Doctor Command:**
- Problem: The doctor command serializes all symlink status, repo files, dotfiles, and git status to JSON for the prompt (lines 522-533). For repos with thousands of dotfiles, this creates a large context string.
- Files: `dot/index.ts` (lines 522-533)
- Cause: All data is included in the prompt verbatim without sampling or summarization. Larger context = slower Claude API calls and higher token usage.
- Improvement path: Could implement context summarization (e.g., "X files, of which Y are untracked" instead of listing all). For most users, this is not a problem.

## Security Considerations

**Symlink Attack Potential (TOCTOU):**
- Risk: Between checking if a symlink points to the correct target and acting on it, an attacker could race-condition the symlink to point elsewhere.
- Files: `dot/index.ts` (install and uninstall functions, lines 149-205)
- Current mitigation: The code validates symlinks before unlinking (uninstall only removes symlinks we verify are ours). Vulnerable window is small.
- Recommendations: On systems with many users or untrusted home directories, consider using O_NOFOLLOW or similar flags. For personal dotfiles (the use case here), current protection is adequate.

**External Command Execution (doctor command):**
- Risk: The doctor command passes user home directory data and config to the `claude` CLI via shell command (line 550). If user's home path contains shell metacharacters, could cause issues.
- Files: `dot/index.ts` (line 550)
- Current mitigation: Data is passed via backtick template in Bun, which should handle escaping. The `$` template from "bun" should escape properly.
- Recommendations: Consider using process.spawn() instead of shell command execution for better isolation. However, the `claude` CLI invocation requires interactive shell handling, so current approach is pragmatic.

**JSON File Permissions (.doctor-reviewed.json):**
- Risk: The reviewed file location stores user decisions but doesn't use restricted permissions.
- Files: `dot/index.ts` (writeReviewedPaths function, line 124)
- Current mitigation: File is in ~/.dotfiles (user-owned directory), so accessible only to the owner on Unix systems.
- Recommendations: No immediate issue for personal use. If extended to multi-user systems, consider chmod 600 on the reviewed file.

## Scaling Limits

**LINKS Map Size:**
- Current capacity: 8 entries (lines 37-46)
- Limit: No hard limit, but management becomes difficult beyond ~20-30 entries without moving to a config file. Current approach requires code changes.
- Scaling path: Move LINKS to external JSON file as mentioned in Tech Debt section. Would support unlimited entries.

**getDotfiles Directory Scanning:**
- Current capacity: Tested with hundreds of entries in mock tests; should handle typical home directories fine.
- Limit: Will become slow (hundreds of seconds) if scanning a home directory with 100K+ files. Unlikely in practice.
- Scaling path: Could add directory depth limits or implement incremental/cached scanning if needed.

**Doctor Command Context Size:**
- Current capacity: Claude API accepts ~100K tokens; JSON serialization typically <1K tokens for typical setups.
- Limit: Repos with >10K tracked files or thousands of untracked dotfiles could exceed token limits.
- Scaling path: Not a concern for typical personal dotfiles. Would need sampling/filtering for enterprise use.

## Missing Critical Features

**No Rollback Mechanism:**
- Problem: If `dot install` creates incorrect symlinks or fails partially, no built-in way to revert to previous state.
- Blocks: Users can't safely experiment with new configs or test changes without manual recovery procedures.
- Approach: Could implement `dot backup` to create a snapshot of symlink state and `dot restore` to revert. Would require storing state snapshots in `.doctor-reviewed.json` or separate file.

**No Config Validation:**
- Problem: The LINKS map is not validated at startup. If a config entry references a non-existent source or an inaccessible target path, `install` silently skips it.
- Blocks: Users don't get clear feedback on why a config wasn't installed.
- Approach: Add `dot validate` command to check all LINKS entries and report issues before running install.

**No Dry-Run Mode:**
- Problem: Users can't preview what `dot install` will do without actually creating symlinks.
- Blocks: Risky to run `install` on unfamiliar systems without seeing what will change.
- Approach: Add `--dry-run` flag to install/uninstall commands to show planned changes without executing.

## Test Coverage Gaps

**Doctor Command Execution:**
- What's not tested: The actual `doctor` command's execution with Claude CLI (lines 485-556)
- Files: `dot/index.ts` (doctor function), doctor.test.ts doesn't test CLI invocation
- Risk: Changes to the doctor command or prompt could break the user experience silently. Claude CLI integration isn't verified by tests.
- Priority: High - this is a user-facing feature with external dependency

**Brew Bundle Filtering:**
- What's not tested: Real brewfile output (only mocked in tests)
- Files: `dot/index.ts` (filterBrewfile function, lines 207-218), has unit tests but not integration
- Risk: If Homebrew changes output format, filtering could silently drop important entries
- Priority: Medium - would only affect users running `dot sync`

**Error Handling in getDotfiles:**
- What's not tested: Permission denied errors, I/O failures, or corrupted file metadata
- Files: `dot/index.ts` (getDotfiles function, lines 295-423)
- Risk: Silently failing on permission errors means doctor report is incomplete without user knowing
- Priority: Medium - affects reliability of doctor command

**Symlink Edge Cases:**
- What's not tested: Symlinks with unusual encoding, very long paths (>255 chars), or symlinks in restricted directories
- Files: `dot/index.ts` (symlink handling)
- Risk: Rare but could cause silent failures on unusual systems
- Priority: Low - unlikely in typical personal dotfiles use

**Cross-Platform Behavior:**
- What's not tested: Windows paths, case-insensitive filesystems, or non-Unix permission models
- Files: Entire codebase assumes Unix-like systems
- Risk: Code would fail in unexpected ways on Windows or other platforms
- Priority: Low - project is explicitly macOS-focused per README and CLAUDE.md

## Known Issues

**Non-fatal but annoying:**
- None explicitly documented in code, but review command output messages could be clearer (lines 473-476 in index.ts show generic messages without context about what prompted the review).

---

*Concerns audit: 2026-01-25*
