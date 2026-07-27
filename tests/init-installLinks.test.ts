import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, symlink, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { __test as initTest } from "../src/init";

describe("init.installLinks", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-init-links-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("creates symlinks using dotfilesPath-resolved absolute sources (cwd-independent)", async () => {
    const dotfilesPath = resolve(tmpDir, ".dotfiles");
    await mkdir(resolve(dotfilesPath, "zsh"), { recursive: true });
    await writeFile(resolve(dotfilesPath, "zsh/zshenv"), "# zshenv");

    await initTest.installLinks(
      {
        "zsh/zshenv": resolve(tmpDir, ".zshenv"),
      },
      dotfilesPath,
    );

    const linkPath = resolve(tmpDir, ".zshenv");
    const raw = await readlink(linkPath);
    expect(raw).toBe(resolve(dotfilesPath, "zsh/zshenv"));
  });

  test("replaces wrong-target symlinks", async () => {
    const dotfilesPath = resolve(tmpDir, ".dotfiles");
    await mkdir(resolve(dotfilesPath, "zsh"), { recursive: true });
    await writeFile(resolve(dotfilesPath, "zsh/zshrc"), "# zshrc");

    const wrongTarget = resolve(tmpDir, "wrong");
    await writeFile(wrongTarget, "wrong");
    await symlink(wrongTarget, resolve(tmpDir, ".zshrc"));

    await initTest.installLinks(
      {
        "zsh/zshrc": resolve(tmpDir, ".zshrc"),
      },
      dotfilesPath,
    );

    const raw = await readlink(resolve(tmpDir, ".zshrc"));
    expect(raw).toBe(resolve(dotfilesPath, "zsh/zshrc"));
  });
});
