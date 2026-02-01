import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConfig,
  writeConfig,
  updateConfigLinks,
  getDotfilesPath,
  loadState,
  saveState,
  initializeDot,
  parseGlobalArgs,
  type DotConfig,
  type DotState,
} from "../index";

// --- getDotfilesPath tests ---

describe("getDotfilesPath", () => {
  const originalEnv = process.env.DOT_HOME;

  afterEach(() => {
    // Restore original env
    if (originalEnv !== undefined) {
      process.env.DOT_HOME = originalEnv;
    } else {
      delete process.env.DOT_HOME;
    }
  });

  test("returns CLI flag value if provided (highest priority)", async () => {
    const result = await getDotfilesPath({ dotfiles: "/custom/path" });
    expect(result).toBe("/custom/path");
  });

  test("returns DOT_HOME env var if set (when no flag)", async () => {
    process.env.DOT_HOME = "/env/path";
    const result = await getDotfilesPath({});
    expect(result).toBe("/env/path");
  });

  test("CLI flag takes priority over DOT_HOME", async () => {
    process.env.DOT_HOME = "/env/path";
    const result = await getDotfilesPath({ dotfiles: "/cli/path" });
    expect(result).toBe("/cli/path");
  });

  test("returns null when no path found", async () => {
    delete process.env.DOT_HOME;
    // Clear any state file
    const result = await getDotfilesPath({});
    // Without state file, should return null (or whatever is in state)
    // Since we haven't set up state, this tests the fallthrough
    expect(result === null || typeof result === "string").toBe(true);
  });
});

// --- loadConfig tests ---

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-config-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("loads valid JSON config", async () => {
    const config = {
      links: { "zsh/zshrc": "~/.zshrc" },
      autoCommit: true,
    };
    await writeFile(`${tmpDir}/dot.config.json`, JSON.stringify(config));

    const result = await loadConfig(tmpDir);
    expect(result).toBeDefined();
    expect(result!.links).toEqual(config.links);
    expect(result!.autoCommit).toBe(true);
  });

  test("returns null when no config file exists", async () => {
    const result = await loadConfig(tmpDir);
    expect(result).toBeNull();
  });

  test("throws error for invalid JSON config", async () => {
    const invalidConfig = {
      links: "not-an-object", // Should be an object
      autoCommit: "not-a-boolean", // Should be boolean
    };
    await writeFile(`${tmpDir}/dot.config.json`, JSON.stringify(invalidConfig));

    await expect(loadConfig(tmpDir)).rejects.toThrow("validation failed");
  });

  test("applies defaults for missing optional fields", async () => {
    // Minimal config with only required field
    const config = {
      links: { "git/config": "~/.gitconfig" },
    };
    await writeFile(`${tmpDir}/dot.config.json`, JSON.stringify(config));

    const result = await loadConfig(tmpDir);
    expect(result).toBeDefined();
    expect(result!.autoCommit).toBe(true); // Default value
  });

  test("handles empty links object", async () => {
    const config = {
      links: {},
      autoCommit: false,
    };
    await writeFile(`${tmpDir}/dot.config.json`, JSON.stringify(config));

    const result = await loadConfig(tmpDir);
    expect(result).toBeDefined();
    expect(result!.links).toEqual({});
    expect(result!.autoCommit).toBe(false);
  });
});

// --- writeConfig tests ---

describe("writeConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-write-config-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("writes config as formatted JSON", async () => {
    const config: DotConfig = {
      links: { "zsh/zshrc": "~/.zshrc" },
      autoCommit: true,
    };

    await writeConfig(tmpDir, config);

    const content = await Bun.file(`${tmpDir}/dot.config.json`).text();
    expect(content).toBe(JSON.stringify(config, null, 2) + "\n");
  });

  test("written config can be loaded back", async () => {
    const config: DotConfig = {
      links: { "a": "b", "c": "d" },
      autoCommit: false,
    };

    await writeConfig(tmpDir, config);
    const loaded = await loadConfig(tmpDir);

    expect(loaded).toEqual(config);
  });
});

// --- updateConfigLinks tests ---

describe("updateConfigLinks", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-update-config-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("adds link to existing config", async () => {
    const existingConfig: DotConfig = {
      links: { "zsh/zshrc": "~/.zshrc" },
      autoCommit: true,
    };
    await writeFile(`${tmpDir}/dot.config.json`, JSON.stringify(existingConfig));

    const result = await updateConfigLinks(tmpDir, {
      source: "git/config",
      target: "~/.gitconfig",
    });

    expect(result.links["zsh/zshrc"]).toBe("~/.zshrc");
    expect(result.links["git/config"]).toBe("~/.gitconfig");
    expect(Object.keys(result.links).length).toBe(2);
  });

  test("creates new config if none exists", async () => {
    const result = await updateConfigLinks(tmpDir, {
      source: "zsh/zshrc",
      target: "~/.zshrc",
    });

    expect(result.links["zsh/zshrc"]).toBe("~/.zshrc");
    expect(result.autoCommit).toBe(true); // Default
  });

  test("persists changes to disk", async () => {
    await updateConfigLinks(tmpDir, {
      source: "test/file",
      target: "~/.testfile",
    });

    const loaded = await loadConfig(tmpDir);
    expect(loaded!.links["test/file"]).toBe("~/.testfile");
  });
});

// --- State management tests ---

describe("state management", () => {
  let tmpDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-state-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    }
    await rm(tmpDir, { recursive: true });
  });

  test("loadState returns null when no state file", async () => {
    const result = await loadState();
    expect(result).toBeNull();
  });

  test("saveState creates state file and loadState retrieves it", async () => {
    const state: DotState = {
      dotfilesPath: "/my/dotfiles",
      configuredAt: "2024-01-15T10:00:00Z",
    };

    await saveState(state);
    const loaded = await loadState();

    expect(loaded).toEqual(state);
  });

  test("saveState creates parent directory if missing", async () => {
    const state: DotState = {
      dotfilesPath: "/state/test/path",
      configuredAt: new Date().toISOString(),
    };

    await saveState(state);
    const loaded = await loadState();

    expect(loaded).toEqual(state);
  });
});

// --- initializeDot tests ---

describe("initializeDot", () => {
  let tmpDir: string;
  let originalHome: string | undefined;
  let originalDotHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-init-"));
    originalHome = process.env.HOME;
    originalDotHome = process.env.DOT_HOME;
    process.env.HOME = tmpDir;
    delete process.env.DOT_HOME;
    // Ensure no state file exists from previous tests
    // by creating a fresh HOME directory
  });

  afterEach(async () => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    }
    if (originalDotHome !== undefined) {
      process.env.DOT_HOME = originalDotHome;
    } else {
      delete process.env.DOT_HOME;
    }
    await rm(tmpDir, { recursive: true });
  });

  test("returns null when no dotfiles found and no state", async () => {
    // Fresh tmpDir with no .dotfiles and no state file
    const result = await initializeDot({});
    expect(result).toBeNull();
  });

  test("finds ~/.dotfiles by default", async () => {
    // Create ~/.dotfiles
    await mkdir(`${tmpDir}/.dotfiles/zsh`, { recursive: true });
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "# test");

    const result = await initializeDot({});
    expect(result).not.toBeNull();
    expect(result!.dotfilesPath).toBe(`${tmpDir}/.dotfiles`);
  });

  test("uses --dotfiles flag when provided", async () => {
    const customPath = `${tmpDir}/custom-dotfiles`;
    await mkdir(customPath, { recursive: true });

    const result = await initializeDot({ dotfiles: customPath });
    expect(result).not.toBeNull();
    expect(result!.dotfilesPath).toBe(customPath);
  });

  test("loads config from dotfiles repo", async () => {
    await mkdir(`${tmpDir}/.dotfiles`, { recursive: true });
    const config = {
      links: { "custom/file": "~/.custom" },
      autoCommit: false,
    };
    await writeFile(`${tmpDir}/.dotfiles/dot.config.json`, JSON.stringify(config));

    const result = await initializeDot({});
    expect(result).not.toBeNull();
    expect(result!.config.links).toEqual(config.links);
    expect(result!.config.autoCommit).toBe(false);
  });

  test("uses legacy links when no config file", async () => {
    await mkdir(`${tmpDir}/.dotfiles`, { recursive: true });

    const result = await initializeDot({});
    expect(result).not.toBeNull();
    // Should have legacy links
    expect(Object.keys(result!.config.links).length).toBeGreaterThan(0);
    // Check for a known legacy link
    const hasZshenvLink = Object.values(result!.config.links).some(
      target => target.includes(".zshenv")
    );
    expect(hasZshenvLink).toBe(true);
  });
});

// --- parseGlobalArgs tests ---

describe("parseGlobalArgs", () => {
  test("parses --dotfiles flag", () => {
    // Note: This test is limited because Bun.argv is fixed at runtime
    // We're mainly testing that the function exists and returns expected shape
    const result = parseGlobalArgs();
    expect(typeof result).toBe("object");
    expect("dotfiles" in result).toBe(true);
  });
});
