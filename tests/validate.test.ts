import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createConfig,
  validateConfig,
  type Config,
  type ValidationResult,
} from "../index";

describe("validateConfig", () => {
  let tmpDir: string;
  let config: Config;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-validate-"));

    // Create dotfiles directory structure
    await mkdir(`${tmpDir}/.dotfiles/zsh`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/git`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/tmux`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/vscode`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/jj`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/.git`, { recursive: true });

    config = createConfig(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("returns valid when all source files exist", async () => {
    // Create all source files
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "# zshenv");
    await writeFile(`${tmpDir}/.dotfiles/zsh/zprofile`, "# zprofile");
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshrc`, "# zshrc");
    await writeFile(`${tmpDir}/.dotfiles/zsh/starship.toml`, "# starship");
    await writeFile(`${tmpDir}/.dotfiles/git/.gitconfig`, "# gitconfig");
    await writeFile(`${tmpDir}/.dotfiles/tmux/tmux.conf`, "# tmux");
    await writeFile(`${tmpDir}/.dotfiles/vscode/settings.json`, "{}");
    await writeFile(`${tmpDir}/.dotfiles/jj/config.toml`, "# jj");

    const result = await validateConfig(config);

    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test("reports missing source files", async () => {
    // Create only some files
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "# zshenv");

    const result = await validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.type === "missing-source")).toBe(true);
  });

  test("reports target conflicts (existing non-symlink files)", async () => {
    // Create all source files
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "# zshenv");
    await writeFile(`${tmpDir}/.dotfiles/zsh/zprofile`, "# zprofile");
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshrc`, "# zshrc");
    await writeFile(`${tmpDir}/.dotfiles/zsh/starship.toml`, "# starship");
    await writeFile(`${tmpDir}/.dotfiles/git/.gitconfig`, "# gitconfig");
    await writeFile(`${tmpDir}/.dotfiles/tmux/tmux.conf`, "# tmux");
    await writeFile(`${tmpDir}/.dotfiles/vscode/settings.json`, "{}");
    await writeFile(`${tmpDir}/.dotfiles/jj/config.toml`, "# jj");

    // Create conflicting regular file at target
    await writeFile(`${tmpDir}/.zshenv`, "existing file");

    const result = await validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.type === "target-conflict")).toBe(true);
  });

  test("does not report conflict for correct symlinks", async () => {
    // Create all source files
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "# zshenv");
    await writeFile(`${tmpDir}/.dotfiles/zsh/zprofile`, "# zprofile");
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshrc`, "# zshrc");
    await writeFile(`${tmpDir}/.dotfiles/zsh/starship.toml`, "# starship");
    await writeFile(`${tmpDir}/.dotfiles/git/.gitconfig`, "# gitconfig");
    await writeFile(`${tmpDir}/.dotfiles/tmux/tmux.conf`, "# tmux");
    await writeFile(`${tmpDir}/.dotfiles/vscode/settings.json`, "{}");
    await writeFile(`${tmpDir}/.dotfiles/jj/config.toml`, "# jj");

    // Create correct symlink
    await symlink(`${tmpDir}/.dotfiles/zsh/zshenv`, `${tmpDir}/.zshenv`);

    const result = await validateConfig(config);

    // Should not report conflict for existing correct symlink
    expect(result.errors.filter(e => e.path?.includes(".zshenv") && e.type === "target-conflict").length).toBe(0);
  });

  test("reports wrong-target symlinks", async () => {
    // Create all source files
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "# zshenv");
    await writeFile(`${tmpDir}/.dotfiles/zsh/zprofile`, "# zprofile");
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshrc`, "# zshrc");
    await writeFile(`${tmpDir}/.dotfiles/zsh/starship.toml`, "# starship");
    await writeFile(`${tmpDir}/.dotfiles/git/.gitconfig`, "# gitconfig");
    await writeFile(`${tmpDir}/.dotfiles/tmux/tmux.conf`, "# tmux");
    await writeFile(`${tmpDir}/.dotfiles/vscode/settings.json`, "{}");
    await writeFile(`${tmpDir}/.dotfiles/jj/config.toml`, "# jj");

    // Create wrong symlink
    await writeFile(`${tmpDir}/wrong-target`, "wrong");
    await symlink(`${tmpDir}/wrong-target`, `${tmpDir}/.zshenv`);

    const result = await validateConfig(config);

    expect(result.warnings.some(w => w.type === "wrong-target")).toBe(true);
  });

  test("reports missing dotfiles directory", async () => {
    await rm(`${tmpDir}/.dotfiles`, { recursive: true });

    const result = await validateConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.type === "missing-dotfiles")).toBe(true);
  });

  test("returns warnings separately from errors", async () => {
    // Create source files
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "# zshenv");
    await writeFile(`${tmpDir}/.dotfiles/zsh/zprofile`, "# zprofile");
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshrc`, "# zshrc");
    await writeFile(`${tmpDir}/.dotfiles/zsh/starship.toml`, "# starship");
    await writeFile(`${tmpDir}/.dotfiles/git/.gitconfig`, "# gitconfig");
    await writeFile(`${tmpDir}/.dotfiles/tmux/tmux.conf`, "# tmux");
    await writeFile(`${tmpDir}/.dotfiles/vscode/settings.json`, "{}");
    await writeFile(`${tmpDir}/.dotfiles/jj/config.toml`, "# jj");

    // Create a wrong symlink (warning, not error)
    await writeFile(`${tmpDir}/wrong`, "wrong");
    await symlink(`${tmpDir}/wrong`, `${tmpDir}/.zshenv`);

    const result = await validateConfig(config);

    // Wrong symlink is a warning, not an error
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test("includes summary counts", async () => {
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "# zshenv");

    const result = await validateConfig(config);

    expect(result).toHaveProperty("totalLinks");
    expect(result).toHaveProperty("validLinks");
    expect(result).toHaveProperty("missingSourceCount");
  });
});
