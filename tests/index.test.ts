import { describe, expect, test } from "bun:test";
import {
  normalizePath,
  isReviewedRecently,
  getExpiryDate,
  filterBrewfile,
  REVIEW_EXPIRY_DAYS,
} from "../index";

describe("normalizePath", () => {
  const home = "/home/testuser";

  test("expands bare ~ to home", () => {
    expect(normalizePath(home, "~")).toBe(home);
  });

  test("expands ~/ to home directory", () => {
    expect(normalizePath(home, "~/test")).toBe(`${home}/test`);
    expect(normalizePath(home, "~/.config/app")).toBe(`${home}/.config/app`);
  });

  test("resolves relative paths against home", () => {
    expect(normalizePath(home, "./config")).toBe(`${home}/config`);
    expect(normalizePath(home, "config/file")).toBe(`${home}/config/file`);
  });

  test("preserves absolute paths", () => {
    expect(normalizePath(home, "/usr/local/bin")).toBe("/usr/local/bin");
    expect(normalizePath(home, "/other/path")).toBe("/other/path");
  });

  // Edge cases
  test("normalizes paths with .. components", () => {
    expect(normalizePath(home, "~/foo/../bar")).toBe(`${home}/bar`);
    expect(normalizePath(home, "/usr/local/../bin")).toBe("/usr/bin");
  });

  test("normalizes paths with . components", () => {
    expect(normalizePath(home, "~/./config")).toBe(`${home}/config`);
    expect(normalizePath(home, "/usr/./local/bin")).toBe("/usr/local/bin");
  });

  test("handles trailing slashes", () => {
    // resolve() normalizes trailing slashes away
    expect(normalizePath(home, "~/config/")).toBe(`${home}/config`);
    expect(normalizePath(home, "/usr/local/")).toBe("/usr/local");
  });

  test("handles paths with spaces", () => {
    expect(normalizePath(home, "~/my config")).toBe(`${home}/my config`);
    expect(normalizePath(home, "/path with spaces/file")).toBe(
      "/path with spaces/file",
    );
  });

  test("handles unicode in paths", () => {
    expect(normalizePath(home, "~/文档")).toBe(`${home}/文档`);
    expect(normalizePath(home, "/tmp/émoji🎉")).toBe("/tmp/émoji🎉");
  });

  test("empty string resolves to home", () => {
    expect(normalizePath(home, "")).toBe(home);
  });

  test("~user/foo treated as relative path (no shell expansion)", () => {
    // ~user is NOT expanded - only ~ and ~/ are special
    expect(normalizePath(home, "~user/foo")).toBe(`${home}/~user/foo`);
  });
});

describe("isReviewedRecently", () => {
  // Use fixed reference date to avoid timezone/midnight flakiness
  const fixedNow = new Date("2024-06-15T12:00:00Z");

  test("returns true for date within expiry window", () => {
    expect(isReviewedRecently("2024-06-15", fixedNow)).toBe(true);
  });

  test("returns true for date 89 days ago", () => {
    expect(isReviewedRecently("2024-03-18", fixedNow)).toBe(true); // 89 days before June 15
  });

  test("returns false for date exactly at expiry", () => {
    expect(isReviewedRecently("2024-03-17", fixedNow)).toBe(false); // 90 days before June 15
  });

  test("returns false for date beyond expiry window", () => {
    expect(isReviewedRecently("2024-03-16", fixedNow)).toBe(false); // 91 days before June 15
  });

  test("returns false for very old date", () => {
    expect(isReviewedRecently("2020-01-01", fixedNow)).toBe(false);
  });
});

describe("getExpiryDate", () => {
  test("returns date 90 days after review date", () => {
    expect(getExpiryDate("2024-01-01")).toBe("2024-03-31");
  });

  test("handles month boundaries", () => {
    expect(getExpiryDate("2024-11-01")).toBe("2025-01-30");
  });

  test("handles leap year", () => {
    expect(getExpiryDate("2024-02-29")).toBe("2024-05-29");
  });

  test("calculates correctly from today", () => {
    const today = new Date();
    const expected = new Date(today);
    expected.setDate(expected.getDate() + REVIEW_EXPIRY_DAYS);
    const expectedStr = expected.toISOString().split("T")[0]!;
    const todayStr = today.toISOString().split("T")[0]!;
    expect(getExpiryDate(todayStr)).toBe(expectedStr);
  });
});

describe("REVIEW_EXPIRY_DAYS", () => {
  test("is 90 days", () => {
    expect(REVIEW_EXPIRY_DAYS).toBe(90);
  });
});

describe("filterBrewfile", () => {
  test("filters vscode, cargo, and go lines from brew output", () => {
    const brewOutput = `tap "homebrew/bundle"
brew "git"
vscode "ms-vscode.go"
cargo "ripgrep"
go "golang.org/x/tools"
brew "tmux"
cask "firefox"`;

    const filtered = filterBrewfile(brewOutput);

    expect(filtered).toBe(`tap "homebrew/bundle"
brew "git"
brew "tmux"
cask "firefox"`);
  });

  test("preserves lines with similar prefixes", () => {
    const brewOutput = `brew "vscode-helper"
brew "cargo-watch"
brew "golang"`;

    const filtered = filterBrewfile(brewOutput);

    // All lines should be preserved (they don't start with excluded patterns)
    expect(filtered).toBe(brewOutput);
  });

  // Edge cases
  test("handles empty string", () => {
    expect(filterBrewfile("")).toBe("");
  });

  test("handles single newline", () => {
    expect(filterBrewfile("\n")).toBe("\n");
  });

  test("handles lines with leading whitespace", () => {
    const input = `  vscode "indented"
	cargo "tabbed"
brew "normal"`;
    // Lines with leading whitespace are still filtered (trimStart is used)
    expect(filterBrewfile(input)).toBe("brew \"normal\"");
  });

  test("handles input with only filtered lines", () => {
    const input = `vscode "a"
cargo "b"
go "c"`;
    expect(filterBrewfile(input)).toBe("");
  });

  test("case sensitive - does NOT filter uppercase", () => {
    const input = `Vscode "upper"
CARGO "upper"
GO "upper"`;
    // Uppercase prefixes should be preserved (unlikely but testing case sensitivity)
    expect(filterBrewfile(input)).toBe(input);
  });
});
