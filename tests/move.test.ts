import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  readlink,
  lstat,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moveSelf, parseMoveArgs, type MoveOptions } from "../src/move";
import { loadState, saveState } from "../src/state";
import type { DotConfig } from "../src/types";

// Helper to check if path exists
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// Helper to check if symlink exists and points to expected target
async function checkSymlink(
  linkPath: string,
  expectedTarget: string
): Promise<boolean> {
  try {
    const linkStat = await lstat(linkPath);
    if (!linkStat.isSymbolicLink()) return false;
    const target = await readlink(linkPath);
    return target === expectedTarget;
  } catch {
    return false;
  }
}

describe("parseMoveArgs", () => {
  test("parses path argument", () => {
    const { path, options } = parseMoveArgs(["~/new-dotfiles"]);
    expect(path).toBe("~/new-dotfiles");
    expect(options.force).toBeUndefined();
    expect(options.self).toBeUndefined();
  });

  test("parses --force flag", () => {
    const { path, options } = parseMoveArgs(["--force", "~/new-dotfiles"]);
    expect(path).toBe("~/new-dotfiles");
    expect(options.force).toBe(true);
  });

  test("parses -f short flag", () => {
    const { path, options } = parseMoveArgs(["-f", "~/new-dotfiles"]);
    expect(path).toBe("~/new-dotfiles");
    expect(options.force).toBe(true);
  });

  test("parses --self flag", () => {
    const { path, options } = parseMoveArgs(["--self", "~/new-dotfiles"]);
    expect(path).toBe("~/new-dotfiles");
    expect(options.self).toBe(true);
  });

  test("parses all flags together", () => {
    const { path, options } = parseMoveArgs(["--self", "-f", "~/new-dotfiles"]);
    expect(path).toBe("~/new-dotfiles");
    expect(options.force).toBe(true);
    expect(options.self).toBe(true);
  });

  test("returns undefined path when not provided", () => {
    const { path, options } = parseMoveArgs(["--force"]);
    expect(path).toBeUndefined();
    expect(options.force).toBe(true);
  });
});

describe("moveSelf command", () => {
  let tmpDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-move-test-"));

    // Save original HOME
    originalHome = process.env.HOME;

    // Set HOME to tmpDir for tests (for state file path)
    process.env.HOME = tmpDir;

    // Create state directory
    await mkdir(`${tmpDir}/.config/dot`, { recursive: true });
  });

  afterEach(async () => {
    // Restore original HOME
    if (originalHome) {
      process.env.HOME = originalHome;
    }

    // Clean up temp directory
    await rm(tmpDir, { recursive: true });
  });

  describe("folder movement", () => {
    test("moves folder to new location", async () => {
      const currentPath = `${tmpDir}/dotfiles`;
      const newPath = `${tmpDir}/new-location`;

      // Create source structure
      await mkdir(`${currentPath}/zsh`, { recursive: true });
      await writeFile(`${currentPath}/zsh/zshrc`, "# zshrc");
      await writeFile(`${currentPath}/test.txt`, "test content");

      const config: DotConfig = { links: {}, autoCommit: true };

      await moveSelf(newPath, currentPath, config, { force: true });

      // Verify old path no longer exists
      expect(await pathExists(currentPath)).toBe(false);

      // Verify new path has content
      expect(await pathExists(newPath)).toBe(true);
      expect(await pathExists(`${newPath}/zsh/zshrc`)).toBe(true);

      const content = await readFile(`${newPath}/test.txt`, "utf-8");
      expect(content).toBe("test content");
    });

    test("creates parent directory if needed", async () => {
      const currentPath = `${tmpDir}/dotfiles`;
      const newPath = `${tmpDir}/deeply/nested/new-location`;

      await mkdir(currentPath, { recursive: true });
      await writeFile(`${currentPath}/test.txt`, "test");

      const config: DotConfig = { links: {}, autoCommit: true };

      await moveSelf(newPath, currentPath, config, { force: true });

      expect(await pathExists(newPath)).toBe(true);
      expect(await pathExists(`${newPath}/test.txt`)).toBe(true);
    });

    test("handles empty destination directory", async () => {
      const currentPath = `${tmpDir}/dotfiles`;
      const newPath = `${tmpDir}/new-location`;

      await mkdir(currentPath, { recursive: true });
      await mkdir(newPath, { recursive: true }); // Empty destination
      await writeFile(`${currentPath}/test.txt`, "test");

      const config: DotConfig = { links: {}, autoCommit: true };

      // Empty destination should work without force
      await moveSelf(newPath, currentPath, config, { force: true });

      expect(await pathExists(`${newPath}/test.txt`)).toBe(true);
    });
  });

  describe("symlink updates", () => {
    test("updates symlinks to point to new location", async () => {
      const currentPath = `${tmpDir}/dotfiles`;
      const newPath = `${tmpDir}/new-dotfiles`;
      const targetDir = `${tmpDir}/.config/zsh`;

      // Create source structure
      await mkdir(`${currentPath}/zsh`, { recursive: true });
      await writeFile(`${currentPath}/zsh/zshrc`, "# zshrc content");

      // Create target directory and initial symlink
      await mkdir(targetDir, { recursive: true });
      await symlink(`${currentPath}/zsh/zshrc`, `${targetDir}/.zshrc`);

      // Verify initial symlink
      expect(
        await checkSymlink(`${targetDir}/.zshrc`, `${currentPath}/zsh/zshrc`)
      ).toBe(true);

      // Config with link definition
      const config: DotConfig = {
        links: {
          "zsh/zshrc": `${targetDir}/.zshrc`,
        },
        autoCommit: true,
      };

      await moveSelf(newPath, currentPath, config, { force: true });

      // Verify symlink now points to new location
      expect(
        await checkSymlink(`${targetDir}/.zshrc`, `${newPath}/zsh/zshrc`)
      ).toBe(true);

      // Verify reading through symlink works
      const content = await readFile(`${targetDir}/.zshrc`, "utf-8");
      expect(content).toBe("# zshrc content");
    });

    test("handles multiple symlinks", async () => {
      const currentPath = `${tmpDir}/dotfiles`;
      const newPath = `${tmpDir}/new-dotfiles`;

      // Create source files
      await mkdir(`${currentPath}/zsh`, { recursive: true });
      await mkdir(`${currentPath}/git`, { recursive: true });
      await writeFile(`${currentPath}/zsh/zshrc`, "# zshrc");
      await writeFile(`${currentPath}/git/.gitconfig`, "# gitconfig");

      // Create target directories
      const zshTarget = `${tmpDir}/.config/zsh`;
      const gitTarget = `${tmpDir}/.config/git`;
      await mkdir(zshTarget, { recursive: true });
      await mkdir(gitTarget, { recursive: true });

      // Create symlinks
      await symlink(`${currentPath}/zsh/zshrc`, `${zshTarget}/.zshrc`);
      await symlink(`${currentPath}/git/.gitconfig`, `${gitTarget}/config`);

      const config: DotConfig = {
        links: {
          "zsh/zshrc": `${zshTarget}/.zshrc`,
          "git/.gitconfig": `${gitTarget}/config`,
        },
        autoCommit: true,
      };

      await moveSelf(newPath, currentPath, config, { force: true });

      // Verify both symlinks updated
      expect(
        await checkSymlink(`${zshTarget}/.zshrc`, `${newPath}/zsh/zshrc`)
      ).toBe(true);
      expect(
        await checkSymlink(`${gitTarget}/config`, `${newPath}/git/.gitconfig`)
      ).toBe(true);
    });

    test("skips symlinks for non-existent sources", async () => {
      const currentPath = `${tmpDir}/dotfiles`;
      const newPath = `${tmpDir}/new-dotfiles`;

      // Create source with only some files
      await mkdir(`${currentPath}/zsh`, { recursive: true });
      await writeFile(`${currentPath}/zsh/zshrc`, "# zshrc");
      // Note: NOT creating git/.gitconfig

      // Config includes link for non-existent source
      const config: DotConfig = {
        links: {
          "zsh/zshrc": `${tmpDir}/.zshrc`,
          "git/.gitconfig": `${tmpDir}/.gitconfig`, // doesn't exist
        },
        autoCommit: true,
      };

      // Should not throw - just skip non-existent
      await moveSelf(newPath, currentPath, config, { force: true });

      // Folder should still move
      expect(await pathExists(`${newPath}/zsh/zshrc`)).toBe(true);
    });
  });

  describe("state updates", () => {
    test("updates state file with new path", async () => {
      const currentPath = `${tmpDir}/dotfiles`;
      const newPath = `${tmpDir}/new-dotfiles`;

      await mkdir(currentPath, { recursive: true });
      await writeFile(`${currentPath}/test.txt`, "test");

      // Set initial state
      await saveState({
        dotfilesPath: currentPath,
        configuredAt: new Date().toISOString(),
      });

      const config: DotConfig = { links: {}, autoCommit: true };

      await moveSelf(newPath, currentPath, config, { force: true });

      // Verify state updated
      const state = await loadState();
      expect(state?.dotfilesPath).toBe(newPath);
    });
  });

  describe("tilde expansion", () => {
    test("expands ~ to home directory", async () => {
      const currentPath = `${tmpDir}/dotfiles`;

      await mkdir(currentPath, { recursive: true });
      await writeFile(`${currentPath}/test.txt`, "test");

      const config: DotConfig = { links: {}, autoCommit: true };

      // Use ~ which should expand to tmpDir (our test HOME)
      await moveSelf("~/new-dotfiles", currentPath, config, { force: true });

      // Verify moved to $HOME/new-dotfiles
      expect(await pathExists(`${tmpDir}/new-dotfiles/test.txt`)).toBe(true);
    });

    test("expands ~/path correctly", async () => {
      const currentPath = `${tmpDir}/dotfiles`;

      await mkdir(currentPath, { recursive: true });
      await writeFile(`${currentPath}/test.txt`, "test");

      const config: DotConfig = { links: {}, autoCommit: true };

      await moveSelf("~/projects/dotfiles", currentPath, config, { force: true });

      expect(await pathExists(`${tmpDir}/projects/dotfiles/test.txt`)).toBe(
        true
      );
    });
  });
});
