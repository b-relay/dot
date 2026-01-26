import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  symlink,
  unlink,
  lstat,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createConfig,
  install,
  uninstall,
  getSymlinkStatus,
  getDotfiles,
  isPathManaged,
  __test,
  type Config,
} from "../index";

const { pathExists, tryRealpath, resolveSymlinkTarget, linksToExpectedResolved } = __test;

describe("install/uninstall", () => {
  let tmpDir: string;
  let config: Config;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-test-"));

    // Create test directory structure matching what install expects
    await mkdir(`${tmpDir}/.dotfiles/zsh`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/git`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/tmux`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/vscode`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/jj`, { recursive: true });

    // Create source files
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "# zshenv");
    await writeFile(`${tmpDir}/.dotfiles/zsh/zprofile`, "# zprofile");
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshrc`, "# zshrc");
    await writeFile(`${tmpDir}/.dotfiles/zsh/starship.toml`, "# starship");
    await writeFile(`${tmpDir}/.dotfiles/git/.gitconfig`, "# gitconfig");
    await writeFile(`${tmpDir}/.dotfiles/tmux/tmux.conf`, "# tmux");
    await writeFile(`${tmpDir}/.dotfiles/vscode/settings.json`, "{}");
    await writeFile(`${tmpDir}/.dotfiles/jj/config.toml`, "# jj");

    // Create config pointing to temp dir as "home"
    config = createConfig(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("creates symlinks with correct sources and targets", async () => {
    await install(config);

    const status = await getSymlinkStatus(config);

    // Build expected targets set with resolved paths for matching
    const expectedTargets = new Set(
      Object.values(config.links).map(t => resolve(t))
    );

    // Scope to expected targets only (compare resolved paths)
    const scopedStatus = status.filter(s => expectedTargets.has(resolve(s.target)));
    const validLinks = scopedStatus.filter(s => s.status === "valid");

    // Assert exactly one status row per expected target (no duplicates, no missing)
    expect(new Set(scopedStatus.map(s => resolve(s.target))).size)
      .toBe(expectedTargets.size);

    expect(validLinks.length).toBe(expectedTargets.size);

    // Verify each link has correct source AND target
    for (const [source, target] of Object.entries(config.links)) {
      const targetAbs = resolve(target);
      const s = scopedStatus.find(st => resolve(st.target) === targetAbs);
      expect(s).toBeDefined();
      expect(s?.status).toBe("valid");
      // Compare normalized source paths
      expect(resolve(s?.source ?? "")).toBe(resolve(source));
    }
  });

  test("reading through symlink returns source content", async () => {
    const testContent = "# custom zshrc content";
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshrc`, testContent);

    await install(config);

    const content = await readFile(`${tmpDir}/.config/zsh/.zshrc`, "utf-8");
    expect(content).toBe(testContent);
  });

  test("uninstall removes all symlinks", async () => {
    await install(config);
    await uninstall(config);

    const status = await getSymlinkStatus(config);
    const missingLinks = status.filter(s => s.status === "missing");

    expect(missingLinks.length).toBe(Object.keys(config.links).length);
  });

  test("uninstall preserves source files", async () => {
    const testContent = "# preserve this";
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshrc`, testContent);

    await install(config);
    await uninstall(config);

    const content = await readFile(`${tmpDir}/.dotfiles/zsh/zshrc`, "utf-8");
    expect(content).toBe(testContent);
  });

  test("install skips existing symlinks", async () => {
    await install(config);
    // Second install should skip (not error)
    await install(config);

    const status = await getSymlinkStatus(config);
    const validLinks = status.filter(s => s.status === "valid");
    expect(validLinks.length).toBe(Object.keys(config.links).length);
  });
});

describe("getSymlinkStatus", () => {
  let tmpDir: string;
  let config: Config;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-status-test-"));

    await mkdir(`${tmpDir}/.dotfiles/zsh`, { recursive: true });
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "# test");

    config = createConfig(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("reports missing symlinks", async () => {
    const status = await getSymlinkStatus(config);
    const missing = status.filter(s => s.status === "missing");

    // Verify set membership, not just count
    const expectedTargets = new Set(Object.values(config.links));
    const missingTargets = new Set(missing.map(m => m.target));

    // Size equality + member equality
    expect(missingTargets.size).toBe(expectedTargets.size);
    for (const target of expectedTargets) {
      expect(missingTargets.has(target)).toBe(true);
    }
  });

  test("reports valid symlinks after install", async () => {
    // Create all source files
    await mkdir(`${tmpDir}/.dotfiles/git`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/tmux`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/vscode`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/jj`, { recursive: true });

    await writeFile(`${tmpDir}/.dotfiles/zsh/zprofile`, "# zprofile");
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshrc`, "# zshrc");
    await writeFile(`${tmpDir}/.dotfiles/zsh/starship.toml`, "# starship");
    await writeFile(`${tmpDir}/.dotfiles/git/.gitconfig`, "# gitconfig");
    await writeFile(`${tmpDir}/.dotfiles/tmux/tmux.conf`, "# tmux");
    await writeFile(`${tmpDir}/.dotfiles/vscode/settings.json`, "{}");
    await writeFile(`${tmpDir}/.dotfiles/jj/config.toml`, "# jj");

    await install(config);
    const status = await getSymlinkStatus(config);

    expect(status.every(s => s.status === "valid")).toBe(true);
  });

  test("detects wrong-target symlinks", async () => {
    // Create an actual file to point to (so it's "wrong" not "broken")
    const wrongFile = `${tmpDir}/wrong-target-file`;
    await writeFile(wrongFile, "wrong");
    await symlink(wrongFile, `${tmpDir}/.zshenv`);

    const status = await getSymlinkStatus(config);
    const zshenv = status.find(s => s.target.endsWith(".zshenv"));
    expect(zshenv?.status).toBe("wrong-target");
  });

  test("detects broken symlinks", async () => {
    // Create symlink to the CORRECT source path, but source doesn't exist
    // (simulates: source file was deleted after linking)
    const expectedSource = `${tmpDir}/.dotfiles/zsh/zshenv`;
    await unlink(expectedSource); // Remove the source file
    await symlink(expectedSource, `${tmpDir}/.zshenv`);

    const status = await getSymlinkStatus(config);
    const zshenv = status.find(s => s.target.endsWith(".zshenv"));
    expect(zshenv?.status).toBe("broken");
  });

  test("handles relative symlink destinations correctly", async () => {
    // This is the bug that originally caused issues:
    // A symlink with a relative destination like ".dotfiles/zsh/zshenv"
    // instead of an absolute path should still be recognized as valid
    // when it resolves to the correct source file.

    // Create a relative symlink (relative to tmpDir)
    const relativeTarget = ".dotfiles/zsh/zshenv";
    await symlink(relativeTarget, `${tmpDir}/.zshenv`);

    const status = await getSymlinkStatus(config);
    const zshenv = status.find(s => s.target.endsWith(".zshenv"));
    expect(zshenv?.status).toBe("valid");
  });

  test("handles .. relative symlink destinations correctly", async () => {
    // The more common case: symlinks created from inside subdirectories
    // that use .. to navigate back up. This is the pattern that tends
    // to break naïve readlink comparisons.

    // Create all needed dirs and files
    await mkdir(`${tmpDir}/.dotfiles/zsh`, { recursive: true });
    await mkdir(`${tmpDir}/.config/zsh`, { recursive: true });
    await writeFile(`${tmpDir}/.dotfiles/zsh/zprofile`, "# zprofile");

    // Create a symlink from .config/zsh/.zprofile -> ../../.dotfiles/zsh/zprofile
    // This is how links are commonly created when running `ln -s` from the target dir
    await symlink("../../.dotfiles/zsh/zprofile", `${tmpDir}/.config/zsh/.zprofile`);

    const status = await getSymlinkStatus(config);
    const zprofile = status.find(s => s.target.endsWith(".zprofile"));
    expect(zprofile?.status).toBe("valid");
  });

  test("resolves deeply nested relative symlink (4+ levels)", async () => {
    // Validates the fix for relative symlink resolution handles complex
    // directory structures with many levels of ../
    await mkdir(`${tmpDir}/.config/a/b/c/d`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/zsh`, { recursive: true });
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshrc`, "content");

    // 5 levels of ../ to get back to home
    await symlink(
      "../../../../../.dotfiles/zsh/zshrc",
      `${tmpDir}/.config/a/b/c/d/zshrc`
    );

    const status = await getSymlinkStatus({
      ...config,
      links: {
        [`${tmpDir}/.dotfiles/zsh/zshrc`]: `${tmpDir}/.config/a/b/c/d/zshrc`,
      },
    });

    expect(status[0]?.status).toBe("valid");
  });

  test("reports mixed symlink states correctly", async () => {
    // Tests that getSymlinkStatus correctly handles multiple links with
    // different states simultaneously (validates Promise.all handling)
    await mkdir(`${tmpDir}/.dotfiles/git`, { recursive: true });
    await mkdir(`${tmpDir}/.dotfiles/jj`, { recursive: true });
    await mkdir(`${tmpDir}/.config/git`, { recursive: true });
    await mkdir(`${tmpDir}/.config/jj`, { recursive: true });
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "content");
    // Don't create git/.gitconfig (missing source)

    // Create valid symlink
    await symlink(`${tmpDir}/.dotfiles/zsh/zshenv`, `${tmpDir}/.zshenv`);
    // Create wrong-target symlink
    await writeFile(`${tmpDir}/wrong-file`, "wrong");
    await symlink(`${tmpDir}/wrong-file`, `${tmpDir}/.config/git/config`);

    const testConfig = {
      ...config,
      links: {
        [`${tmpDir}/.dotfiles/zsh/zshenv`]: `${tmpDir}/.zshenv`,
        [`${tmpDir}/.dotfiles/git/.gitconfig`]: `${tmpDir}/.config/git/config`,
        [`${tmpDir}/.dotfiles/jj/config.toml`]: `${tmpDir}/.config/jj/config.toml`,
      },
    };

    const status = await getSymlinkStatus(testConfig);

    const valid = status.find(s => s.target.endsWith(".zshenv"));
    const wrong = status.find(s => s.target.includes("git/config"));
    const missing = status.find(s => s.target.includes("jj/config"));

    expect(valid?.status).toBe("valid");
    expect(wrong?.status).toBe("wrong-target");
    expect(missing?.status).toBe("missing");
  });
});

describe("uninstall safety", () => {
  let tmpDir: string;
  let config: Config;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-uninstall-test-"));

    await mkdir(`${tmpDir}/.dotfiles/zsh`, { recursive: true });
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "# test");

    config = createConfig(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("uninstall skips symlinks pointing elsewhere", async () => {
    // Create symlink pointing to wrong location
    const wrongFile = `${tmpDir}/other-file`;
    await writeFile(wrongFile, "other");
    await symlink(wrongFile, `${tmpDir}/.zshenv`);

    await uninstall(config);

    // Symlink should still exist (not ours to remove)
    const linkStat = await lstat(`${tmpDir}/.zshenv`);
    expect(linkStat.isSymbolicLink()).toBe(true);
  });

  test("uninstall skips non-symlink files", async () => {
    // Create a regular file instead of a symlink
    await writeFile(`${tmpDir}/.zshenv`, "# regular file");

    await uninstall(config);

    // File should still exist
    const content = await readFile(`${tmpDir}/.zshenv`, "utf-8");
    expect(content).toBe("# regular file");
  });
});

describe("createConfig", () => {
  test("creates config with correct paths", () => {
    const home = "/test/home";
    const config = createConfig(home);

    expect(config.home).toBe(home);
    expect(config.dotfiles).toBe(`${home}/.dotfiles`);
    expect(config.dotconfig).toBe(`${home}/.config`);
    expect(config.reviewedFile).toBe(`${home}/.dotfiles/.doctor-reviewed.json`);
  });

  test("links use home-relative paths", () => {
    const home = "/custom/home";
    const config = createConfig(home);

    // Check that links reference the custom home
    const sources = Object.keys(config.links);
    const targets = Object.values(config.links);

    expect(sources.every(s => s.startsWith(`${home}/.dotfiles/`))).toBe(true);
    expect(targets.every(t => t.startsWith(home))).toBe(true);
  });

  test("throws when HOME env not set and no home argument", () => {
    const originalHome = process.env.HOME;
    try {
      delete process.env.HOME;
      expect(() => createConfig()).toThrow("HOME environment variable is not set");
    } finally {
      process.env.HOME = originalHome;
    }
  });

  test("handles home with spaces", () => {
    const home = "/path with spaces/home";
    const config = createConfig(home);

    expect(config.home).toBe(home);
    expect(config.dotfiles).toBe(`${home}/.dotfiles`);
  });
});

// --- Symlink helper tests ---

describe("pathExists", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-pathexists-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("returns true for existing file", async () => {
    const file = `${tmpDir}/file.txt`;
    await writeFile(file, "content");
    expect(await pathExists(file)).toBe(true);
  });

  test("returns true for existing directory", async () => {
    const dir = `${tmpDir}/subdir`;
    await mkdir(dir);
    expect(await pathExists(dir)).toBe(true);
  });

  test("returns false for non-existent path", async () => {
    expect(await pathExists(`${tmpDir}/nonexistent`)).toBe(false);
  });

  test("returns true for valid symlink", async () => {
    const target = `${tmpDir}/target`;
    const link = `${tmpDir}/link`;
    await writeFile(target, "content");
    await symlink(target, link);
    expect(await pathExists(link)).toBe(true);
  });

  test("returns false for broken symlink", async () => {
    const link = `${tmpDir}/broken-link`;
    await symlink(`${tmpDir}/nonexistent`, link);
    expect(await pathExists(link)).toBe(false);
  });

  test("returns false for circular symlink (ELOOP)", async () => {
    const linkA = `${tmpDir}/link-a`;
    const linkB = `${tmpDir}/link-b`;
    await symlink(linkB, linkA);
    await symlink(linkA, linkB);
    // stat follows symlinks and will hit ELOOP
    expect(await pathExists(linkA)).toBe(false);
  });
});

describe("tryRealpath", () => {
  let tmpDir: string;
  let realTmpDir: string; // canonical path (on macOS /var -> /private/var)

  beforeEach(async () => {
    const { realpath } = await import("node:fs/promises");
    tmpDir = await mkdtemp(join(tmpdir(), "dot-realpath-"));
    realTmpDir = await realpath(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("returns canonical path for existing file", async () => {
    const file = `${tmpDir}/file.txt`;
    await writeFile(file, "content");
    expect(await tryRealpath(file)).toBe(`${realTmpDir}/file.txt`);
  });

  test("resolves symlink to target", async () => {
    const target = `${tmpDir}/target`;
    const link = `${tmpDir}/link`;
    await writeFile(target, "content");
    await symlink(target, link);
    expect(await tryRealpath(link)).toBe(`${realTmpDir}/target`);
  });

  test("returns null for non-existent path", async () => {
    expect(await tryRealpath(`${tmpDir}/nonexistent`)).toBeNull();
  });

  test("returns null for broken symlink", async () => {
    const link = `${tmpDir}/broken`;
    await symlink(`${tmpDir}/nonexistent`, link);
    expect(await tryRealpath(link)).toBeNull();
  });

  test("resolves path with .. components", async () => {
    const dir = `${tmpDir}/a/b`;
    await mkdir(dir, { recursive: true });
    const file = `${tmpDir}/a/file.txt`;
    await writeFile(file, "content");
    expect(await tryRealpath(`${tmpDir}/a/b/../file.txt`)).toBe(`${realTmpDir}/a/file.txt`);
  });
});

describe("resolveSymlinkTarget", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-symlink-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("resolves absolute symlink to normalized path", async () => {
    const target = `${tmpDir}/target`;
    const link = `${tmpDir}/link`;
    await writeFile(target, "content");
    await symlink(target, link);
    expect(await resolveSymlinkTarget(link)).toBe(target);
  });

  test("normalizes absolute symlink with .. components", async () => {
    const target = `${tmpDir}/a/../b/file`;
    const link = `${tmpDir}/link`;
    await mkdir(`${tmpDir}/b`);
    await writeFile(`${tmpDir}/b/file`, "content");
    await symlink(target, link);
    // Should be normalized to /tmp/xxx/b/file, not /tmp/xxx/a/../b/file
    const resolved = await resolveSymlinkTarget(link);
    expect(resolved).toBe(`${tmpDir}/b/file`);
    expect(resolved).not.toContain("..");
  });

  test("resolves relative symlink to absolute path", async () => {
    const target = `${tmpDir}/target`;
    const link = `${tmpDir}/link`;
    await writeFile(target, "content");
    await symlink("target", link); // relative
    expect(await resolveSymlinkTarget(link)).toBe(target);
  });

  test("resolves .. relative symlink correctly", async () => {
    await mkdir(`${tmpDir}/subdir`);
    const target = `${tmpDir}/target`;
    const link = `${tmpDir}/subdir/link`;
    await writeFile(target, "content");
    await symlink("../target", link);
    expect(await resolveSymlinkTarget(link)).toBe(target);
  });

  test("throws for non-symlink", async () => {
    const file = `${tmpDir}/regular-file`;
    await writeFile(file, "content");
    await expect(resolveSymlinkTarget(file)).rejects.toThrow();
  });

  test("throws for non-existent path", async () => {
    await expect(resolveSymlinkTarget(`${tmpDir}/nonexistent`)).rejects.toThrow();
  });
});

describe("linksToExpectedResolved", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-links-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("returns true for exact match", async () => {
    const file = `${tmpDir}/file`;
    await writeFile(file, "content");
    expect(await linksToExpectedResolved(file, file)).toBe(true);
  });

  test("returns true for same file via different paths", async () => {
    await mkdir(`${tmpDir}/a`);
    const file = `${tmpDir}/a/file`;
    await writeFile(file, "content");
    // Path with .. that resolves to the same location
    const altPath = `${tmpDir}/a/../a/file`;
    expect(await linksToExpectedResolved(file, altPath)).toBe(true);
  });

  test("returns false for different files", async () => {
    const file1 = `${tmpDir}/file1`;
    const file2 = `${tmpDir}/file2`;
    await writeFile(file1, "content1");
    await writeFile(file2, "content2");
    expect(await linksToExpectedResolved(file1, file2)).toBe(false);
  });

  test("falls back to string comparison when source doesn't exist", async () => {
    const resolved = `${tmpDir}/exists`;
    const expected = `${tmpDir}/nonexistent`;
    await writeFile(resolved, "content");
    // resolved exists (realpath succeeds), expected doesn't (realpath returns null)
    // Falls back to string comparison: resolved !== expected
    expect(await linksToExpectedResolved(resolved, expected)).toBe(false);
  });

  test("returns true for both non-existent but equal paths", async () => {
    const path = `${tmpDir}/nonexistent`;
    expect(await linksToExpectedResolved(path, path)).toBe(true);
  });
});

// --- Scanner tests ---

describe("isPathManaged", () => {
  test("returns true for direct match", () => {
    const targets = new Set(["/home/.zshenv", "/home/.config/zsh/.zshrc"]);
    expect(isPathManaged("/home/.zshenv", targets)).toBe(true);
  });

  test("returns true for parent of managed target", () => {
    const targets = new Set(["/home/.config/zsh/.zshrc"]);
    expect(isPathManaged("/home/.config/zsh", targets)).toBe(true);
  });

  test("returns false for unmanaged path", () => {
    const targets = new Set(["/home/.zshenv"]);
    expect(isPathManaged("/home/.gitconfig", targets)).toBe(false);
  });

  test("returns false for partial prefix match", () => {
    // /home/.config/zsh shouldn't match /home/.config/zshrc
    const targets = new Set(["/home/.config/zshrc"]);
    expect(isPathManaged("/home/.config/zsh", targets)).toBe(false);
  });
});

describe("getDotfiles", () => {
  let tmpDir: string;
  let config: Config;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-scanner-"));
    await mkdir(`${tmpDir}/.dotfiles`, { recursive: true });
    config = createConfig(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("returns empty array for empty home", async () => {
    const result = await getDotfiles(config);
    expect(result).toEqual([]);
  });

  test("includes .config when it exists (managed via config.links)", async () => {
    await mkdir(`${tmpDir}/.config`, { recursive: true });
    const result = await getDotfiles(config);
    const entry = result.find(e => e.path.endsWith(".config"));
    expect(entry?.type).toBe("directory");
    // isManaged is true because config.links contains paths under .config
    expect(entry?.isManaged).toBe(true);
  });

  test("returns files with correct type", async () => {
    await writeFile(`${tmpDir}/.gitconfig`, "content");
    const result = await getDotfiles(config);
    const entry = result.find(e => e.path.endsWith(".gitconfig"));
    expect(entry?.type).toBe("file");
  });

  test("returns directories with correct type", async () => {
    await mkdir(`${tmpDir}/.myapp`);
    const result = await getDotfiles(config);
    const entry = result.find(e => e.path.endsWith(".myapp"));
    expect(entry?.type).toBe("directory");
  });

  test("returns symlinks with target", async () => {
    await writeFile(`${tmpDir}/target`, "content");
    await symlink("target", `${tmpDir}/.symlink`);
    const result = await getDotfiles(config);
    const entry = result.find(e => e.path.endsWith(".symlink"));
    expect(entry?.type).toBe("symlink");
    expect(entry?.symlinkTarget).toBe("target");
  });

  test("isManaged true for managed targets", async () => {
    // .zshenv is a managed target in the config
    await writeFile(`${tmpDir}/.zshenv`, "content");
    const result = await getDotfiles(config);
    const entry = result.find(e => e.path.endsWith(".zshenv"));
    expect(entry?.isManaged).toBe(true);
  });

  test("isManaged true for parent dirs of managed targets", async () => {
    // .config/zsh contains .config/zsh/.zshrc which is managed
    await mkdir(`${tmpDir}/.config/zsh`, { recursive: true });
    const result = await getDotfiles(config);
    const entry = result.find(e => e.path.endsWith(".config/zsh"));
    expect(entry?.isManaged).toBe(true);
  });

  test("isManaged false for unmanaged entries", async () => {
    await writeFile(`${tmpDir}/.gitignore`, "content");
    const result = await getDotfiles(config);
    const entry = result.find(e => e.path.endsWith(".gitignore"));
    expect(entry?.isManaged).toBe(false);
  });

  test("skips exclusion list entries", async () => {
    await mkdir(`${tmpDir}/.cache`);
    await mkdir(`${tmpDir}/.npm`);
    await writeFile(`${tmpDir}/.DS_Store`, "");
    await writeFile(`${tmpDir}/.bash_history`, "");
    await writeFile(`${tmpDir}/.zsh_history`, "");
    const result = await getDotfiles(config);
    expect(result.find(e => e.path.includes(".cache"))).toBeUndefined();
    expect(result.find(e => e.path.includes(".npm"))).toBeUndefined();
    expect(result.find(e => e.path.includes(".DS_Store"))).toBeUndefined();
    expect(result.find(e => e.path.includes(".bash_history"))).toBeUndefined();
    expect(result.find(e => e.path.includes(".zsh_history"))).toBeUndefined();
  });

  test("includes ~/.config subdirectories", async () => {
    await mkdir(`${tmpDir}/.config/unmanaged-app`, { recursive: true });
    const result = await getDotfiles(config);
    const entry = result.find(e => e.path.includes("unmanaged-app"));
    expect(entry).toBeDefined();
    expect(entry?.type).toBe("directory");
    expect(entry?.isManaged).toBe(false);
  });

  test("returns sorted results", async () => {
    await writeFile(`${tmpDir}/.zzz`, "");
    await writeFile(`${tmpDir}/.aaa`, "");
    const result = await getDotfiles(config);
    const paths = result.map(e => e.path);
    const aIdx = paths.findIndex(p => p.endsWith(".aaa"));
    const zIdx = paths.findIndex(p => p.endsWith(".zzz"));
    expect(aIdx).toBeLessThan(zIdx);
  });

  test("includes size for files", async () => {
    const content = "12345";
    await writeFile(`${tmpDir}/.file`, content);
    const result = await getDotfiles(config);
    const entry = result.find(e => e.path.endsWith(".file"));
    expect(entry?.size).toBe(content.length);
  });

  test("includes lastModified", async () => {
    await writeFile(`${tmpDir}/.file`, "content");
    const result = await getDotfiles(config);
    const entry = result.find(e => e.path.endsWith(".file"));
    expect(entry?.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("handles broken symlink", async () => {
    await symlink("nonexistent", `${tmpDir}/.broken-link`);
    const result = await getDotfiles(config);
    const entry = result.find(e => e.path.endsWith(".broken-link"));
    expect(entry?.type).toBe("symlink");
    expect(entry?.symlinkTarget).toBe("nonexistent");
  });

  test("ignores non-dotfiles", async () => {
    await writeFile(`${tmpDir}/regular-file`, "content");
    const result = await getDotfiles(config);
    expect(result.find(e => e.path.includes("regular-file"))).toBeUndefined();
  });

});

// --- Install edge cases ---

describe("install edge cases", () => {
  let tmpDir: string;
  let config: Config;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-install-edge-"));
    await mkdir(`${tmpDir}/.dotfiles/zsh`, { recursive: true });
    config = createConfig(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("skips link when source file does not exist", async () => {
    // Don't create source files - install should skip
    await install(config);
    const status = await getSymlinkStatus(config);
    // All should be missing since sources don't exist
    expect(status.every(s => s.status === "missing")).toBe(true);
  });

  test("does not overwrite existing regular files", async () => {
    // Create source file
    await writeFile(`${tmpDir}/.dotfiles/zsh/zshenv`, "source");
    // Create target as regular file
    await writeFile(`${tmpDir}/.zshenv`, "existing content");

    await install(config);

    // The regular file should still exist with original content
    const content = await readFile(`${tmpDir}/.zshenv`, "utf-8");
    expect(content).toBe("existing content");
  });

  test("creates parent directories for nested targets", async () => {
    // Create source
    await mkdir(`${tmpDir}/.dotfiles/git`, { recursive: true });
    await writeFile(`${tmpDir}/.dotfiles/git/.gitconfig`, "config");

    await install(config);

    // Check that .config/git was created
    const gitDir = `${tmpDir}/.config/git`;
    expect(await pathExists(gitDir)).toBe(true);
  });
});

describe("special path handling", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dot-special-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("handles files with spaces in names", async () => {
    const file = `${tmpDir}/file with spaces.txt`;
    await writeFile(file, "content");
    expect(await pathExists(file)).toBe(true);
  });

  test("handles unicode filenames", async () => {
    const file = `${tmpDir}/文件.txt`;
    await writeFile(file, "content");
    expect(await pathExists(file)).toBe(true);
  });
});
