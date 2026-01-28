import writeFileAtomic from "write-file-atomic";
import { readFile } from "node:fs/promises";
import { getLogger } from "./logger.js";

const logger = getLogger(["state"]);

export type InstallState = {
  version: string;           // State schema version (for migrations)
  startedAt: string;         // ISO timestamp when install started
  completedSteps: string[];  // Step IDs that are complete
  totalSteps: number;        // Total steps in this install
  status: 'in-progress' | 'completed' | 'failed';
};

/**
 * Load state from disk. Returns null if no state file exists.
 */
export async function loadState(statePath: string): Promise<InstallState | null> {
  try {
    const content = await readFile(statePath, "utf-8");
    const state = JSON.parse(content) as InstallState;
    logger.debug("Loaded state from {path}", { path: statePath, state });
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      logger.debug("No state file found at {path}", { path: statePath });
      return null;
    }
    logger.error("Failed to load state from {path}: {error}", {
      path: statePath,
      error: String(error)
    });
    throw error;
  }
}

/**
 * Save state to disk atomically using write-file-atomic.
 * Prevents corruption on Ctrl+C or process termination.
 */
export async function saveState(statePath: string, state: InstallState): Promise<void> {
  try {
    await writeFileAtomic(statePath, JSON.stringify(state, null, 2) + "\n", {
      encoding: "utf-8",
      fsync: true,  // Ensure write reaches disk
    });
    logger.debug("Saved state to {path}", { path: statePath, state });
  } catch (error) {
    logger.error("Failed to save state to {path}: {error}", {
      path: statePath,
      error: String(error)
    });
    throw error;
  }
}

/**
 * Create initial state for a fresh install.
 */
export function createInitialState(totalSteps: number): InstallState {
  const state: InstallState = {
    version: "1",
    startedAt: new Date().toISOString(),
    completedSteps: [],
    totalSteps,
    status: "in-progress",
  };
  logger.debug("Created initial state", { state });
  return state;
}

/**
 * Mark a step as complete. Returns updated state (immutable).
 */
export function markStepComplete(state: InstallState, stepId: string): InstallState {
  // Idempotent: if step already complete, don't add again
  if (state.completedSteps.includes(stepId)) {
    logger.debug("Step {stepId} already complete", { stepId });
    return state;
  }

  const newState: InstallState = {
    ...state,
    completedSteps: [...state.completedSteps, stepId],
  };

  logger.info("Marked step {stepId} complete ({completed}/{total})", {
    stepId,
    completed: newState.completedSteps.length,
    total: state.totalSteps,
  });

  return newState;
}

/**
 * Check if a step is already complete.
 */
export function isStepComplete(state: InstallState, stepId: string): boolean {
  return state.completedSteps.includes(stepId);
}
