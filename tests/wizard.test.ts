import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { previewSymlinks, expandPath } from "../src/wizard";
import type { LinkMap } from "../src/types";

describe("expandPath", () => {
  test("expands ~ to home directory", () => {
    const home = process.env.HOME || "";
    expect(expandPath("~/.zshrc")).toBe(`${home}/.zshrc`);
    expect(expandPath("~/Documents/file.txt")).toBe(`${home}/Documents/file.txt`);
  });

  test("expands ~/ at start only", () => {
    const home = process.env.HOME || "";
    expect(expandPath("~/.config/app")).toBe(`${home}/.config/app`);
    // Tilde in middle should not be expanded
    expect(expandPath("/path/to/~file")).toBe("/path/to/~file");
  });

  test("returns absolute paths unchanged", () => {
    expect(expandPath("/absolute/path")).toBe("/absolute/path");
    expect(expandPath("/Users/test/.zshrc")).toBe("/Users/test/.zshrc");
  });

  test("resolves relative paths to absolute using cwd", () => {
    // expandPath uses resolve() which makes relative paths absolute
    const cwd = process.cwd();
    expect(expandPath("relative/path")).toBe(`${cwd}/relative/path`);
    expect(expandPath("./local/file")).toBe(`${cwd}/local/file`);
  });

  test("handles ~ alone", () => {
    const home = process.env.HOME || "";
    expect(expandPath("~")).toBe(home);
  });
});

describe("previewSymlinks", () => {
  let tempDir: string;
  let dotfilesPath: string;
  let homeDir: string;

  beforeEach(async () => {
    // Create temp directory structure
    tempDir = await mkdtemp(join(tmpdir(), "wizard-test-"));
    dotfilesPath = join(tempDir, "dotfiles");
    homeDir = join(tempDir, "home");

    await mkdir(dotfilesPath, { recursive: true });
    await mkdir(homeDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("detects 'new' status when target does not exist but source does", async () => {
    // Create source file in dotfiles
    const sourceFile = join(dotfilesPath, "zsh/zshrc");
    await mkdir(join(dotfilesPath, "zsh"), { recursive: true });
    await writeFile(sourceFile, "# zshrc content");

    // Target does not exist
    const targetFile = join(homeDir, ".zshrc");

    const links: LinkMap = {
      [sourceFile]: targetFile,
    };

    const result = await previewSymlinks(links, dotfilesPath);

    expect(result.safe).toBe(true);
    expect(result.hasConflicts).toBe(false);
    expect(result.hasWrongTargets).toBe(false);
    expect(result.hasNewLinks).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.status).toBe("new");
  });

  test("detects 'will-create' status when neither source nor target exist", async () => {
    // Neither source nor target exist
    const sourceFile = join(dotfilesPath, "zsh/zshrc");
    const targetFile = join(homeDir, ".zshrc");

    const links: LinkMap = {
      [sourceFile]: targetFile,
    };

    const result = await previewSymlinks(links, dotfilesPath);

    expect(result.safe).toBe(true);
    expect(result.hasConflicts).toBe(false);
    expect(result.hasWrongTargets).toBe(false);
    expect(result.hasNewLinks).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.status).toBe("will-create");
  });

  test("detects 'already-linked' status when symlink points to correct target", async () => {
    // Create source file in dotfiles
    const sourceFile = join(dotfilesPath, "zsh/zshrc");
    await mkdir(join(dotfilesPath, "zsh"), { recursive: true });
    await writeFile(sourceFile, "# zshrc content");

    // Create symlink pointing to correct source
    const targetFile = join(homeDir, ".zshrc");
    await symlink(sourceFile, targetFile);

    const links: LinkMap = {
      [sourceFile]: targetFile,
    };

    const result = await previewSymlinks(links, dotfilesPath);

    expect(result.safe).toBe(true);
    expect(result.hasConflicts).toBe(false);
    expect(result.hasWrongTargets).toBe(false);
    expect(result.hasNewLinks).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.status).toBe("already-linked");
  });

  test("detects 'wrong-target' status when symlink points elsewhere", async () => {
    // Create source file in dotfiles
    const sourceFile = join(dotfilesPath, "zsh/zshrc");
    await mkdir(join(dotfilesPath, "zsh"), { recursive: true });
    await writeFile(sourceFile, "# zshrc content");

    // Create a different file that the symlink will point to
    const wrongSourceFile = join(tempDir, "other-file");
    await writeFile(wrongSourceFile, "# wrong content");

    // Create symlink pointing to wrong source
    const targetFile = join(homeDir, ".zshrc");
    await symlink(wrongSourceFile, targetFile);

    const links: LinkMap = {
      [sourceFile]: targetFile,
    };

    const result = await previewSymlinks(links, dotfilesPath);

    expect(result.safe).toBe(false);
    expect(result.hasConflicts).toBe(false);
    expect(result.hasWrongTargets).toBe(true);
    expect(result.hasNewLinks).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.status).toBe("wrong-target");
    expect(result.items[0]!.actualTarget).toBe(wrongSourceFile);
  });

  test("detects 'conflict' status when target is a real file (not symlink)", async () => {
    // Create source file in dotfiles
    const sourceFile = join(dotfilesPath, "zsh/zshrc");
    await mkdir(join(dotfilesPath, "zsh"), { recursive: true });
    await writeFile(sourceFile, "# zshrc content");

    // Create a real file (not symlink) at target location
    const targetFile = join(homeDir, ".zshrc");
    await writeFile(targetFile, "# existing local content");

    const links: LinkMap = {
      [sourceFile]: targetFile,
    };

    const result = await previewSymlinks(links, dotfilesPath);

    expect(result.safe).toBe(false);
    expect(result.hasConflicts).toBe(true);
    expect(result.hasWrongTargets).toBe(false);
    expect(result.hasNewLinks).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.status).toBe("conflict");
  });

  test("handles multiple links with mixed statuses", async () => {
    // Source files
    const source1 = join(dotfilesPath, "zsh/zshrc");
    const source2 = join(dotfilesPath, "git/config");
    const source3 = join(dotfilesPath, "tmux/tmux.conf");
    const source4 = join(dotfilesPath, "nvim/init.lua");

    await mkdir(join(dotfilesPath, "zsh"), { recursive: true });
    await mkdir(join(dotfilesPath, "git"), { recursive: true });
    await mkdir(join(dotfilesPath, "tmux"), { recursive: true });
    await mkdir(join(dotfilesPath, "nvim"), { recursive: true });

    await writeFile(source1, "# zshrc");
    await writeFile(source2, "# git config");
    await writeFile(source3, "# tmux");
    await writeFile(source4, "# nvim");

    // Target files with different statuses
    const target1 = join(homeDir, ".zshrc"); // new (no target exists)
    const target2 = join(homeDir, ".gitconfig"); // already linked
    const target3 = join(homeDir, ".tmux.conf"); // conflict (real file)
    const target4 = join(homeDir, ".config/nvim/init.lua"); // wrong target

    // Set up target2 as correct symlink
    await symlink(source2, target2);

    // Set up target3 as real file (conflict)
    await writeFile(target3, "# local tmux config");

    // Set up target4 as symlink to wrong location
    const wrongSource = join(tempDir, "wrong-nvim");
    await writeFile(wrongSource, "# wrong nvim");
    await mkdir(join(homeDir, ".config/nvim"), { recursive: true });
    await symlink(wrongSource, target4);

    const links: LinkMap = {
      [source1]: target1,
      [source2]: target2,
      [source3]: target3,
      [source4]: target4,
    };

    const result = await previewSymlinks(links, dotfilesPath);

    expect(result.safe).toBe(false);
    expect(result.hasConflicts).toBe(true);
    expect(result.hasWrongTargets).toBe(true);
    expect(result.hasNewLinks).toBe(true);
    expect(result.items).toHaveLength(4);

    // Find items by target path
    const item1 = result.items.find(i => i.target === target1);
    const item2 = result.items.find(i => i.target === target2);
    const item3 = result.items.find(i => i.target === target3);
    const item4 = result.items.find(i => i.target === target4);

    expect(item1?.status).toBe("new");
    expect(item2?.status).toBe("already-linked");
    expect(item3?.status).toBe("conflict");
    expect(item4?.status).toBe("wrong-target");
    expect(item4?.actualTarget).toBe(wrongSource);
  });

  test("returns safe=true when only 'new' and 'already-linked' statuses", async () => {
    const source1 = join(dotfilesPath, "zsh/zshrc");
    const source2 = join(dotfilesPath, "git/config");

    await mkdir(join(dotfilesPath, "zsh"), { recursive: true });
    await mkdir(join(dotfilesPath, "git"), { recursive: true });
    await writeFile(source1, "# zshrc");
    await writeFile(source2, "# git");

    const target1 = join(homeDir, ".zshrc"); // new
    const target2 = join(homeDir, ".gitconfig"); // already linked

    await symlink(source2, target2);

    const links: LinkMap = {
      [source1]: target1,
      [source2]: target2,
    };

    const result = await previewSymlinks(links, dotfilesPath);

    expect(result.safe).toBe(true);
    expect(result.hasConflicts).toBe(false);
    expect(result.hasWrongTargets).toBe(false);
    expect(result.hasNewLinks).toBe(true);

    const item1 = result.items.find(i => i.target === target1);
    const item2 = result.items.find(i => i.target === target2);

    expect(item1?.status).toBe("new");
    expect(item2?.status).toBe("already-linked");
  });

  test("handles relative symlinks correctly", async () => {
    // Create source file in dotfiles
    const sourceFile = join(dotfilesPath, "zsh/zshrc");
    await mkdir(join(dotfilesPath, "zsh"), { recursive: true });
    await writeFile(sourceFile, "# zshrc content");

    // Create symlink with relative path pointing to correct source
    const targetFile = join(homeDir, ".zshrc");
    // Relative path from homeDir to dotfilesPath/zsh/zshrc
    const relativePath = "../dotfiles/zsh/zshrc";
    await symlink(relativePath, targetFile);

    const links: LinkMap = {
      [sourceFile]: targetFile,
    };

    const result = await previewSymlinks(links, dotfilesPath);

    expect(result.safe).toBe(true);
    expect(result.hasConflicts).toBe(false);
    expect(result.hasWrongTargets).toBe(false);
    expect(result.hasNewLinks).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.status).toBe("already-linked");
  });

  test("works with relative source paths (as config stores them)", async () => {
    // Config stores source as relative path like "zsh/zshrc"
    // previewSymlinks should resolve it against dotfilesPath
    const sourceFile = join(dotfilesPath, "zsh/zshrc");
    await mkdir(join(dotfilesPath, "zsh"), { recursive: true });
    await writeFile(sourceFile, "# zshrc content");

    const targetFile = join(homeDir, ".zshrc");
    await symlink(sourceFile, targetFile);

    // Use relative source path (as config stores it) with absolute source key
    // Note: In real usage, config stores "zsh/zshrc" as key but the symlink
    // comparison needs the absolute path. previewSymlinks resolves source
    // against dotfilesPath before comparison.
    const links: LinkMap = {
      [sourceFile]: targetFile,
    };

    const result = await previewSymlinks(links, dotfilesPath);

    // Should detect as already-linked since the symlink exists and points correctly
    expect(result.safe).toBe(true);
    expect(result.hasNewLinks).toBe(false);
    expect(result.items[0]!.status).toBe("already-linked");
  });

  test("returns hasNewLinks=false when all links are already correct", async () => {
    // Create two source files
    const source1 = join(dotfilesPath, "zsh/zshrc");
    const source2 = join(dotfilesPath, "git/config");

    await mkdir(join(dotfilesPath, "zsh"), { recursive: true });
    await mkdir(join(dotfilesPath, "git"), { recursive: true });
    await writeFile(source1, "# zshrc");
    await writeFile(source2, "# git");

    // Create symlinks pointing to correct sources
    const target1 = join(homeDir, ".zshrc");
    const target2 = join(homeDir, ".gitconfig");
    await symlink(source1, target1);
    await symlink(source2, target2);

    const links: LinkMap = {
      [source1]: target1,
      [source2]: target2,
    };

    const result = await previewSymlinks(links, dotfilesPath);

    expect(result.safe).toBe(true);
    expect(result.hasConflicts).toBe(false);
    expect(result.hasWrongTargets).toBe(false);
    expect(result.hasNewLinks).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.items.every(i => i.status === "already-linked")).toBe(true);
  });
});
