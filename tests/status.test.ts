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
  install,
  getStatus,
  formatStatus,
  type Config,
  type Status,
} from "../index";

describe("getStatus", () => {
  let tmpDir: string;
  let config: Config;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-status-test-"));

    // Create test directory structure
    await mkdir(`${tmpDir}/.dotfiles/zsh`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/git`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/tmux`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/vscode`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/jj`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/.git`, { recursive: true }); // Fake git repo

    // Create source files
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "# zshenv");
    await writeFile(`${tmpDir}/.dotfiles/zsh/zprofile`, "# zprofile");
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshrc`, "# zshrc");
    await writeFile(`${tmpDir}/.dotfiles/zsh/starship.toml`, "# starship");
    await writeFile(`${tmpDir}/.dotfiles/git/.gitconfig`, "# gitconfig");
    await writeFile(`${tmpDir}/.dotfiles/tmux/tmux.conf`, "# tmux");
    await writeFile(`${tmpDir}/.dotfiles/vscode/settings.json`, "{}");
    await writeFile(`${tmpDir}/.dotfiles/jj/config.toml`, "# jj");

    config = createConfig(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("returns status object with all required fields", async () => {
    const status = await getStatus(config);

    expect(status).toHaveProperty("installed");
    expect(status).toHaveProperty("linksTotal");
    expect(status).toHaveProperty("linksValid");
    expect(status).toHaveProperty("linksBroken");
    expect(status).toHaveProperty("linksMissing");
    expect(status).toHaveProperty("dotfilesPath");
    expect(status).toHaveProperty("isGitRepo");
  });

  test("detects uninstalled state (no symlinks)", async () => {
    const status = await getStatus(config);

    expect(status.installed).toBe(false);
    expect(status.linksMissing).toBe(status.linksTotal);
    expect(status.linksValid).toBe(0);
  });

  test("detects fully installed state", async () => {
    await install(config);
    const status = await getStatus(config);

    expect(status.installed).toBe(true);
    expect(status.linksValid).toBe(status.linksTotal);
    expect(status.linksMissing).toBe(0);
    expect(status.linksBroken).toBe(0);
  });

  test("detects partially installed state", async () => {
    // Install first
    await install(config);

    // Then manually create one broken link (delete source)
    await rm(`${tmpDir}/.dotfiles/zsh/zshenv`);

    const status = await getStatus(config);

    // Should have at least some valid, but not all
    expect(status.linksValid).toBeGreaterThan(0);
    expect(status.linksValid).toBeLessThan(status.linksTotal);
    // The broken link should show up as broken
    expect(status.linksBroken).toBe(1);
  });

  test("detects git repo presence", async () => {
    const status = await getStatus(config);
    expect(status.isGitRepo).toBe(true);
  });

  test("detects missing dotfiles directory", async () => {
    await rm(`${tmpDir}/.dotfiles`, { recursive: true });

    const status = await getStatus(config);

    expect(status.installed).toBe(false);
    expect(status.isGitRepo).toBe(false);
    expect(status.dotfilesExists).toBe(false);
  });

  test("reports correct dotfiles path", async () => {
    const status = await getStatus(config);
    expect(status.dotfilesPath).toBe(`${tmpDir}/.dotfiles`);
  });
});

describe("status command output", () => {
  let tmpDir: string;
  let config: Config;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-status-output-"));

    await mkdir(`${tmpDir}/.dotfiles/zsh`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/git`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/tmux`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/vscode`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/jj`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/.git`, { recursive: true });

    await writeFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "# zshenv");
    await writeFile(`${tmpDir}/.dotfiles/zsh/zprofile`, "# zprofile");
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshrc`, "# zshrc");
    await writeFile(`${tmpDir}/.dotfiles/zsh/starship.toml`, "# starship");
    await writeFile(`${tmpDir}/.dotfiles/git/.gitconfig`, "# gitconfig");
    await writeFile(`${tmpDir}/.dotfiles/tmux/tmux.conf`, "# tmux");
    await writeFile(`${tmpDir}/.dotfiles/vscode/settings.json`, "{}");
    await writeFile(`${tmpDir}/.dotfiles/jj/config.toml`, "# jj");

    config = createConfig(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("formatStatus returns human-readable summary", async () => {
    await install(config);
    const status = await getStatus(config);
    const formatted = formatStatus(status);

    expect(formatted).toContain("dotfiles");
    expect(formatted).toContain("links");
  });
});
