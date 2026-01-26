import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createConfig,
  initDotfiles,
  type Config,
  type InitOptions,
  type InitResult,
} from "../index";

describe("initDotfiles", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-init-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("creates dotfiles directory structure", async () => {
    const result = await initDotfiles({
      home: tmpDir,
      interactive: false,
    });

    expect(result.success).toBe(true);
    expect(result.dotfilesPath).toBe(`${tmpDir}/.dotfiles`);

    // Check directory exists
    const stats = await stat(`${tmpDir}/.dotfiles`);
    expect(stats.isDirectory()).toBe(true);
  });

  test("creates required subdirectories", async () => {
    await initDotfiles({
      home: tmpDir,
      interactive: false,
    });

    // Check expected directories
    const dirs = ["zsh", "git", "homebrew"];
    for (const dir of dirs) {
      const stats = await stat(`${tmpDir}/.dotfiles/${dir}`);
      expect(stats.isDirectory()).toBe(true);
    }
  });

  test("creates starter files", async () => {
    await initDotfiles({
      home: tmpDir,
      interactive: false,
    });

    // Check zshenv exists
    const zshenv = await readFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "utf-8");
    expect(zshenv).toContain("ZDOTDIR");

    // Check gitconfig exists
    const gitconfig = await readFile(`${tmpDir}/.dotfiles/git/.gitconfig`, "utf-8");
    expect(gitconfig.length).toBeGreaterThan(0);
  });

  test("initializes git repository", async () => {
    await initDotfiles({
      home: tmpDir,
      interactive: false,
    });

    // Check .git exists
    const stats = await stat(`${tmpDir}/.dotfiles/.git`);
    expect(stats.isDirectory()).toBe(true);
  });

  test("does not overwrite existing dotfiles directory", async () => {
    // Create existing dotfiles
    await mkdir(`${tmpDir}/.dotfiles`, { recursive: true });
    await writeFile(`${tmpDir}/.dotfiles/existing.txt`, "do not delete");

    const result = await initDotfiles({
      home: tmpDir,
      interactive: false,
    });

    // Should fail or warn, not overwrite
    expect(result.success).toBe(false);
    expect(result.error).toContain("exists");

    // Original file should still be there
    const content = await readFile(`${tmpDir}/.dotfiles/existing.txt`, "utf-8");
    expect(content).toBe("do not delete");
  });

  test("force flag allows reinitializing", async () => {
    // Create existing dotfiles
    await mkdir(`${tmpDir}/.dotfiles/zsh`, { recursive: true });
    await writeFile(`${tmpDir}/.dotfiles/existing.txt`, "will be kept");

    const result = await initDotfiles({
      home: tmpDir,
      interactive: false,
      force: true,
    });

    expect(result.success).toBe(true);

    // Original file should still be there (force doesn't delete)
    const content = await readFile(`${tmpDir}/.dotfiles/existing.txt`, "utf-8");
    expect(content).toBe("will be kept");

    // New files should be created
    const zshenv = await readFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "utf-8");
    expect(zshenv).toContain("ZDOTDIR");
  });

  test("returns list of created files", async () => {
    const result = await initDotfiles({
      home: tmpDir,
      interactive: false,
    });

    expect(result.filesCreated).toBeDefined();
    expect(result.filesCreated!.length).toBeGreaterThan(0);
    expect(result.filesCreated).toContain(`${tmpDir}/.dotfiles/zsh/zshenv`);
  });

  test("respects modules option", async () => {
    const result = await initDotfiles({
      home: tmpDir,
      interactive: false,
      modules: ["zsh"], // Only zsh, no git
    });

    expect(result.success).toBe(true);

    // zsh should exist
    const zshStats = await stat(`${tmpDir}/.dotfiles/zsh`);
    expect(zshStats.isDirectory()).toBe(true);

    // git should not be created if not in modules
    try {
      await stat(`${tmpDir}/.dotfiles/git`);
      // If we get here, directory exists - check if it has our files
      try {
        await stat(`${tmpDir}/.dotfiles/git/.gitconfig`);
        throw new Error("git/.gitconfig should not exist");
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
      }
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
      // Directory doesn't exist, which is fine
    }
  });
});

describe("init command templates", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-init-tpl-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("zshenv template sets ZDOTDIR correctly", async () => {
    await initDotfiles({
      home: tmpDir,
      interactive: false,
    });

    const zshenv = await readFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "utf-8");
    expect(zshenv).toContain('ZDOTDIR="$HOME/.config/zsh"');
    expect(zshenv).toContain("export ZDOTDIR");
  });

  test("gitconfig template has basic structure", async () => {
    await initDotfiles({
      home: tmpDir,
      interactive: false,
    });

    const gitconfig = await readFile(`${tmpDir}/.dotfiles/git/.gitconfig`, "utf-8");
    expect(gitconfig).toContain("[user]");
    expect(gitconfig).toContain("[core]");
  });

  test("brewfile template is valid", async () => {
    await initDotfiles({
      home: tmpDir,
      interactive: false,
    });

    const brewfile = await readFile(`${tmpDir}/.dotfiles/homebrew/brewfile`, "utf-8");
    expect(brewfile).toContain('tap "homebrew/bundle"');
  });
});
