import { describe, expect, test } from "bun:test";
import {
  convertEffectiveLinksToPortable,
  normalizeCustomPatterns,
} from "../src/config-ui";
import { parseSyncArgs } from "../index";

describe("convertEffectiveLinksToPortable", () => {
  const dotfilesPath = "/Users/test/.dotfiles";
  const home = "/Users/test";

  test("converts absolute sources under dotfiles root to relative keys", () => {
    const links = {
      "/Users/test/.dotfiles/zsh/zshrc": "~/.config/zsh/.zshrc",
    };
    const out = convertEffectiveLinksToPortable(links, dotfilesPath, home);
    expect(out).toEqual({
      "zsh/zshrc": "~/.config/zsh/.zshrc",
    });
  });

  test("converts HOME-absolute targets to ~ targets", () => {
    const links = {
      "zsh/zshrc": "/Users/test/.config/zsh/.zshrc",
    };
    const out = convertEffectiveLinksToPortable(links, dotfilesPath, home);
    expect(out["zsh/zshrc"]).toBe("~/.config/zsh/.zshrc");
  });

  test("leaves non-HOME absolute targets unchanged", () => {
    const links = {
      "misc/hosts": "/etc/hosts",
    };
    const out = convertEffectiveLinksToPortable(links, dotfilesPath, home);
    expect(out["misc/hosts"]).toBe("/etc/hosts");
  });

  test("leaves absolute sources outside dotfiles root unchanged", () => {
    const links = {
      "/tmp/somewhere/file": "/Users/test/.config/app/config",
    };
    const out = convertEffectiveLinksToPortable(links, dotfilesPath, home);
    expect(out["/tmp/somewhere/file"]).toBe("~/.config/app/config");
  });
});

describe("normalizeCustomPatterns", () => {
  test("removes an emptied low-value list while preserving high-value patterns", () => {
    expect(normalizeCustomPatterns(undefined, ["important"])).toEqual({
      highValue: ["important"],
    });
  });
});

describe("parseSyncArgs", () => {
  test("accepts no args", () => {
    expect(parseSyncArgs([])).toEqual({ ok: true });
  });

  test("accepts the global --dotfiles option after sync", () => {
    expect(parseSyncArgs(["--dotfiles", "/tmp/dotfiles"])).toEqual({ ok: true });
  });

  test("rejects legacy sync config positional", () => {
    const r = parseSyncArgs(["config"]);
    expect(r.ok).toBe(false);
  });

  test("rejects --config", () => {
    const r = parseSyncArgs(["--config"]);
    expect(r.ok).toBe(false);
  });

  test("rejects unknown positional", () => {
    const r = parseSyncArgs(["foo"]);
    expect(r.ok).toBe(false);
  });

  test("rejects unknown flag", () => {
    const r = parseSyncArgs(["--foo"]);
    expect(r.ok).toBe(false);
  });
});
