import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import {
  parseInstallArgs,
  preflightCheck,
  checkDependencies,
  type DependencyStatus,
} from "../index";

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
    const result = await preflightCheck(true);
    expect(result).toBe(true);
  });

  test("returns true when all required deps are installed", async () => {
    // This test runs against real system state
    // If test fails, it means required deps are actually missing
    const deps = await checkDependencies();
    const missingRequired = deps.filter(d => d.required && !d.installed);

    // Only test preflightCheck if all required deps are installed
    if (missingRequired.length === 0) {
      const result = await preflightCheck(false);
      expect(result).toBe(true);
    }
  });
});

describe("preflightCheck output", () => {
  let consoleErrorOutput: string[] = [];
  let consoleLogOutput: string[] = [];
  const originalError = console.error;
  const originalLog = console.log;

  beforeEach(() => {
    consoleErrorOutput = [];
    consoleLogOutput = [];
    console.error = (...args: any[]) => {
      consoleErrorOutput.push(args.map(String).join(" "));
    };
    console.log = (...args: any[]) => {
      consoleLogOutput.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.error = originalError;
    console.log = originalLog;
  });

  test("prints warning when force is true", async () => {
    await preflightCheck(true);
    expect(consoleLogOutput.some(line => line.includes("Bypassing dependency check"))).toBe(true);
  });
});
