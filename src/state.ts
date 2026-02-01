import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DotStateSchema, type DotState } from "./types";

/**
 * Get the state file path.
 * Computed at runtime to support changing HOME in tests.
 */
function getStatePath(): string {
  return `${process.env.HOME}/.config/dot/state.json`;
}

/**
 * Load state from ~/.config/dot/state.json
 * Returns null if file doesn't exist or is invalid
 */
export async function loadState(): Promise<DotState | null> {
  try {
    const statePath = getStatePath();
    const file = Bun.file(statePath);
    if (!(await file.exists())) {
      return null;
    }
    const raw = await file.json();
    const result = DotStateSchema.safeParse(raw);
    if (!result.success) {
      return null;
    }
    return result.data;
  } catch {
    return null;
  }
}

/**
 * Save state to ~/.config/dot/state.json
 * Creates parent directory if needed
 */
export async function saveState(state: DotState): Promise<void> {
  const statePath = getStatePath();
  // Ensure parent directory exists
  await mkdir(dirname(statePath), { recursive: true });
  await Bun.write(statePath, JSON.stringify(state, null, 2) + "\n");
}

export type GetDotfilesPathOptions = {
  dotfiles?: string;
};

/**
 * Get dotfiles path from priority order:
 * 1. --dotfiles flag (passed in options)
 * 2. DOT_HOME env var
 * 3. State file dotfilesPath
 * 4. Return null if none found (triggers first-run)
 */
export async function getDotfilesPath(
  options: GetDotfilesPathOptions = {}
): Promise<string | null> {
  // 1. CLI flag takes highest priority
  if (options.dotfiles) {
    return options.dotfiles;
  }

  // 2. Environment variable
  const envPath = process.env.DOT_HOME;
  if (envPath) {
    return envPath;
  }

  // 3. State file
  const state = await loadState();
  if (state?.dotfilesPath) {
    return state.dotfilesPath;
  }

  // 4. No config found
  return null;
}
