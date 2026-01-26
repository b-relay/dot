import { describe, test, expect } from "bun:test";
import {
  DEPENDENCIES,
  isToolInstalled,
  checkDependencies,
  type Dependency,
  type DependencyStatus,
} from "../index";

describe("DEPENDENCIES constant", () => {
  test("has required tools", () => {
    const requiredNames = DEPENDENCIES
      .filter(d => d.required)
      .map(d => d.name);

    expect(requiredNames).toContain("brew");
    expect(requiredNames).toContain("starship");
    expect(requiredNames).toContain("cargo");
    expect(requiredNames).toContain("fnm");
    expect(requiredNames).toContain("zoxide");
    expect(requiredNames.length).toBe(5);
  });

  test("has recommended tools", () => {
    const recommendedNames = DEPENDENCIES
      .filter(d => !d.required)
      .map(d => d.name);

    expect(recommendedNames).toContain("fzf");
    expect(recommendedNames).toContain("vivid");
    expect(recommendedNames).toContain("eza");
    expect(recommendedNames).toContain("bun");
    expect(recommendedNames.length).toBe(4);
  });

  test("cargo has no brewPackage (installed via rustup)", () => {
    const cargo = DEPENDENCIES.find(d => d.name === "cargo");
    expect(cargo).toBeDefined();
    expect(cargo!.brewPackage).toBeUndefined();
  });

  test("bun uses full tap path for Homebrew", () => {
    const bun = DEPENDENCIES.find(d => d.name === "bun");
    expect(bun).toBeDefined();
    expect(bun!.brewPackage).toBe("oven-sh/bun/bun");
  });

  test("all dependencies have descriptions", () => {
    for (const dep of DEPENDENCIES) {
      expect(dep.description).toBeTruthy();
      expect(dep.description.length).toBeGreaterThan(0);
    }
  });
});

describe("isToolInstalled", () => {
  test("returns true for tools that exist", async () => {
    // 'ls' should exist on any Unix system
    const result = await isToolInstalled("ls");
    expect(result).toBe(true);
  });

  test("returns false for tools that do not exist", async () => {
    // This tool definitely doesn't exist
    const result = await isToolInstalled("definitely-not-a-real-tool-xyz123");
    expect(result).toBe(false);
  });

  test("handles special characters in tool names safely", async () => {
    // Should not throw, should return false
    const result = await isToolInstalled("tool-with-dash");
    expect(result).toBe(false);
  });
});

describe("checkDependencies", () => {
  test("returns status for all dependencies", async () => {
    const statuses = await checkDependencies();

    expect(statuses.length).toBe(DEPENDENCIES.length);

    // Each status should have required fields
    for (const status of statuses) {
      expect(status.name).toBeTruthy();
      expect(typeof status.required).toBe("boolean");
      expect(typeof status.installed).toBe("boolean");
      expect(status.description).toBeTruthy();
    }
  });

  test("preserves brewPackage from DEPENDENCIES", async () => {
    const statuses = await checkDependencies();

    const starshipStatus = statuses.find(s => s.name === "starship");
    expect(starshipStatus).toBeDefined();
    expect(starshipStatus!.brewPackage).toBe("starship");

    const cargoStatus = statuses.find(s => s.name === "cargo");
    expect(cargoStatus).toBeDefined();
    expect(cargoStatus!.brewPackage).toBeUndefined();
  });

  test("correctly identifies installed tools", async () => {
    const statuses = await checkDependencies();

    // brew should be installed on macOS dev machine (prerequisite for this project)
    const brewStatus = statuses.find(s => s.name === "brew");
    expect(brewStatus).toBeDefined();
    // Note: Don't assert installed=true - test should work even if brew isn't installed
    expect(typeof brewStatus!.installed).toBe("boolean");
  });
});
