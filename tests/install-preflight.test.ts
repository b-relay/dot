import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  parseInstallArgs,
  preflightCheck,
  checkDependencies,
  type DependencyStatus,
  type DotConfig,
} from "../index";

// Test config with dependencies
const TEST_CONFIG: DotConfig = {
  links: {},
  autoCommit: true,
  dependencies: [
    { name: "brew", required: true, brewPackage: "homebrew", description: "Homebrew package manager" },
    { name: "starship", required: true, brewPackage: "starship", description: "Cross-shell prompt" },
  ],
};

const EMPTY_CONFIG: DotConfig = {
  links: {},
  autoCommit: true,
};

describe("parseInstallArgs", () => {
  // Save original Bun.argv
  const originalArgv = [...Bun.argv];

  afterEach(() => {
    // Restore original argv
    (Bun as any).argv = originalArgv;
  });

  test("returns force: false with no flags", () => {
    (Bun as any).argv = ["/path/to/bun", "/path/to/script", "install"];
    const result = parseInstallArgs();
    expect(result.force).toBe(false);
  });

  test("returns force: true with --force flag", () => {
    (Bun as any).argv = ["/path/to/bun", "/path/to/script", "install", "--force"];
    const result = parseInstallArgs();
    expect(result.force).toBe(true);
  });

  test("returns force: true with -f short flag", () => {
    (Bun as any).argv = ["/path/to/bun", "/path/to/script", "install", "-f"];
    const result = parseInstallArgs();
    expect(result.force).toBe(true);
  });

  test("handles extra positional arguments", () => {
    (Bun as any).argv = ["/path/to/bun", "/path/to/script", "install", "--force", "extra"];
    const result = parseInstallArgs();
    expect(result.force).toBe(true);
  });
});

describe("preflightCheck", () => {
  test("returns true when force is true", async () => {
    const result = await preflightCheck(true, TEST_CONFIG);
    expect(result).toBe(true);
  });

  test("returns true when no dependencies configured", async () => {
    const result = await preflightCheck(false, EMPTY_CONFIG);
    expect(result).toBe(true);
  });

  test("returns true when all required deps are installed", async () => {
    // This test runs against real system state
    // If test fails, it means required deps are actually missing
    const deps = await checkDependencies(TEST_CONFIG.dependencies ?? []);
    const missingRequired = deps.filter((d: DependencyStatus) => d.required && !d.installed);

    // Only test preflightCheck if all required deps are installed
    if (missingRequired.length === 0) {
      const result = await preflightCheck(false, TEST_CONFIG);
      expect(result).toBe(true);
    }
  });
});

describe("preflightCheck output", () => {
  // Note: preflightCheck uses @clack/prompts p.log.warn() which doesn't
  // go through console.log, so we just verify the return value
  test("returns true immediately when force is true", async () => {
    const result = await preflightCheck(true, TEST_CONFIG);
    expect(result).toBe(true);
  });
});
