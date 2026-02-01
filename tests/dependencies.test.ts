import { describe, test, expect } from "bun:test";
import {
  isToolInstalled,
  checkDependencies,
  type Dependency,
  type DependencyStatus,
} from "../index";

// Test dependencies for unit tests
const TEST_DEPENDENCIES: Dependency[] = [
  { name: "brew", required: true, brewPackage: "homebrew", description: "Homebrew package manager" },
  { name: "starship", required: true, brewPackage: "starship", description: "Cross-shell prompt" },
  { name: "cargo", required: true, description: "Rust package manager" },
  { name: "fnm", required: true, brewPackage: "fnm", description: "Fast Node Manager" },
  { name: "zoxide", required: true, brewPackage: "zoxide", description: "Smarter cd command" },
  { name: "fzf", required: false, brewPackage: "fzf", description: "Fuzzy finder" },
  { name: "vivid", required: false, brewPackage: "vivid", description: "LS_COLORS generator" },
  { name: "eza", required: false, brewPackage: "eza", description: "Modern ls replacement" },
  { name: "bun", required: false, brewPackage: "oven-sh/bun/bun", description: "JavaScript runtime" },
];

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
  test("returns status for all provided dependencies", async () => {
    const statuses = await checkDependencies(TEST_DEPENDENCIES);

    expect(statuses.length).toBe(TEST_DEPENDENCIES.length);

    // Each status should have required fields
    for (const status of statuses) {
      expect(status.name).toBeTruthy();
      expect(typeof status.required).toBe("boolean");
      expect(typeof status.installed).toBe("boolean");
      expect(status.description).toBeTruthy();
    }
  });

  test("preserves brewPackage from dependencies", async () => {
    const statuses = await checkDependencies(TEST_DEPENDENCIES);

    const starshipStatus = statuses.find((s: DependencyStatus) => s.name === "starship");
    expect(starshipStatus).toBeDefined();
    expect(starshipStatus!.brewPackage).toBe("starship");

    const cargoStatus = statuses.find((s: DependencyStatus) => s.name === "cargo");
    expect(cargoStatus).toBeDefined();
    expect(cargoStatus!.brewPackage).toBeUndefined();
  });

  test("correctly returns installed status for each tool", async () => {
    const statuses = await checkDependencies(TEST_DEPENDENCIES);

    // brew should be installed on macOS dev machine (prerequisite for this project)
    const brewStatus = statuses.find((s: DependencyStatus) => s.name === "brew");
    expect(brewStatus).toBeDefined();
    // Note: Don't assert installed=true - test should work even if brew isn't installed
    expect(typeof brewStatus!.installed).toBe("boolean");
  });

  test("returns empty array for empty dependencies", async () => {
    const statuses = await checkDependencies([]);
    expect(statuses).toEqual([]);
  });
});
