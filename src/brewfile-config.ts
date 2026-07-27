import * as p from "@clack/prompts";
import type { BrewfileConfig } from "./types";

/**
 * Human-readable descriptions for exclude types.
 * These match line prefixes in `brew bundle dump` output.
 */
export const EXCLUDE_DESCRIPTIONS: Record<string, string> = {
  vscode: 'VS Code extensions (vscode "...")',
  mas: 'Mac App Store apps (mas "...")',
  whalebrew: 'Whalebrew containers (whalebrew "...")',
};

function normalizeRelativePath(input: string): string {
  return input.trim().replace(/^\.\/+/, "");
}

function validateRelativePath(input: string | undefined): string | undefined {
  const v = normalizeRelativePath(input ?? "");
  if (!v) return "Path is required";

  // Keep brewfile path relative to dotfiles root for portability.
  if (v.startsWith("/") || v.startsWith("~")) return "Use a path relative to the dotfiles repo (no / or ~)";
  if (v.includes("\\")) return "Use forward slashes (/) not backslashes (\\)";

  const parts = v.split("/");
  if (parts.some((p) => p === "..")) return "Path cannot contain '..'";
  if (parts.some((p) => p === "")) return "Path cannot contain empty segments ('//')";

  return undefined;
}

export type PromptBrewfileConfigOptions = {
  intro?: boolean;
};

/**
 * Prompt user for brewfile sync settings (path + exclusions).
 * Returns null if cancelled.
 */
export async function promptBrewfileConfig(
  current?: BrewfileConfig,
  options?: PromptBrewfileConfigOptions
): Promise<BrewfileConfig | null> {
  if (options?.intro !== false) {
    p.intro("dot config brewfile");
  }

  p.log.info("Configure where to write your brewfile (relative to your dotfiles repo).");
  console.log("  Suggested: create a folder named 'homebrew' at the repo root and use:");
  console.log('    homebrew/brewfile');
  console.log("");

  const pathInput = await p.text({
    message: "Brewfile path (relative to dotfiles repo):",
    placeholder: "homebrew/brewfile",
    defaultValue: current?.path ?? "homebrew/brewfile",
    validate: (v) => validateRelativePath(v),
  });

  if (p.isCancel(pathInput)) {
    return null;
  }

  const path = normalizeRelativePath(pathInput as string);

  p.log.info("Select package types to exclude from `dot sync`.");
  const excludeOptions = Object.entries(EXCLUDE_DESCRIPTIONS).map(([value, desc]) => ({
    value,
    label: value,
    hint: desc,
  }));

  const selected = await p.multiselect({
    message: "Exclude:",
    options: excludeOptions,
    initialValues: current?.exclude ?? ["vscode"],
    required: false,
  });

  if (p.isCancel(selected)) {
    return null;
  }

  const exclude = selected as string[];

  return { path, exclude };
}
