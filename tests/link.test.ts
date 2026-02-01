import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, lstat, readlink, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { link, parseLinkArgs } from "../src/link";
import { loadConfig } from "../src/config";
import type { DotConfig } from "../src/types";
import { $ } from "bun";

describe("parseLinkArgs", () => {
  it("parses target path", () => {
    const { targetPath, options } = parseLinkArgs(["~/.testrc"]);
    expect(targetPath).toBe("~/.testrc");
    expect(options.as).toBeUndefined();
    expect(options.force).toBeUndefined();
  });

  it("parses --as option", () => {
    const { targetPath, options } = parseLinkArgs(["~/.testrc", "--as", "zsh/testrc"]);
    expect(targetPath).toBe("~/.testrc");
    expect(options.as).toBe("zsh/testrc");
  });

  it("parses --force option", () => {
    const { targetPath, options } = parseLinkArgs(["~/.testrc", "--force"]);
    expect(targetPath).toBe("~/.testrc");
    expect(options.force).toBe(true);
  });

  it("parses -f short flag", () => {
    const { targetPath, options } = parseLinkArgs(["-f", "~/.testrc"]);
    expect(targetPath).toBe("~/.testrc");
    expect(options.force).toBe(true);
  });

  it("parses all options together", () => {
    const { targetPath, options } = parseLinkArgs(["--as", "test/file", "-f", "~/.myrc"]);
    expect(targetPath).toBe("~/.myrc");
    expect(options.as).toBe("test/file");
    expect(options.force).toBe(true);
  });
});

describe("link command", () => {
  let tempDir: string;
  let dotfilesPath: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "dot-link-"));
    dotfilesPath = join(tempDir, "dotfiles");
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;

    // Create dotfiles directory with git
    await mkdir(dotfilesPath, { recursive: true });
    await mkdir(join(dotfilesPath, "zsh"), { recursive: true });
    await $`git -C ${dotfilesPath} init`.quiet();
    await $`git -C ${dotfilesPath} config user.email "test@test.com"`.quiet();
    await $`git -C ${dotfilesPath} config user.name "Test"`.quiet();
  });

  afterEach(async () => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it("tracks file with --as option", async () => {
    // Create a test file
    const testFile = join(tempDir, ".testrc");
    await writeFile(testFile, "test content");

    const config: DotConfig = { links: {}, autoCommit: false };

    await link(testFile, dotfilesPath, config, { as: "zsh/testrc", force: true });

    // File should be moved to dotfiles
    const destPath = join(dotfilesPath, "zsh/testrc");
    const destContent = await readFile(destPath, "utf8");
    expect(destContent).toBe("test content");

    // Original should be a symlink
    const stat = await lstat(testFile);
    expect(stat.isSymbolicLink()).toBe(true);

    // Symlink should point to dotfiles
    const linkTarget = await readlink(testFile);
    expect(linkTarget).toBe(destPath);

    // Config should be updated
    const updatedConfig = await loadConfig(dotfilesPath);
    expect(updatedConfig!.links["zsh/testrc"]).toBe("~/.testrc");
  });

  it("creates symlink from tilde path in config", async () => {
    const testFile = join(tempDir, ".configrc");
    await writeFile(testFile, "config");

    const config: DotConfig = { links: {}, autoCommit: false };

    await link(testFile, dotfilesPath, config, { as: "test/configrc", force: true });

    const updatedConfig = await loadConfig(dotfilesPath);
    // Should use ~/ format for home directory paths
    expect(updatedConfig!.links["test/configrc"]).toBe("~/.configrc");
  });

  it("auto-commits when autoCommit is true", async () => {
    const testFile = join(tempDir, ".autorc");
    await writeFile(testFile, "auto");

    const config: DotConfig = { links: {}, autoCommit: true };

    await link(testFile, dotfilesPath, config, { as: "misc/autorc", force: true });

    // Check git log for commit
    const log = await $`git -C ${dotfilesPath} log --oneline -1`.text();
    expect(log).toContain("Add .autorc");
  });

  it("does not auto-commit when autoCommit is false", async () => {
    const testFile = join(tempDir, ".nocommitrc");
    await writeFile(testFile, "nocommit");

    const config: DotConfig = { links: {}, autoCommit: false };

    await link(testFile, dotfilesPath, config, { as: "misc/nocommitrc", force: true });

    // Git should have uncommitted changes
    const status = await $`git -C ${dotfilesPath} status --porcelain`.text();
    expect(status.trim().length).toBeGreaterThan(0);
  });

  it("backs up existing file with --force", async () => {
    // Create file in dotfiles at destination
    const existingPath = join(dotfilesPath, "zsh/existing");
    await writeFile(existingPath, "old content");

    // Create file to track
    const testFile = join(tempDir, ".existing");
    await writeFile(testFile, "new content");

    const config: DotConfig = { links: {}, autoCommit: false };

    await link(testFile, dotfilesPath, config, { as: "zsh/existing", force: true });

    // Backup should exist
    const backupContent = await readFile(`${existingPath}.bak`, "utf8");
    expect(backupContent).toBe("old content");

    // New content should be in place
    const newContent = await readFile(existingPath, "utf8");
    expect(newContent).toBe("new content");
  });

  it("handles nested destination path", async () => {
    const testFile = join(tempDir, ".deeprc");
    await writeFile(testFile, "deep");

    const config: DotConfig = { links: {}, autoCommit: false };

    await link(testFile, dotfilesPath, config, { as: "config/apps/deeprc", force: true });

    // Nested directory should be created
    const destPath = join(dotfilesPath, "config/apps/deeprc");
    const content = await readFile(destPath, "utf8");
    expect(content).toBe("deep");
  });
});
