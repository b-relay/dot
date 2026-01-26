import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createConfig,
  listLinks,
  type Config,
  type LinkInfo,
} from "../index";

describe("listLinks", () => {
  let tmpDir: string;
  let config: Config;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-list-test-"));

    // Create dotfiles directory structure
    await mkdir(`${tmpDir}/.dotfiles/zsh`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/git`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/tmux`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/vscode`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/jj`, { recursive: true });

    config = createConfig(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("returns all configured links", async () => {
    const links = await listLinks(config);

    expect(links.length).toBe(Object.keys(config.links).length);
  });

  test("includes source and target paths", async () => {
    const links = await listLinks(config);

    for (const link of links) {
      expect(link).toHaveProperty("source");
      expect(link).toHaveProperty("target");
      expect(link.source).toContain(".dotfiles");
    }
  });

  test("indicates source existence", async () => {
    // Create one source file
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "# test");

    const links = await listLinks(config);

    const zshenv = links.find(l => l.source.includes("zshenv"));
    expect(zshenv).toBeDefined();
    expect(zshenv!.sourceExists).toBe(true);

    // Other links should show source missing
    const other = links.find(l => !l.source.includes("zshenv"));
    expect(other).toBeDefined();
    expect(other!.sourceExists).toBe(false);
  });

  test("indicates link status", async () => {
    // Create all source files
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "# zshenv");
    await writeFile(`${tmpDir}/.dotfiles/zsh/zprofile`, "# zprofile");
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshrc`, "# zshrc");
    await writeFile(`${tmpDir}/.dotfiles/zsh/starship.toml`, "# starship");
    await writeFile(`${tmpDir}/.dotfiles/git/.gitconfig`, "# gitconfig");
    await writeFile(`${tmpDir}/.dotfiles/tmux/tmux.conf`, "# tmux");
    await writeFile(`${tmpDir}/.dotfiles/vscode/settings.json`, "{}");
    await writeFile(`${tmpDir}/.dotfiles/jj/config.toml`, "# jj");

    const links = await listLinks(config);

    // All should show status: "missing" (not installed yet)
    for (const link of links) {
      expect(link.status).toBe("missing");
    }
  });

  test("groups by module", async () => {
    const links = await listLinks(config);

    // Should have module info
    const modules = new Set(links.map(l => l.module));
    expect(modules.size).toBeGreaterThan(0);

    // zsh links should be grouped
    const zshLinks = links.filter(l => l.module === "zsh");
    expect(zshLinks.length).toBeGreaterThan(1);
  });

  test("extracts module from source path", async () => {
    const links = await listLinks(config);

    const zshenv = links.find(l => l.source.includes("zsh/zshenv"));
    expect(zshenv?.module).toBe("zsh");

    const gitconfig = links.find(l => l.source.includes("git/.gitconfig"));
    expect(gitconfig?.module).toBe("git");
  });
});
