import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadState,
  saveState,
  createInitialState,
  markStepComplete,
  isStepComplete,
  type InstallState,
} from "../src/lib/state";

describe("state tracking", () => {
  let tempDir: string;
  let statePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "dot-state-test-"));
    statePath = join(tempDir, ".install-state.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("loadState returns null for non-existent file", async () => {
    const state = await loadState(statePath);
    expect(state).toBeNull();
  });

  test("loadState returns parsed state for existing file", async () => {
    const mockState: InstallState = {
      version: "1",
      startedAt: "2026-01-27T00:00:00.000Z",
      completedSteps: ["step1", "step2"],
      totalSteps: 5,
      status: "in-progress",
    };

    await saveState(statePath, mockState);
    const loaded = await loadState(statePath);

    expect(loaded).toEqual(mockState);
  });

  test("saveState + loadState roundtrip preserves data", async () => {
    const originalState: InstallState = {
      version: "1",
      startedAt: "2026-01-27T12:34:56.789Z",
      completedSteps: ["symlink:/Users/test/.zshenv", "symlink:/Users/test/.zshrc"],
      totalSteps: 10,
      status: "in-progress",
    };

    await saveState(statePath, originalState);
    const roundtripped = await loadState(statePath);

    expect(roundtripped).toEqual(originalState);
    expect(roundtripped?.completedSteps).toHaveLength(2);
    expect(roundtripped?.totalSteps).toBe(10);
  });

  test("createInitialState sets correct initial values", () => {
    const state = createInitialState(8);

    expect(state.version).toBe("1");
    expect(state.completedSteps).toEqual([]);
    expect(state.totalSteps).toBe(8);
    expect(state.status).toBe("in-progress");
    expect(state.startedAt).toBeDefined();
    // Verify startedAt is a valid ISO timestamp
    expect(new Date(state.startedAt).toISOString()).toBe(state.startedAt);
  });

  test("markStepComplete adds step to completedSteps (immutably)", () => {
    const initial = createInitialState(5);
    const updated = markStepComplete(initial, "step1");

    // Original state unchanged (immutable)
    expect(initial.completedSteps).toEqual([]);
    // New state has step
    expect(updated.completedSteps).toEqual(["step1"]);
    expect(updated.totalSteps).toBe(5);
    expect(updated.status).toBe("in-progress");
  });

  test("markStepComplete is idempotent (adding same step twice is safe)", () => {
    const initial = createInitialState(3);
    const updated1 = markStepComplete(initial, "step1");
    const updated2 = markStepComplete(updated1, "step1");

    // Should still have only one instance of step1
    expect(updated2.completedSteps).toEqual(["step1"]);
    expect(updated2.completedSteps).toHaveLength(1);
  });

  test("markStepComplete multiple steps", () => {
    let state = createInitialState(4);
    state = markStepComplete(state, "symlink:/Users/test/.zshenv");
    state = markStepComplete(state, "symlink:/Users/test/.zshrc");
    state = markStepComplete(state, "symlink:/Users/test/.config/starship.toml");

    expect(state.completedSteps).toEqual([
      "symlink:/Users/test/.zshenv",
      "symlink:/Users/test/.zshrc",
      "symlink:/Users/test/.config/starship.toml",
    ]);
    expect(state.completedSteps).toHaveLength(3);
  });

  test("isStepComplete returns true for completed steps", () => {
    let state = createInitialState(3);
    state = markStepComplete(state, "step1");
    state = markStepComplete(state, "step2");

    expect(isStepComplete(state, "step1")).toBe(true);
    expect(isStepComplete(state, "step2")).toBe(true);
  });

  test("isStepComplete returns false for incomplete steps", () => {
    let state = createInitialState(3);
    state = markStepComplete(state, "step1");

    expect(isStepComplete(state, "step2")).toBe(false);
    expect(isStepComplete(state, "step3")).toBe(false);
  });

  test("state file survives being written mid-operation", async () => {
    // Simulate interrupted writes by writing multiple times
    // and verifying each write is readable

    const state1 = createInitialState(5);
    await saveState(statePath, state1);
    const loaded1 = await loadState(statePath);
    expect(loaded1).toEqual(state1);

    const state2 = markStepComplete(state1, "step1");
    await saveState(statePath, state2);
    const loaded2 = await loadState(statePath);
    expect(loaded2).toEqual(state2);

    const state3 = markStepComplete(state2, "step2");
    await saveState(statePath, state3);
    const loaded3 = await loadState(statePath);
    expect(loaded3).toEqual(state3);

    // Verify final state is complete
    expect(loaded3?.completedSteps).toEqual(["step1", "step2"]);
  });

  test("state file format is valid JSON with newline", async () => {
    const state = createInitialState(3);
    await saveState(statePath, state);

    // Read raw file content
    const content = await Bun.file(statePath).text();

    // Should be valid JSON
    const parsed = JSON.parse(content);
    expect(parsed.version).toBe("1");

    // Should end with newline
    expect(content.endsWith("\n")).toBe(true);
  });
});
