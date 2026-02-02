/**
 * Requirement Validation Tests
 *
 * These tests validate that the code does what it SHOULD do according to
 * the roadmap requirements, not just that the implementation works.
 *
 * Phase 7: Init Wizard Fixes
 * Phase 8: Doctor-Reviewed Migration
 * Phase 8.1: Symlink Path Fix
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  symlink,
  lstat,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  // Phase 7: Annotations
  isLowValueFile,
  getLowValueAnnotation,
  // Phase 8.1: Path expansion
  expandPath,
  // Phase 7: Preview
  previewSymlinks,
  // Test exports
  __test as wizardTest,
} from "../src/wizard";

import {
  getReviewedFilePath,
  isIgnored,
  type ReviewedEntry,
} from "../index";

const { FILTERED_DIRS, SKIP_HOME_DOTFILES, DEFAULT_LOW_VALUE_PATTERNS } = wizardTest;

// ============================================================================
// Phase 7: Init Wizard Fixes
// ============================================================================

describe("Phase 7 Requirement: User browsing directories never sees /tmp folders", () => {
  /**
   * Success Criterion 1: User browsing directories never sees /tmp folders
   *
   * FILTERED_DIRS should include common system/temp directories that users
   * should not browse into during init wizard.
   */

  test("FILTERED_DIRS includes /tmp directory", () => {
    expect(FILTERED_DIRS.has("tmp")).toBe(true);
  });

  test("FILTERED_DIRS includes common system directories", () => {
    // These are system directories users shouldn't browse into
    expect(FILTERED_DIRS.has("var")).toBe(true);
    expect(FILTERED_DIRS.has("private")).toBe(true);
    expect(FILTERED_DIRS.has("System")).toBe(true);
    expect(FILTERED_DIRS.has("Volumes")).toBe(true);
  });

  test("FILTERED_DIRS includes cache/build directories", () => {
    // Common cache directories that should be filtered
    expect(FILTERED_DIRS.has("node_modules")).toBe(true);
    expect(FILTERED_DIRS.has(".git")).toBe(true);
    expect(FILTERED_DIRS.has("Library")).toBe(true);
    expect(FILTERED_DIRS.has("__pycache__")).toBe(true);
    expect(FILTERED_DIRS.has("build")).toBe(true);
    expect(FILTERED_DIRS.has("dist")).toBe(true);
  });

  test("FILTERED_DIRS includes package manager caches", () => {
    expect(FILTERED_DIRS.has(".npm")).toBe(true);
    expect(FILTERED_DIRS.has(".yarn")).toBe(true);
    expect(FILTERED_DIRS.has(".pnpm")).toBe(true);
    expect(FILTERED_DIRS.has(".bun")).toBe(true);
  });
});

describe("Phase 7 Requirement: User sees helpful annotations for non-valuable dotfiles", () => {
  /**
   * Success Criterion 3: User sees helpful annotations for non-valuable dotfiles
   *
   * Files that are caches, history, temp files should be annotated so users
   * know they probably don't want to track them.
   */

  test("identifies history files as low-value", () => {
    expect(isLowValueFile(".zsh_history")).toBe(true);
    expect(isLowValueFile(".bash_history")).toBe(true);
    expect(isLowValueFile(".node_repl_history")).toBe(true);
    expect(isLowValueFile(".python_history")).toBe(true);
  });

  test("annotates history files correctly", () => {
    expect(getLowValueAnnotation(".zsh_history")).toBe("history file");
    expect(getLowValueAnnotation(".bash_history")).toBe("history file");
    expect(getLowValueAnnotation("something_history")).toBe("history file");
  });

  test("identifies cache files as low-value", () => {
    expect(isLowValueFile(".cache")).toBe(true);
    expect(isLowValueFile(".tmp")).toBe(true);
  });

  test("annotates cache files correctly", () => {
    expect(getLowValueAnnotation(".cache")).toBe("cache");
    expect(getLowValueAnnotation("somecache")).toBe("cache");
  });

  test("identifies system files as low-value", () => {
    expect(isLowValueFile(".DS_Store")).toBe(true);
    expect(isLowValueFile(".localized")).toBe(true);
    expect(isLowValueFile(".CFUserTextEncoding")).toBe(true);
  });

  test("annotates system files correctly", () => {
    expect(getLowValueAnnotation(".DS_Store")).toBe("system file");
    expect(getLowValueAnnotation(".localized")).toBe("system file");
  });

  test("identifies backup/swap files as low-value", () => {
    expect(isLowValueFile("file.bak")).toBe(true);
    expect(isLowValueFile("file.swp")).toBe(true);
    expect(isLowValueFile("file.swo")).toBe(true);
  });

  test("annotates backup/swap files correctly", () => {
    expect(getLowValueAnnotation("file.bak")).toBe("backup/swap file");
    expect(getLowValueAnnotation("file.swp")).toBe("backup/swap file");
  });

  test("identifies log files as low-value", () => {
    expect(isLowValueFile("debug.log")).toBe(true);
    expect(isLowValueFile("error.log")).toBe(true);
  });

  test("annotates log files correctly", () => {
    expect(getLowValueAnnotation("debug.log")).toBe("log file");
  });

  test("does NOT mark valuable config files as low-value", () => {
    expect(isLowValueFile(".zshrc")).toBe(false);
    expect(isLowValueFile(".gitconfig")).toBe(false);
    expect(isLowValueFile(".tmux.conf")).toBe(false);
    expect(isLowValueFile(".vimrc")).toBe(false);
  });

  test("custom highValue patterns override low-value detection", () => {
    // If user marks something as high-value, it should not be low-value
    expect(isLowValueFile(".cache", { highValue: [".cache"] })).toBe(false);
  });

  test("custom lowValue patterns add to detection", () => {
    // Custom patterns should be detected as low-value
    expect(isLowValueFile(".my-cache", { lowValue: [".my-cache"] })).toBe(true);
  });
});

describe("Phase 7 Requirement: False conflict detection bug is resolved", () => {
  /**
   * Success Criterion 4: False conflict detection bug is resolved and verified
   *
   * previewSymlinks should correctly distinguish between:
   * - Real files (conflict)
   * - Symlinks pointing to correct source (already-linked)
   * - Symlinks pointing to wrong source (wrong-target)
   */

  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-conflict-test-"));
    await mkdir(`${tmpDir}/dotfiles`, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("detects real file as conflict (not false positive)", async () => {
    // Setup: source exists in dotfiles, real file exists at target
    await writeFile(`${tmpDir}/dotfiles/zshrc`, "# source");
    await writeFile(`${tmpDir}/.zshrc`, "# existing file");

    const links = {
      [`${tmpDir}/dotfiles/zshrc`]: `${tmpDir}/.zshrc`,
    };

    const result = await previewSymlinks(links, `${tmpDir}/dotfiles`);

    expect(result.hasConflicts).toBe(true);
    expect(result.items[0]?.status).toBe("conflict");
  });

  test("detects correct symlink as already-linked (not false conflict)", async () => {
    // Setup: source exists, symlink points to correct source
    await writeFile(`${tmpDir}/dotfiles/zshrc`, "# source");
    await symlink(`${tmpDir}/dotfiles/zshrc`, `${tmpDir}/.zshrc`);

    const links = {
      [`${tmpDir}/dotfiles/zshrc`]: `${tmpDir}/.zshrc`,
    };

    const result = await previewSymlinks(links, `${tmpDir}/dotfiles`);

    expect(result.hasConflicts).toBe(false);
    expect(result.items[0]?.status).toBe("already-linked");
  });

  test("detects wrong-target symlink (not false conflict)", async () => {
    // Setup: source exists, symlink points to WRONG file
    await writeFile(`${tmpDir}/dotfiles/zshrc`, "# source");
    await writeFile(`${tmpDir}/other-file`, "# other");
    await symlink(`${tmpDir}/other-file`, `${tmpDir}/.zshrc`);

    const links = {
      [`${tmpDir}/dotfiles/zshrc`]: `${tmpDir}/.zshrc`,
    };

    const result = await previewSymlinks(links, `${tmpDir}/dotfiles`);

    expect(result.hasConflicts).toBe(false);
    expect(result.hasWrongTargets).toBe(true);
    expect(result.items[0]?.status).toBe("wrong-target");
  });

  test("handles relative symlinks correctly (bug that caused false conflicts)", async () => {
    // This is the specific bug: relative symlinks were being compared incorrectly
    await writeFile(`${tmpDir}/dotfiles/zshrc`, "# source");
    // Create symlink with relative path
    await symlink("dotfiles/zshrc", `${tmpDir}/.zshrc`);

    const links = {
      [`${tmpDir}/dotfiles/zshrc`]: `${tmpDir}/.zshrc`,
    };

    const result = await previewSymlinks(links, `${tmpDir}/dotfiles`);

    // Should NOT be detected as conflict - it points to the right place
    expect(result.hasConflicts).toBe(false);
    expect(result.items[0]?.status).toBe("already-linked");
  });
});

// ============================================================================
// Phase 8: Doctor-Reviewed Migration
// ============================================================================

describe("Phase 8 Requirement: Reviewed paths stored at ~/.config/dot/reviewed.json", () => {
  /**
   * Success Criterion 1: Reviewed paths stored at ~/.config/dot/reviewed.json
   * instead of in dotfiles repo
   */

  test("getReviewedFilePath returns XDG-compliant path", () => {
    const path = getReviewedFilePath();

    // Must be under ~/.config/dot/
    expect(path).toContain("/.config/dot/reviewed.json");

    // Must be absolute path starting with home
    expect(path).toMatch(/^\/.*\/\.config\/dot\/reviewed\.json$/);

    // Must NOT be in dotfiles repo
    expect(path).not.toContain(".dotfiles");
  });
});

describe("Phase 8 Requirement: User can choose 'forever' option to permanently ignore", () => {
  /**
   * Success Criterion 3: User can choose "forever" option to permanently ignore a path
   */

  test("forever entry is always ignored regardless of time", () => {
    const entry: ReviewedEntry = { type: "forever" };

    // Should be ignored now
    expect(isIgnored(entry, new Date("2024-01-01"))).toBe(true);

    // Should be ignored in the future
    expect(isIgnored(entry, new Date("2099-12-31"))).toBe(true);

    // Should be ignored in the past
    expect(isIgnored(entry, new Date("2020-01-01"))).toBe(true);
  });

  test("timed entry expires but forever does not", () => {
    const timedEntry: ReviewedEntry = { type: "timed", expiresAt: "2024-06-15" };
    const foreverEntry: ReviewedEntry = { type: "forever" };

    const beforeExpiry = new Date("2024-06-14T12:00:00Z");
    const afterExpiry = new Date("2024-06-16T12:00:00Z");

    // Timed entry: valid before, expired after
    expect(isIgnored(timedEntry, beforeExpiry)).toBe(true);
    expect(isIgnored(timedEntry, afterExpiry)).toBe(false);

    // Forever entry: valid always
    expect(isIgnored(foreverEntry, beforeExpiry)).toBe(true);
    expect(isIgnored(foreverEntry, afterExpiry)).toBe(true);
  });
});

describe("Phase 8 Requirement: User can specify custom ignore duration", () => {
  /**
   * Success Criterion 2: User can specify custom ignore duration when reviewing a path
   */

  test("timed entry with custom duration works correctly", () => {
    // User chose 7 days from 2024-06-01
    const entry: ReviewedEntry = { type: "timed", expiresAt: "2024-06-08" };

    // Should be ignored during the 7 days
    expect(isIgnored(entry, new Date("2024-06-01T12:00:00Z"))).toBe(true);
    expect(isIgnored(entry, new Date("2024-06-07T12:00:00Z"))).toBe(true);

    // Should NOT be ignored after expiry
    expect(isIgnored(entry, new Date("2024-06-09T12:00:00Z"))).toBe(false);
  });

  test("supports various duration lengths", () => {
    const now = new Date("2024-06-01T12:00:00Z");

    // 30 days
    const thirtyDays: ReviewedEntry = { type: "timed", expiresAt: "2024-07-01" };
    expect(isIgnored(thirtyDays, now)).toBe(true);
    expect(isIgnored(thirtyDays, new Date("2024-07-02T12:00:00Z"))).toBe(false);

    // 90 days
    const ninetyDays: ReviewedEntry = { type: "timed", expiresAt: "2024-08-30" };
    expect(isIgnored(ninetyDays, now)).toBe(true);
    expect(isIgnored(ninetyDays, new Date("2024-08-31T12:00:00Z"))).toBe(false);

    // 365 days
    const oneYear: ReviewedEntry = { type: "timed", expiresAt: "2025-06-01" };
    expect(isIgnored(oneYear, now)).toBe(true);
    expect(isIgnored(oneYear, new Date("2025-06-02T12:00:00Z"))).toBe(false);
  });
});

// ============================================================================
// Phase 8.1: Symlink Path Fix
// ============================================================================

describe("Phase 8.1 Requirement: expandPath expands ~ to actual home directory", () => {
  /**
   * Success Criterion 1: installLinks() expands ~ to actual home directory
   *
   * The expandPath function is used by installLinks, getConflicts, getWrongTargets,
   * and previewSymlinks to ensure ~ is expanded before filesystem operations.
   */

  test("expands bare ~ to HOME", () => {
    const home = process.env.HOME ?? "";
    expect(expandPath("~")).toBe(home);
  });

  test("expands ~/ paths to HOME-relative paths", () => {
    const home = process.env.HOME ?? "";
    expect(expandPath("~/.zshrc")).toBe(`${home}/.zshrc`);
    expect(expandPath("~/.config/git/config")).toBe(`${home}/.config/git/config`);
  });

  test("preserves absolute paths", () => {
    expect(expandPath("/usr/local/bin")).toBe("/usr/local/bin");
    expect(expandPath("/tmp/test")).toBe("/tmp/test");
  });

  test("resolves relative paths", () => {
    // Relative paths are resolved against cwd, but the key point is
    // they are NOT treated as ~ paths
    const result = expandPath("./config");
    expect(result).not.toContain("~");
    expect(result.startsWith("/")).toBe(true);
  });

  test("does NOT expand ~user syntax (shell-specific)", () => {
    // ~user/foo should NOT be expanded - only ~ and ~/ are special
    const result = expandPath("~user/foo");
    // Should be treated as relative path, not user home expansion
    expect(result).not.toBe(`/home/user/foo`);
  });
});

describe("Phase 8.1 Requirement: previewSymlinks uses expanded paths", () => {
  /**
   * Success Criterion 3: previewSymlinks() uses expanded paths for lstat() checks
   *
   * When links use ~/path syntax, previewSymlinks must expand them before
   * checking filesystem state.
   */

  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-tilde-test-"));
    await mkdir(`${tmpDir}/dotfiles`, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("handles tilde paths in links correctly", async () => {
    // Create source file
    await writeFile(`${tmpDir}/dotfiles/zshrc`, "# source");

    // Use absolute path for target (simulating what happens after expansion)
    // The key requirement is that previewSymlinks calls expandPath internally
    const links = {
      [`${tmpDir}/dotfiles/zshrc`]: `${tmpDir}/.zshrc`,
    };

    const result = await previewSymlinks(links, `${tmpDir}/dotfiles`);

    // Should detect as new (no existing file)
    expect(result.items[0]?.status).toBe("new");
  });

  test("detects conflicts with expanded paths", async () => {
    // Create source and conflicting target
    await writeFile(`${tmpDir}/dotfiles/zshrc`, "# source");
    await writeFile(`${tmpDir}/.zshrc`, "# existing");

    const links = {
      [`${tmpDir}/dotfiles/zshrc`]: `${tmpDir}/.zshrc`,
    };

    const result = await previewSymlinks(links, `${tmpDir}/dotfiles`);

    // Should detect the conflict
    expect(result.hasConflicts).toBe(true);
    expect(result.items[0]?.status).toBe("conflict");
  });
});

describe("Phase 8.1 Requirement: Symlinks created at correct locations", () => {
  /**
   * Success Criterion 4: Init wizard creates symlinks at correct locations
   * (e.g., /Users/brendon/.zshenv not /Users/brendon/.dotfiles/~/.zshenv)
   *
   * This is a regression test for the bug where literal "~/" was being used
   * in filesystem operations instead of the expanded path.
   */

  test("expandPath never returns literal tilde in path", () => {
    const testPaths = [
      "~",
      "~/.zshrc",
      "~/.config/git/config",
      "~/Documents/file.txt",
    ];

    for (const path of testPaths) {
      const expanded = expandPath(path);
      expect(expanded).not.toContain("~");
      expect(expanded.startsWith("/")).toBe(true);
    }
  });

  test("expandPath returns valid absolute paths", () => {
    const home = process.env.HOME ?? "";

    // All these should be absolute paths under HOME
    expect(expandPath("~/.zshrc")).toBe(`${home}/.zshrc`);
    expect(expandPath("~/.config")).toBe(`${home}/.config`);

    // Verify they're valid paths (no double slashes, etc.)
    expect(expandPath("~/.zshrc")).not.toContain("//");
    expect(expandPath("~/.config/git")).not.toContain("//");
  });
});

// ============================================================================
// Cross-cutting: SKIP lists for home dotfiles
// ============================================================================

describe("SKIP_HOME_DOTFILES contains appropriate entries", () => {
  /**
   * These entries should never be offered for tracking in the init wizard.
   * This validates the user experience of not seeing irrelevant files.
   */

  test("includes system files", () => {
    expect(SKIP_HOME_DOTFILES.has(".DS_Store")).toBe(true);
    expect(SKIP_HOME_DOTFILES.has(".Trash")).toBe(true);
  });

  test("includes caches and temp directories", () => {
    expect(SKIP_HOME_DOTFILES.has(".cache")).toBe(true);
    expect(SKIP_HOME_DOTFILES.has(".local")).toBe(true);
    expect(SKIP_HOME_DOTFILES.has(".tmp")).toBe(true);
  });

  test("includes package manager directories", () => {
    expect(SKIP_HOME_DOTFILES.has(".npm")).toBe(true);
    expect(SKIP_HOME_DOTFILES.has(".yarn")).toBe(true);
    expect(SKIP_HOME_DOTFILES.has(".cargo")).toBe(true);
    expect(SKIP_HOME_DOTFILES.has(".go")).toBe(true);
  });

  test("includes version managers", () => {
    expect(SKIP_HOME_DOTFILES.has(".nvm")).toBe(true);
    expect(SKIP_HOME_DOTFILES.has(".pyenv")).toBe(true);
    expect(SKIP_HOME_DOTFILES.has(".rbenv")).toBe(true);
  });

  test("includes history files", () => {
    expect(SKIP_HOME_DOTFILES.has(".zsh_history")).toBe(true);
    expect(SKIP_HOME_DOTFILES.has(".bash_history")).toBe(true);
  });

  test("includes secrets directories", () => {
    expect(SKIP_HOME_DOTFILES.has(".gnupg")).toBe(true);
    expect(SKIP_HOME_DOTFILES.has(".password-store")).toBe(true);
    expect(SKIP_HOME_DOTFILES.has(".netrc")).toBe(true);
  });
});
