# Codebase Concerns

**Analysis Date:** 2026-01-26

## Tech Debt

**Hardcoded file paths in symlink configuration:**
- Issue: The LINKS map in `createConfig()` has hardcoded paths specific to macOS (e.g., `~/Library/Application Support/Code/User/settings.json`). This limits portability and makes the tool non-functional on Linux or other Unix systems.
- Files: `src/index.ts` lines 114-123
- Impact: Tool only works on macOS. Attempting to use on Linux would fail to create correct symlinks or skip VS Code config entirely.
- Fix approach: Conditionally build the links map based on `process.platform`, or externalize LINKS to a config file that can be overridden per system.

**External dependency on `claude` CLI tool:**
- Issue: The `doctor` command assumes the user has installed Anthropic's `claude` CLI tool and that it's configured with API credentials. No graceful degradation if unavailable.
- Files: `src/index.ts` line 1026
- Impact: The entire `doctor` command is unusable without this external tool. The error message is generic and doesn't help users install/configure it.
- Fix approach: Provide installation instructions in the error message, or implement fallback analysis without Claude (less powerful but functional).

**No error handling for failed shell commands in `sync()`:**
- Issue: The `sync()` function calls `brew bundle dump` and `git status -s` without error handling. If these commands fail (missing Homebrew, no git repo, permission denied), the function crashes with an unhandled promise rejection.
- Files: `src/index.ts` lines 673, 683
- Impact: Running `dot sync` when git repo is broken or Homebrew is misconfigured will crash the tool instead of reporting the error clearly.
- Fix approach: Wrap shell commands in try-catch blocks and provide actionable error messages.

**Large JSON context passed to external process:**
- Issue: The `doctor` command builds a large JSON context (including all dotfiles, symlink statuses, repo files) and passes it as a command-line argument to the `claude` CLI. Very large repositories could hit command-line argument size limits or make debugging difficult.
- Files: `src/index.ts` lines 992-1026
- Impact: On repositories with thousands of files, the command may fail silently or truncate data. Difficult to debug what was actually sent to Claude.
- Fix approach: Write context to a temporary file and pass the file path, or use stdin instead of command-line arguments.

## Known Bugs

**Symlink path comparison with spaces and special characters:**
- Symptoms: Symlink creation may fail or show false positives if target paths contain spaces or special characters (e.g., macOS Library/Application Support directory)
- Files: `src/index.ts` lines 148-166 (linksToExpectedResolved), 595-624 (install function)
- Trigger: Create a symlink to a path with spaces (like the VS Code settings path)
- Workaround: The code attempts to use `realpath()` for canonicalization, which should handle this, but edge cases with broken symlinks + spaces could cause issues

**Brewfile filtering doesn't preserve vscode extension format:**
- Symptoms: When `sync()` filters out vscode packages, it uses simple string matching that may accidentally remove legitimate comments or multiline entries
- Files: `src/index.ts` lines 652-663 (filterBrewfile function)
- Trigger: Run `dot sync` with vscode installed and extensions in brewfile
- Workaround: Currently just filters lines starting with `vscode "`, which is fragile if someone comments on the same line

## Security Considerations

**Unvalidated shell command execution via CLI argument:**
- Risk: The `doctor` command passes user-controlled context (dotfiles paths, git status output) directly into a shell command string without quoting or escaping. A specially crafted path or git output could inject shell commands.
- Files: `src/index.ts` line 1026: `` await $`claude -p ${prompt + "\n\n" + context} --model haiku` ``
- Current mitigation: Bun's `$` template tag does some escaping, but this should be verified. The context is built from the system (not direct user input), so risk is lower.
- Recommendations: Use Bun's `$` tag properly (already done), but add a safety check to validate the context doesn't contain shell metacharacters, or use stdin instead of arguments.

**File path normalization doesn't prevent directory traversal attacks:**
- Risk: The `review()` command accepts a path argument and normalizes it, but doesn't validate that the result stays within the home directory. A user could theoretically review `/etc/passwd` and mark arbitrary files as reviewed.
- Files: `src/index.ts` lines 900-922 (review function), 576-590 (normalizePath function)
- Current mitigation: The reviewed paths are stored in `~/.dotfiles/.doctor-reviewed.json` which only affects the doctor output, not system files. The impact is low (only affects recommendations, not actual modifications).
- Recommendations: Add a check that normalized path is within home directory or dotfiles directory before marking as reviewed.

**No permission validation before writing to dotfiles:**
- Risk: The `sync()` command calls `Bun.write()` to update brewfile without checking write permissions first. Similarly, `install()` creates symlinks without validating ownership of target directories.
- Files: `src/index.ts` lines 679 (sync), 596-619 (install)
- Current mitigation: These will fail at runtime if permissions denied, but error messages won't be clear.
- Recommendations: Add pre-flight checks for write permissions to dotfiles directory and target symlink directories.

## Performance Bottlenecks

**Sequential directory scanning in `getDotfiles()`:**
- Problem: The function reads the entire home directory and ~/.config directory sequentially with Promise.all(), but not in parallel across both directories. For users with thousands of dotfiles, this could be slow.
- Files: `src/index.ts` lines 740-868
- Cause: The function does sequential readdir() calls, then Promise.all() on the results. Could parallelize the initial readdir calls.
- Improvement path: Parallelize the two initial readdir() calls, and consider using a concurrent queue for stat() operations if there are thousands of files.

**Full JSON serialization for large dotfiles repos:**
- Problem: The `doctor` command serializes the entire state (all dotfiles, symlinks, repo files) to JSON, which could be 10MB+ for large repos.
- Files: `src/index.ts` lines 992-1005
- Cause: No filtering or sampling of data before serialization.
- Improvement path: Implement data sampling (show only first N unmanaged files, summarize counts instead of full lists) for large repos, or implement incremental analysis.

**Multiple spawned shell commands in doctor flow:**
- Problem: The `doctor` command spawns many shell commands sequentially: checkDependencies (N x `which`), getInstalledPackages (2 x `brew list`), getRepoFiles (1 x `git ls-files`), getGitStatus (2 x `git` commands). These could be batched or parallelized.
- Files: `src/index.ts` lines 930-990
- Cause: Sequential execution for clarity, but many commands wait for previous ones.
- Improvement path: Already uses Promise.all() in some places (lines 935, 873-876), but could extend this to batch all shell operations at the start.

## Fragile Areas

**Brewfile parsing with regex:**
- Files: `src/index.ts` lines 287-333 (parseBrewfile)
- Why fragile: The regex patterns `/^brew\s+"([^"]+)"/` and `/^cask\s+"([^"]+)"/` are brittle:
  - Doesn't handle escaped quotes in package names
  - Assumes consistent whitespace (one space after brew/cask keyword)
  - Doesn't handle comments after packages on same line
  - No validation that the parsed package name is valid
- Safe modification: Add test cases for edge cases (spaces in names, comments, escaped quotes). Consider using a proper parser or more defensive regex with trimming.
- Test coverage: `tests/brewfile.test.ts` exists but only has 181 lines; check for coverage of edge cases.

**Symlink resolution logic with broken symlinks:**
- Files: `src/index.ts` lines 130-134 (resolveSymlinkTarget), 148-166 (linksToExpectedResolved), 695-722 (getSymlinkStatus)
- Why fragile: The code attempts to handle both working and broken symlinks, but the `realpath()` fallback logic is complex:
  - If symlink is broken, `realpath()` returns null, falls back to comparing absolute paths
  - If source doesn't exist yet (fresh install), comparison succeeds even if source is invalid
  - Edge case: symlink -> relative path could resolve differently depending on context
- Safe modification: Add comprehensive integration tests with broken symlinks pointing to non-existent sources. Test relative vs absolute symlinks.
- Test coverage: `tests/integration.test.ts` has 830 lines, likely covers this, but verify broken symlink scenarios.

**Hardcoded path patterns for architecture detection:**
- Files: `src/index.ts` lines 449-526 (scanForHardcodedPaths)
- Why fragile: The function scans specific file locations (`zsh/zprofile`, `zsh/config/*.zsh`, `zsh/plugins/*.zsh`) for hardcoded paths. If user reorganizes zsh config structure, detection breaks.
- Safe modification: Make the file list configurable, or recursively scan the entire zsh directory.
- Test coverage: Check `tests/doctor.test.ts` for coverage of this scenario.

**Install function doesn't handle symlink race conditions:**
- Files: `src/index.ts` lines 592-624 (install)
- Why fragile: Between checking if a symlink exists and creating it, another process could modify the file system. TOCTOU (time-of-check, time-of-use) race condition possible.
- Safe modification: Implement atomic symlink creation (create to temp path, then rename), or add retry logic.
- Test coverage: Not applicable to unit tests without race condition testing framework.

## Scaling Limits

**In-memory storage of all dotfiles for analysis:**
- Current capacity: Tested with ~1000 files, but memory usage not profiled
- Limit: With 100,000+ dotfiles (e.g., large node_modules in home dir), the entire `getDotfiles()` result is held in memory before sending to Claude.
- Scaling path: Implement streaming analysis (iterate in batches, send batches to Claude separately), or implement file system event watching for incremental updates.

**Dot files discovery traverses entire home directory:**
- Current capacity: `getDotfiles()` reads all entries in home and ~/.config
- Limit: On systems with thousands of cached app data files, directory listing could be slow or hit descriptor limits.
- Scaling path: Implement incremental caching of dotfiles state, skip common cache directories (node_modules, .cache, .cargo, etc. - partially done already).

## Dependencies at Risk

**External shell dependency: `brew`, `git`, `which`:**
- Risk: The tool assumes Homebrew, git, and basic Unix tools are available. Running on non-Homebrew systems (Linux, Windows with WSL) will fail partially or completely.
- Impact: `doctor` command fails if Homebrew not installed. `sync` command fails if git not initialized. Dependency checks fail if `which` not available (rare but possible).
- Migration plan: Make these checks optional or provide clear error messages guiding users to install required tools. Consider supporting other package managers (apt, nix, etc.) in the future.

**Bun runtime dependency:**
- Risk: The tool is written in TypeScript and compiled to a Bun binary. If Bun updates its API or drops support for a feature, the tool could break.
- Impact: Moderate - Bun is well-maintained and stable, but dependency on a single runtime limits portability.
- Migration plan: TypeScript/Bun combination is intentional and appropriate for this tool. Keep Bun updated.

## Missing Critical Features

**No dry-run mode for install/uninstall:**
- Problem: Users can't preview what symlinks will be created without actually creating them. Dangerous for first-time users.
- Blocks: Safe onboarding of new users; testing without side effects.

**No rollback/undo functionality:**
- Problem: If `install()` creates 3/8 symlinks and fails, there's no command to undo the partial installation. Users must manually unlink.
- Blocks: Atomic installation; safe recovery from failed installs.

**No support for conditional links (OS-specific, hostname-specific):**
- Problem: The links map is static. Can't have different symlinks for work vs personal machine, or different OS configurations.
- Blocks: Sharing dotfiles across multiple machines with different configurations.

## Test Coverage Gaps

**No tests for CLI argument parsing errors:**
- What's not tested: Invalid arguments to `install` (e.g., `dot install --unknown`), missing arguments to `review`
- Files: `src/index.ts` lines 79-100 (parseInstallArgs), 900-922 (review)
- Risk: These could crash with unhelpful error messages instead of showing usage
- Priority: Medium

**No tests for concurrent file system operations:**
- What's not tested: Multiple symlink creations/deletions happening concurrently, or file system changes during doctor scan
- Files: `src/index.ts` (entire install/uninstall/doctor flow)
- Risk: Race conditions could cause silent failures or corrupted state
- Priority: Low (low probability in single-user tool)

**No tests for very large dotfiles repos:**
- What's not tested: Performance and correctness with 10K+ dotfiles, very large JSON context
- Files: `src/index.ts` lines 740-868 (getDotfiles), 992-1005 (context building)
- Risk: Tool could hang, crash, or truncate data silently
- Priority: Medium

**No tests for edge case paths:**
- What's not tested: Paths with newlines, null bytes, very long paths (>255 chars), paths with non-UTF8 encoding
- Files: `src/index.ts` lines 576-590 (normalizePath), 695-722 (getSymlinkStatus)
- Risk: Tool could crash or corrupt state on unusual but valid paths
- Priority: Low (low probability on typical systems)

**No tests for missing/unavailable external tools:**
- What's not tested: Behavior when brew, git, or claude CLI not installed or not in PATH
- Files: `src/index.ts` lines 182-185 (isToolInstalled), 665-686 (sync), 930-1033 (doctor)
- Risk: Unhelpful error messages; tool crashes instead of graceful degradation
- Priority: High (critical for user experience)

**No tests for corrupted reviewed paths file:**
- What's not tested: Behavior when .doctor-reviewed.json contains non-JSON data, is truncated, or has file permissions issues
- Files: `src/index.ts` lines 548-559 (readReviewedPaths), 561-568 (writeReviewedPaths)
- Risk: Exception not caught; doctor command could crash
- Current coverage: Has one test (doctor.test.ts) for corrupted JSON, but no tests for file permission errors
- Priority: Medium

---

*Concerns audit: 2026-01-26*
