import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  stat,
  lstat,
  readlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createConfig,
  addFile,
  type Config,
  type AddResult,
} from "../index";

describe("addFile", () => {
  let tmpDir: string;
  let config: Config;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-add-test-"));

    // Create dotfiles directory structure
    await mkdir(`${tmpDir}/.dotfiles/zsh`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/git`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/.git`, { recursive: true });

    // Create existing source files
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "# zshenv");
    await writeFile(`${tmpDir}/.dotfiles/git/.gitconfig`, "# gitconfig");

    config = createConfig(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("moves file to dotfiles and creates symlink", async () => {
    // Create a file to add
    const originalContent = "my custom config";
    await writeFile(`${tmpDir}/.myconfig`, originalContent);

    const result = await addFile(config, `${tmpDir}/.myconfig`, "misc");

    expect(result.success).toBe(true);

    // Original location should now be a symlink
    const linkStat = await lstat(`${tmpDir}/.myconfig`);
    expect(linkStat.isSymbolicLink()).toBe(true);

    // Symlink should point to dotfiles
    const target = await readlink(`${tmpDir}/.myconfig`);
    expect(target).toContain(".dotfiles");

    // File content should be preserved
    const content = await readFile(`${tmpDir}/.myconfig`, "utf-8");
    expect(content).toBe(originalContent);
  });

  test("creates destination directory if needed", async () => {
    await writeFile(`${tmpDir}/.newconfig`, "new content");

    const result = await addFile(config, `${tmpDir}/.newconfig`, "newmodule");

    expect(result.success).toBe(true);

    // Directory should exist
    const dirStat = await stat(`${tmpDir}/.dotfiles/newmodule`);
    expect(dirStat.isDirectory()).toBe(true);

    // File should be there
    const fileStat = await stat(`${tmpDir}/.dotfiles/newmodule/.newconfig`);
    expect(fileStat.isFile()).toBe(true);
  });

  test("preserves file permissions", async () => {
    await writeFile(`${tmpDir}/.myscript`, "#!/bin/bash\necho hi");
    // Make executable
    const { chmod } = await import("node:fs/promises");
    await chmod(`${tmpDir}/.myscript`, 0o755);

    await addFile(config, `${tmpDir}/.myscript`, "scripts");

    // Check permissions preserved
    const fileStat = await stat(`${tmpDir}/.dotfiles/scripts/.myscript`);
    // Check executable bit
    expect(fileStat.mode & 0o111).toBeGreaterThan(0);
  });

  test("fails if file doesn't exist", async () => {
    const result = await addFile(config, `${tmpDir}/.nonexistent`, "misc");

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  test("fails if dotfiles directory doesn't exist", async () => {
    await rm(`${tmpDir}/.dotfiles`, { recursive: true });

    await writeFile(`${tmpDir}/.myconfig`, "content");
    const result = await addFile(config, `${tmpDir}/.myconfig`, "misc");

    expect(result.success).toBe(false);
    expect(result.error).toContain("dotfiles");
  });

  test("fails if file is already a symlink", async () => {
    // Create a symlink
    const { symlink } = await import("node:fs/promises");
    await writeFile(`${tmpDir}/target`, "target content");
    await symlink(`${tmpDir}/target`, `${tmpDir}/.mylink`);

    const result = await addFile(config, `${tmpDir}/.mylink`, "misc");

    expect(result.success).toBe(false);
    expect(result.error).toContain("symlink");
  });

  test("does not overwrite existing file in dotfiles", async () => {
    // Create file in dotfiles first
    await mkdir(`${tmpDir}/.dotfiles/misc`, { recursive: true });
    await writeFile(`${tmpDir}/.dotfiles/misc/.myconfig`, "original");

    // Try to add a file with same name
    await writeFile(`${tmpDir}/.myconfig`, "new content");
    const result = await addFile(config, `${tmpDir}/.myconfig`, "misc");

    expect(result.success).toBe(false);
    expect(result.error).toContain("exists");

    // Original file should be unchanged
    const content = await readFile(`${tmpDir}/.dotfiles/misc/.myconfig`, "utf-8");
    expect(content).toBe("original");
  });

  test("force flag allows overwriting", async () => {
    await mkdir(`${tmpDir}/.dotfiles/misc`, { recursive: true });
    await writeFile(`${tmpDir}/.dotfiles/misc/.myconfig`, "original");

    await writeFile(`${tmpDir}/.myconfig`, "new content");
    const result = await addFile(config, `${tmpDir}/.myconfig`, "misc", { force: true });

    expect(result.success).toBe(true);

    // Content should be updated
    const content = await readFile(`${tmpDir}/.dotfiles/misc/.myconfig`, "utf-8");
    expect(content).toBe("new content");
  });

  test("returns destination path on success", async () => {
    await writeFile(`${tmpDir}/.myconfig`, "content");

    const result = await addFile(config, `${tmpDir}/.myconfig`, "misc");

    expect(result.success).toBe(true);
    expect(result.destPath).toBe(`${tmpDir}/.dotfiles/misc/.myconfig`);
  });

  test("handles files with spaces in name", async () => {
    await writeFile(`${tmpDir}/.my config file`, "content");

    const result = await addFile(config, `${tmpDir}/.my config file`, "misc");

    expect(result.success).toBe(true);
    expect(await readFile(`${tmpDir}/.my config file`, "utf-8")).toBe("content");
  });

  test("can add directories recursively", async () => {
    // Create a directory with files
    await mkdir(`${tmpDir}/.myapp`, { recursive: true });
    await writeFile(`${tmpDir}/.myapp/config.json`, '{"key": "value"}');
    await writeFile(`${tmpDir}/.myapp/settings.txt`, "setting=1");

    const result = await addFile(config, `${tmpDir}/.myapp`, "apps");

    expect(result.success).toBe(true);

    // Directory should be moved
    const dirStat = await stat(`${tmpDir}/.dotfiles/apps/.myapp`);
    expect(dirStat.isDirectory()).toBe(true);

    // Files should be there
    const content = await readFile(`${tmpDir}/.dotfiles/apps/.myapp/config.json`, "utf-8");
    expect(content).toBe('{"key": "value"}');

    // Original should be symlink
    const linkStat = await lstat(`${tmpDir}/.myapp`);
    expect(linkStat.isSymbolicLink()).toBe(true);
  });
});
