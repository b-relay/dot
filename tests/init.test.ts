import { describe, expect, test } from "bun:test";
import { parseInitArgs } from "../src/init";

describe("parseInitArgs", () => {
  test("returns empty options for no args", () => {
    const options = parseInitArgs([]);
    expect(options).toEqual({});
  });

  test("parses --from flag", () => {
    const options = parseInitArgs(["--from", "/path/to/dotfiles"]);
    expect(options.from).toBe("/path/to/dotfiles");
  });

  test("parses --force flag", () => {
    const options = parseInitArgs(["--force"]);
    expect(options.force).toBe(true);
  });

  test("parses -f short flag", () => {
    const options = parseInitArgs(["-f"]);
    expect(options.force).toBe(true);
  });

  test("parses --dry-run flag", () => {
    const options = parseInitArgs(["--dry-run"]);
    expect(options.dryRun).toBe(true);
  });

  test("parses single --ignore flag", () => {
    const options = parseInitArgs(["--ignore", ".cache"]);
    expect(options.ignore).toEqual([".cache"]);
  });

  test("parses multiple --ignore flags", () => {
    const options = parseInitArgs(["--ignore", ".cache", "--ignore", ".tmp"]);
    expect(options.ignore).toEqual([".cache", ".tmp"]);
  });

  test("parses all flags together", () => {
    const options = parseInitArgs([
      "--from", "/path/to/dotfiles",
      "--force",
      "--dry-run",
      "--ignore", ".cache",
      "--ignore", ".tmp",
    ]);
    expect(options.from).toBe("/path/to/dotfiles");
    expect(options.force).toBe(true);
    expect(options.dryRun).toBe(true);
    expect(options.ignore).toEqual([".cache", ".tmp"]);
  });

  test("ignores unknown flags", () => {
    const options = parseInitArgs(["--unknown", "value"]);
    expect(options).toEqual({});
  });
});
