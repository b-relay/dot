import { describe, expect, test } from "bun:test";
import {
  normalizePath,
  isIgnored,
  getActiveReviewed,
  getExpiredPaths,
  getReviewedFilePath,
  filterBrewfile,
  type ReviewedEntry,
  type ReviewedPaths,
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

describe("isIgnored", () => {
  // Use fixed reference date to avoid timezone/midnight flakiness
  const fixedNow = new Date("2024-06-15T12:00:00Z");

  test("returns true for forever entry", () => {
    const entry: ReviewedEntry = { type: 'forever' };
    expect(isIgnored(entry, fixedNow)).toBe(true);
  });

  test("returns true for timed entry not yet expired", () => {
    // Entry expires tomorrow (June 16)
    const entry: ReviewedEntry = { type: 'timed', expiresAt: '2024-06-16' };
    expect(isIgnored(entry, fixedNow)).toBe(true);
  });

  test("returns true for timed entry expiring far in future", () => {
    const entry: ReviewedEntry = { type: 'timed', expiresAt: '2025-01-01' };
    expect(isIgnored(entry, fixedNow)).toBe(true);
  });

  test("returns false for timed entry that has expired", () => {
    // Entry expired yesterday (June 14)
    const entry: ReviewedEntry = { type: 'timed', expiresAt: '2024-06-14' };
    expect(isIgnored(entry, fixedNow)).toBe(false);
  });

  test("returns false for timed entry expiring today (edge case)", () => {
    // Entry expires today (June 15) - should be considered expired
    // Because expiresAt > today is false when they're equal
    const entry: ReviewedEntry = { type: 'timed', expiresAt: '2024-06-15' };
    expect(isIgnored(entry, fixedNow)).toBe(false);
  });

  test("returns false for very old expiry date", () => {
    const entry: ReviewedEntry = { type: 'timed', expiresAt: '2020-01-01' };
    expect(isIgnored(entry, fixedNow)).toBe(false);
  });
});

describe("getActiveReviewed", () => {
  test("filters out expired entries", () => {
    const now = new Date("2024-06-15T12:00:00Z");
    const paths: ReviewedPaths = {
      "/path/active": { type: 'timed', expiresAt: '2024-06-20' },
      "/path/expired": { type: 'timed', expiresAt: '2024-06-10' },
      "/path/forever": { type: 'forever' },
    };

    // Mock Date to use fixedNow - since getActiveReviewed creates its own Date
    const originalDate = globalThis.Date;
    globalThis.Date = class extends originalDate {
      constructor() {
        super();
        return now;
      }
      static now() { return now.getTime(); }
    } as any;

    try {
      const active = getActiveReviewed(paths);
      expect(Object.keys(active)).toHaveLength(2);
      expect(active["/path/active"]).toBeDefined();
      expect(active["/path/forever"]).toBeDefined();
      expect(active["/path/expired"]).toBeUndefined();
    } finally {
      globalThis.Date = originalDate;
    }
  });

  test("returns empty object when all expired", () => {
    const now = new Date("2024-06-15T12:00:00Z");
    const paths: ReviewedPaths = {
      "/path/a": { type: 'timed', expiresAt: '2024-06-01' },
      "/path/b": { type: 'timed', expiresAt: '2024-06-10' },
    };

    const originalDate = globalThis.Date;
    globalThis.Date = class extends originalDate {
      constructor() {
        super();
        return now;
      }
      static now() { return now.getTime(); }
    } as any;

    try {
      const active = getActiveReviewed(paths);
      expect(Object.keys(active)).toHaveLength(0);
    } finally {
      globalThis.Date = originalDate;
    }
  });

  test("returns all entries when none expired", () => {
    const now = new Date("2024-06-15T12:00:00Z");
    const paths: ReviewedPaths = {
      "/path/a": { type: 'timed', expiresAt: '2024-06-20' },
      "/path/b": { type: 'forever' },
    };

    const originalDate = globalThis.Date;
    globalThis.Date = class extends originalDate {
      constructor() {
        super();
        return now;
      }
      static now() { return now.getTime(); }
    } as any;

    try {
      const active = getActiveReviewed(paths);
      expect(Object.keys(active)).toHaveLength(2);
    } finally {
      globalThis.Date = originalDate;
    }
  });
});

describe("getExpiredPaths", () => {
  test("returns only expired paths", () => {
    const now = new Date("2024-06-15T12:00:00Z");
    const paths: ReviewedPaths = {
      "/path/active": { type: 'timed', expiresAt: '2024-06-20' },
      "/path/expired1": { type: 'timed', expiresAt: '2024-06-10' },
      "/path/expired2": { type: 'timed', expiresAt: '2024-06-01' },
      "/path/forever": { type: 'forever' },
    };

    const originalDate = globalThis.Date;
    globalThis.Date = class extends originalDate {
      constructor() {
        super();
        return now;
      }
      static now() { return now.getTime(); }
    } as any;

    try {
      const expired = getExpiredPaths(paths);
      expect(expired).toHaveLength(2);
      expect(expired).toContain("/path/expired1");
      expect(expired).toContain("/path/expired2");
      expect(expired).not.toContain("/path/active");
      expect(expired).not.toContain("/path/forever");
    } finally {
      globalThis.Date = originalDate;
    }
  });

  test("returns empty array when no expired", () => {
    const now = new Date("2024-06-15T12:00:00Z");
    const paths: ReviewedPaths = {
      "/path/a": { type: 'timed', expiresAt: '2024-06-20' },
      "/path/b": { type: 'forever' },
    };

    const originalDate = globalThis.Date;
    globalThis.Date = class extends originalDate {
      constructor() {
        super();
        return now;
      }
      static now() { return now.getTime(); }
    } as any;

    try {
      const expired = getExpiredPaths(paths);
      expect(expired).toHaveLength(0);
    } finally {
      globalThis.Date = originalDate;
    }
  });
});

describe("getReviewedFilePath", () => {
  test("returns XDG path under ~/.config/dot", () => {
    const path = getReviewedFilePath();
    expect(path).toContain("/.config/dot/reviewed.json");
    expect(path).toMatch(/^\/.*\/\.config\/dot\/reviewed\.json$/);
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
