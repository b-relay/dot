import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createConfig,
  getArchitecture,
  scanForHardcodedPaths,
  checkNerdFont,
  type Config,
} from "../index";

// --- getArchitecture tests ---

describe("getArchitecture", () => {
  test("returns arm64 or x86_64", () => {
    const arch = getArchitecture();
    expect(["arm64", "x86_64"]).toContain(arch);
  });

  test("matches process.arch mapping", () => {
    const arch = getArchitecture();
    if (process.arch === "arm64") {
      expect(arch).toBe("arm64");
    } else {
      expect(arch).toBe("x86_64");
    }
  });
});

// --- scanForHardcodedPaths tests ---

describe("scanForHardcodedPaths", () => {
  let tmpDir: string;
  let config: Config;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-arch-scan-"));
    await mkdir(`${tmpDir}/.dotfiles/zsh/config`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/zsh/plugins`, { recursive: true });
    config = createConfig(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("returns empty array when no zsh files exist", async () => {
    const issues = await scanForHardcodedPaths(config);
    expect(issues).toEqual([]);
  });

  test("returns empty array for portable config using brew --prefix", async () => {
    await writeFile(
      `${tmpDir}/.dotfiles/zsh/zprofile`,
      `# Portable homebrew setup
if command -v brew &>/dev/null; then
  FZF_PREFIX="$(brew --prefix)/opt/fzf"
fi
`
    );
    const issues = await scanForHardcodedPaths(config);
    expect(issues).toEqual([]);
  });

  test("skips comment lines", async () => {
    await writeFile(
      `${tmpDir}/.dotfiles/zsh/zprofile`,
      `# This comment mentions /opt/homebrew but should be ignored
# /usr/local/Cellar is also in a comment
`
    );
    const issues = await scanForHardcodedPaths(config);
    expect(issues).toEqual([]);
  });

  test("skips indented comment lines", async () => {
    await writeFile(
      `${tmpDir}/.dotfiles/zsh/zprofile`,
      `if true; then
  # /opt/homebrew in indented comment
  # /usr/local/Cellar in indented comment
fi
`
    );
    const issues = await scanForHardcodedPaths(config);
    expect(issues).toEqual([]);
  });

  // Architecture-specific tests - behavior depends on current machine
  const currentArch = process.arch === "arm64" ? "arm64" : "x86_64";

  if (currentArch === "arm64") {
    // On Apple Silicon, /opt/homebrew is correct, /usr/local/Cellar is wrong

    test("on arm64: does not flag /opt/homebrew (correct for this arch)", async () => {
      await writeFile(
        `${tmpDir}/.dotfiles/zsh/zprofile`,
        `export PATH="/opt/homebrew/bin:$PATH"
`
      );
      const issues = await scanForHardcodedPaths(config);
      expect(issues).toEqual([]);
    });

    test("on arm64: flags /usr/local/Cellar (wrong for this arch)", async () => {
      await writeFile(
        `${tmpDir}/.dotfiles/zsh/zprofile`,
        `source /usr/local/Cellar/fzf/0.50.0/shell/completion.zsh
`
      );
      const issues = await scanForHardcodedPaths(config);
      expect(issues.length).toBe(1);
      expect(issues[0]!.path).toBe("/usr/local/Cellar");
      expect(issues[0]!.line).toBe(1);
      expect(issues[0]!.issue).toBe("wrong-arch");
    });

    test("on arm64: flags /usr/local/opt (wrong for this arch)", async () => {
      await writeFile(
        `${tmpDir}/.dotfiles/zsh/zprofile`,
        `FZF_PREFIX="/usr/local/opt/fzf"
`
      );
      const issues = await scanForHardcodedPaths(config);
      expect(issues.length).toBe(1);
      expect(issues[0]!.path).toBe("/usr/local/opt");
    });
  } else {
    // On Intel, /usr/local is correct, /opt/homebrew is wrong

    test("on x86_64: does not flag /usr/local/Cellar (correct for this arch)", async () => {
      await writeFile(
        `${tmpDir}/.dotfiles/zsh/zprofile`,
        `source /usr/local/Cellar/fzf/0.50.0/shell/completion.zsh
`
      );
      const issues = await scanForHardcodedPaths(config);
      expect(issues).toEqual([]);
    });

    test("on x86_64: flags /opt/homebrew (wrong for this arch)", async () => {
      await writeFile(
        `${tmpDir}/.dotfiles/zsh/zprofile`,
        `export PATH="/opt/homebrew/bin:$PATH"
`
      );
      const issues = await scanForHardcodedPaths(config);
      expect(issues.length).toBe(1);
      expect(issues[0]!.path).toBe("/opt/homebrew");
      expect(issues[0]!.line).toBe(1);
      expect(issues[0]!.issue).toBe("wrong-arch");
    });
  }

  test("scans config/*.zsh files", async () => {
    // Write a file that would be wrong on current arch
    const wrongPath =
      currentArch === "arm64"
        ? "/usr/local/Cellar/something"
        : "/opt/homebrew/bin/something";

    await writeFile(
      `${tmpDir}/.dotfiles/zsh/config/test.zsh`,
      `export TOOL="${wrongPath}"
`
    );
    const issues = await scanForHardcodedPaths(config);
    expect(issues.length).toBe(1);
    expect(issues[0]!.file).toContain("config/test.zsh");
  });

  test("scans plugins/*.zsh files", async () => {
    const wrongPath =
      currentArch === "arm64"
        ? "/usr/local/opt/fzf"
        : "/opt/homebrew/opt/fzf";

    await writeFile(
      `${tmpDir}/.dotfiles/zsh/plugins/test.zsh`,
      `FZF_PREFIX="${wrongPath}"
`
    );
    const issues = await scanForHardcodedPaths(config);
    expect(issues.length).toBe(1);
    expect(issues[0]!.file).toContain("plugins/test.zsh");
  });

  test("reports correct line numbers", async () => {
    const wrongPath =
      currentArch === "arm64" ? "/usr/local/Cellar" : "/opt/homebrew";

    await writeFile(
      `${tmpDir}/.dotfiles/zsh/zprofile`,
      `# Line 1 comment
# Line 2 comment
# Line 3 comment
export BAD="${wrongPath}/something"
`
    );
    const issues = await scanForHardcodedPaths(config);
    expect(issues.length).toBe(1);
    expect(issues[0]!.line).toBe(4);
  });

  test("finds multiple issues in same file", async () => {
    const wrongPath =
      currentArch === "arm64" ? "/usr/local/Cellar" : "/opt/homebrew";

    await writeFile(
      `${tmpDir}/.dotfiles/zsh/zprofile`,
      `export FOO="${wrongPath}/foo"
export BAR="${wrongPath}/bar"
`
    );
    const issues = await scanForHardcodedPaths(config);
    expect(issues.length).toBe(2);
    expect(issues[0]!.line).toBe(1);
    expect(issues[1]!.line).toBe(2);
  });

  test("includes suggestion for portability", async () => {
    const wrongPath =
      currentArch === "arm64" ? "/usr/local/opt" : "/opt/homebrew";

    await writeFile(
      `${tmpDir}/.dotfiles/zsh/zprofile`,
      `export PATH="${wrongPath}/bin:$PATH"
`
    );
    const issues = await scanForHardcodedPaths(config);
    expect(issues.length).toBe(1);
    expect(issues[0]!.suggestion).toContain("$(brew --prefix)");
  });
});

// --- checkNerdFont tests ---

describe("checkNerdFont", () => {
  // These tests check actual system state - they verify the function works
  // but results depend on whether the font is installed

  test("returns boolean", async () => {
    const result = await checkNerdFont();
    expect(typeof result).toBe("boolean");
  });

  test("checks for JetBrainsMono Nerd font", async () => {
    // This test documents expected behavior
    // If you have the font installed, it should return true
    // If not, it should return false
    const result = await checkNerdFont();

    // We can't assert the exact value without knowing system state,
    // but we can verify the function doesn't throw
    expect(result === true || result === false).toBe(true);
  });
});
