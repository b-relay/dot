import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createConfig,
  getLegacyLinks,
  getRepoFiles,
  getGitStatus,
  __test,
  type Config,
} from "../index";
import { $ } from "bun";

const { readReviewedPaths, writeReviewedPaths, markAsReviewed } = __test;
import { normalizePath } from "../index";

// Test helper: create config with legacy links for a given home directory
function createTestConfig(home: string): Config {
  const dotfiles = `${home}/.dotfiles`;
  const dotconfig = `${home}/.config`;
  const links = getLegacyLinks(dotfiles, home, dotconfig);
  return createConfig(dotfiles, links, home);
}

// --- Test utilities ---

async function initGitRepo(path: string): Promise<void> {
  await $`git -C ${path} init -b main`.quiet();
  await $`git -C ${path} config user.email "test@example.com"`.quiet();
  await $`git -C ${path} config user.name "Test User"`.quiet();
}

// --- readReviewedPaths tests ---

describe("readReviewedPaths", () => {
  let tmpDir: string;
  let config: Config;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-reviewed-read-"));
    await mkdir(`${tmpDir}/.dotfiles`, { recursive: true });
    config = createTestConfig(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("returns empty object when file doesn't exist", async () => {
    const result = await readReviewedPaths(config);
    expect(result).toEqual({});
  });

  test("parses valid JSON", async () => {
    const data = { "/path/to/file": "2024-01-01" };
    await writeFile(config.reviewedFile, JSON.stringify(data));
    const result = await readReviewedPaths(config);
    expect(result).toEqual(data);
  });

  test("returns empty object for corrupted JSON", async () => {
    await writeFile(config.reviewedFile, "{ invalid json }");
    const result = await readReviewedPaths(config);
    expect(result).toEqual({});
  });

  test("returns empty object for empty file", async () => {
    await writeFile(config.reviewedFile, "");
    const result = await readReviewedPaths(config);
    expect(result).toEqual({});
  });
});

// --- writeReviewedPaths tests ---

describe("writeReviewedPaths", () => {
  let tmpDir: string;
  let config: Config;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-reviewed-write-"));
    await mkdir(`${tmpDir}/.dotfiles`, { recursive: true });
    config = createTestConfig(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("writes JSON with proper formatting", async () => {
    const data = { "/path/to/file": "2024-01-01" };
    await writeReviewedPaths(config, data);

    const content = await readFile(config.reviewedFile, "utf-8");
    // Should have 2-space indent and trailing newline
    expect(content).toBe(JSON.stringify(data, null, 2) + "\n");
  });

  test("creates file if it doesn't exist (parent dir exists)", async () => {
    const data = { "/new/path": "2024-06-15" };
    await writeReviewedPaths(config, data);

    const result = await readReviewedPaths(config);
    expect(result).toEqual(data);
  });

  test("overwrites existing file", async () => {
    const oldData = { "/old": "2023-01-01" };
    const newData = { "/new": "2024-06-15" };

    await writeReviewedPaths(config, oldData);
    await writeReviewedPaths(config, newData);

    const result = await readReviewedPaths(config);
    expect(result).toEqual(newData);
  });

  test("creates parent directory if missing", async () => {
    // Use a config where .dotfiles doesn't exist yet
    const freshTmpDir = await mkdtemp(join(tmpdir(), "dot-reviewed-mkdir-"));
    const freshConfig = createTestConfig(freshTmpDir);

    const data = { "/path": "2024-01-01" };
    await writeReviewedPaths(freshConfig, data);

    const result = await readReviewedPaths(freshConfig);
    expect(result).toEqual(data);

    await rm(freshTmpDir, { recursive: true });
  });
});

// --- getRepoFiles tests ---

describe("getRepoFiles", () => {
  let tmpDir: string;
  let config: Config;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-repo-"));
    await mkdir(`${tmpDir}/.dotfiles`, { recursive: true });
    config = createTestConfig(tmpDir);
    await initGitRepo(`${tmpDir}/.dotfiles`);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("returns empty array for empty repo", async () => {
    const result = await getRepoFiles(config);
    expect(result).toEqual([]);
  });

  test("returns tracked files", async () => {
    await writeFile(`${tmpDir}/.dotfiles/file.txt`, "content");
    await $`git -C ${config.dotfiles} add file.txt`.quiet();
    await $`git -C ${config.dotfiles} commit -m "Add file"`.quiet();

    const result = await getRepoFiles(config);
    expect(result).toEqual(["file.txt"]);
  });

  test("includes staged but uncommitted files", async () => {
    await writeFile(`${tmpDir}/.dotfiles/staged.txt`, "content");
    await $`git -C ${config.dotfiles} add staged.txt`.quiet();
    // Don't commit

    const result = await getRepoFiles(config);
    expect([...result].sort()).toEqual(["staged.txt"]);
  });

  test("excludes untracked files", async () => {
    await writeFile(`${tmpDir}/.dotfiles/untracked.txt`, "content");
    // Don't add or commit

    const result = await getRepoFiles(config);
    expect(result).toEqual([]);  // Empty, no sort needed
  });
});

// --- getGitStatus tests ---

describe("getGitStatus", () => {
  let tmpDir: string;
  let config: Config;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-gitstatus-"));
    await mkdir(`${tmpDir}/.dotfiles`, { recursive: true });
    config = createTestConfig(tmpDir);
    await initGitRepo(`${tmpDir}/.dotfiles`);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("returns branch name main", async () => {
    const result = await getGitStatus(config);
    expect(result.branch).toBe("main");
  });

  test("returns empty status for clean repo", async () => {
    // Need at least one commit for a clean repo
    await writeFile(`${tmpDir}/.dotfiles/init.txt`, "init");
    await $`git -C ${config.dotfiles} add init.txt`.quiet();
    await $`git -C ${config.dotfiles} commit -m "Initial"`.quiet();

    const result = await getGitStatus(config);
    expect(result.status).toBe("");
  });

  test("reports modified files", async () => {
    await writeFile(`${tmpDir}/.dotfiles/file.txt`, "original");
    await $`git -C ${config.dotfiles} add file.txt`.quiet();
    await $`git -C ${config.dotfiles} commit -m "Add file"`.quiet();

    await writeFile(`${tmpDir}/.dotfiles/file.txt`, "modified");

    const result = await getGitStatus(config);
    // Match trimmed format (no leading whitespace after trim())
    expect(result.status).toMatch(/^M\s+file\.txt$/m);
  });

  test("reports untracked files", async () => {
    await writeFile(`${tmpDir}/.dotfiles/untracked.txt`, "content");

    const result = await getGitStatus(config);
    // Match trimmed format
    expect(result.status).toMatch(/^\?\?\s+untracked\.txt$/m);
  });
});

// --- markAsReviewed tests ---

describe("markAsReviewed", () => {
  let tmpDir: string;
  let config: Config;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-mark-reviewed-"));
    await mkdir(`${tmpDir}/.dotfiles`, { recursive: true });
    config = createTestConfig(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("adds path with specified date", async () => {
    // Use normalizePath to match what review() does
    const path = normalizePath(config.home, "~/.config/some-app");
    const fixedDate = "2024-06-15";
    await markAsReviewed(config, path, fixedDate);

    const reviewed = await readReviewedPaths(config);
    expect(reviewed[path]).toBe(fixedDate);
  });

  test("updates existing path's date", async () => {
    const path = normalizePath(config.home, "~/.config/some-app");
    const newDate = "2024-06-15";
    await writeReviewedPaths(config, { [path]: "2020-01-01" });

    await markAsReviewed(config, path, newDate);

    const reviewed = await readReviewedPaths(config);
    expect(reviewed[path]).toBe(newDate);
  });

  test("preserves other reviewed paths", async () => {
    const otherPath = normalizePath(config.home, "~/.config/other-app");
    const newPath = normalizePath(config.home, "~/.config/new-app");
    await writeReviewedPaths(config, { [otherPath]: "2024-01-01" });

    await markAsReviewed(config, newPath, "2024-06-15");

    const reviewed = await readReviewedPaths(config);
    expect(reviewed[otherPath]).toBe("2024-01-01");  // Unchanged
    expect(reviewed[newPath]).toBe("2024-06-15");    // Added
  });
});
