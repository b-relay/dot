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
  type ReviewedEntry,
  type ReviewedPaths,
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
  await $`git -C ${path} config commit.gpgsign false`.quiet();
}

// --- readReviewedPaths tests ---

describe("readReviewedPaths", () => {
  let tmpDir: string;
  let reviewedFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-reviewed-read-"));
    reviewedFilePath = join(tmpDir, "reviewed.json");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("returns empty object when file doesn't exist", async () => {
    // Remove the file if it exists
    try {
      await rm(reviewedFilePath);
    } catch {
      // Doesn't exist, that's fine
    }
    const result = await readReviewedPaths(reviewedFilePath);
    expect(result).toEqual({});
  });

  test("parses valid JSON with new schema", async () => {
    const data: ReviewedPaths = {
      "/path/to/file": { type: 'timed', expiresAt: '2024-06-20' },
      "/another/path": { type: 'forever' },
    };
    await writeFile(reviewedFilePath, JSON.stringify(data));
    const result = await readReviewedPaths(reviewedFilePath);
    expect(result).toEqual(data);
  });

  test("returns empty object for corrupted JSON", async () => {
    await writeFile(reviewedFilePath, "{ invalid json }");
    const result = await readReviewedPaths(reviewedFilePath);
    expect(result).toEqual({});
  });

  test("returns empty object for empty file", async () => {
    await writeFile(reviewedFilePath, "");
    const result = await readReviewedPaths(reviewedFilePath);
    expect(result).toEqual({});
  });
});

// --- writeReviewedPaths tests ---

describe("writeReviewedPaths", () => {
  let tmpDir: string;
  let reviewedFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-reviewed-write-"));
    reviewedFilePath = join(tmpDir, "reviewed.json");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("writes JSON with proper formatting", async () => {
    const data: ReviewedPaths = {
      "/path/to/file": { type: 'timed', expiresAt: '2024-06-20' },
    };
    await writeReviewedPaths(data, reviewedFilePath);

    const content = await readFile(reviewedFilePath, "utf-8");
    // Should have 2-space indent and trailing newline
    expect(content).toBe(JSON.stringify(data, null, 2) + "\n");
  });

  test("creates file if it doesn't exist", async () => {
    // Remove the file first
    try {
      await rm(reviewedFilePath);
    } catch {
      // Doesn't exist, that's fine
    }

    const data: ReviewedPaths = {
      "/new/path": { type: 'forever' },
    };
    await writeReviewedPaths(data, reviewedFilePath);

    const result = await readReviewedPaths(reviewedFilePath);
    expect(result).toEqual(data);
  });

  test("overwrites existing file", async () => {
    const oldData: ReviewedPaths = {
      "/old": { type: 'timed', expiresAt: '2023-01-01' },
    };
    const newData: ReviewedPaths = {
      "/new": { type: 'forever' },
    };

    await writeReviewedPaths(oldData, reviewedFilePath);
    await writeReviewedPaths(newData, reviewedFilePath);

    const result = await readReviewedPaths(reviewedFilePath);
    expect(result).toEqual(newData);
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
  let reviewedFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-reviewed-mark-"));
    reviewedFilePath = join(tmpDir, "reviewed.json");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("adds path with timed entry", async () => {
    const path = "/test/path/some-app";
    const entry: ReviewedEntry = { type: 'timed', expiresAt: '2024-06-20' };
    await markAsReviewed(path, entry, reviewedFilePath);

    const reviewed = await readReviewedPaths(reviewedFilePath);
    expect(reviewed[path]).toEqual(entry);
  });

  test("adds path with forever entry", async () => {
    const path = "/test/path/permanent-app";
    const entry: ReviewedEntry = { type: 'forever' };
    await markAsReviewed(path, entry, reviewedFilePath);

    const reviewed = await readReviewedPaths(reviewedFilePath);
    expect(reviewed[path]).toEqual(entry);
  });

  test("updates existing path's entry", async () => {
    const path = "/test/path/some-app";
    const oldEntry: ReviewedEntry = { type: 'timed', expiresAt: '2020-01-01' };
    const newEntry: ReviewedEntry = { type: 'forever' };

    await writeReviewedPaths({ [path]: oldEntry }, reviewedFilePath);
    await markAsReviewed(path, newEntry, reviewedFilePath);

    const reviewed = await readReviewedPaths(reviewedFilePath);
    expect(reviewed[path]).toEqual(newEntry);
  });

  test("preserves other reviewed paths", async () => {
    const otherPath = "/test/path/other-app";
    const newPath = "/test/path/new-app";
    const otherEntry: ReviewedEntry = { type: 'timed', expiresAt: '2024-01-01' };
    const newEntry: ReviewedEntry = { type: 'forever' };

    await writeReviewedPaths({ [otherPath]: otherEntry }, reviewedFilePath);
    await markAsReviewed(newPath, newEntry, reviewedFilePath);

    const reviewed = await readReviewedPaths(reviewedFilePath);
    expect(reviewed[otherPath]).toEqual(otherEntry);  // Unchanged
    expect(reviewed[newPath]).toEqual(newEntry);      // Added
  });
});
