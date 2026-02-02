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
  test("filters vscode lines from brew output (default excludes)", () => {
    const brewOutput = `tap "homebrew/bundle"
brew "git"
vscode "ms-vscode.go"
vscode "esbenp.prettier-vscode"
brew "tmux"
cask "firefox"`;

    const filtered = filterBrewfile(brewOutput);

    expect(filtered).toBe(`tap "homebrew/bundle"
brew "git"
brew "tmux"
cask "firefox"`);
  });

  test("filters custom exclude list", () => {
    const brewOutput = `tap "homebrew/bundle"
brew "git"
vscode "extension"
mas "Xcode", id: 497799835
whalebrew "tool"
cask "firefox"`;

    // Custom exclude list
    const filtered = filterBrewfile(brewOutput, ["vscode", "mas", "whalebrew"]);

    expect(filtered).toBe(`tap "homebrew/bundle"
brew "git"
cask "firefox"`);
  });

  test("preserves brew packages with similar names", () => {
    const brewOutput = `brew "vscode-helper"
brew "go"
brew "golang"`;

    const filtered = filterBrewfile(brewOutput);

    // All lines should be preserved - these are brew packages, not vscode lines
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
	mas "tabbed"
brew "normal"`;
    // Lines with leading whitespace are still filtered (trimStart is used)
    expect(filterBrewfile(input, ["vscode", "mas"])).toBe("brew \"normal\"");
  });

  test("handles input with only filtered lines", () => {
    const input = `vscode "a"
vscode "b"`;
    expect(filterBrewfile(input)).toBe("");
  });

  test("case insensitive matching", () => {
    const input = `Vscode "upper"
VSCODE "allcaps"
MAS "upper"`;
    // Case-insensitive matching filters all variations
    expect(filterBrewfile(input, ["vscode", "mas"])).toBe("");
  });

  test("empty exclude list preserves all lines", () => {
    const input = `vscode "a"
mas "b"
brew "c"`;
    expect(filterBrewfile(input, [])).toBe(input);
  });
});
