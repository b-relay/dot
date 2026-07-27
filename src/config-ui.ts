import * as p from "@clack/prompts";
import { isAbsolute } from "node:path";
import type { CustomPatterns, Dependency, DotConfig, LinkMap } from "./types";
import { writeConfig } from "./config";
import { promptBrewfileConfig } from "./brewfile-config";

export type ConfigFileKind = "json" | "ts" | "none";
export type WizardResult = "no_changes" | "written" | "cancelled";

export async function detectConfigFileKind(dotfilesPath: string): Promise<ConfigFileKind> {
  const jsonPath = `${dotfilesPath}/dot.config.json`;
  const tsPath = `${dotfilesPath}/dot.config.ts`;
  if (await Bun.file(jsonPath).exists()) return "json";
  if (await Bun.file(tsPath).exists()) return "ts";
  return "none";
}

function checkCancel<T>(result: T | symbol): T {
  if (p.isCancel(result)) {
    throw new UserCancelledError();
  }
  return result;
}

export class UserCancelledError extends Error {
  constructor(message = "User cancelled") {
    super(message);
    this.name = "UserCancelledError";
  }
}

async function confirm(message: string, initialValue: boolean): Promise<boolean> {
  const r = await p.confirm({ message, initialValue });
  checkCancel(r);
  return r as boolean;
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

export function normalizeCustomPatterns(
  lowValue: string[] | undefined,
  highValue: string[] | undefined,
): CustomPatterns | undefined {
  const patterns: CustomPatterns = {};
  if (lowValue?.length) patterns.lowValue = lowValue;
  if (highValue?.length) patterns.highValue = highValue;
  return Object.keys(patterns).length > 0 ? patterns : undefined;
}

function abbreviateSourceForDisplay(source: string, dotfilesPath: string): string {
  if (!isAbsolute(source)) return source;
  const prefix = dotfilesPath.endsWith("/") ? dotfilesPath : `${dotfilesPath}/`;
  if (source.startsWith(prefix)) return source.slice(prefix.length);
  return source;
}

function abbreviateTargetForDisplay(target: string, home: string): string {
  if (target === home) return "~";
  const prefix = home.endsWith("/") ? home : `${home}/`;
  if (target.startsWith(prefix)) return `~/${target.slice(prefix.length)}`;
  return target;
}

function computeNonPortableLinkWarnings(links: LinkMap, dotfilesPath: string): string[] {
  const warnings: string[] = [];
  const prefix = dotfilesPath.endsWith("/") ? dotfilesPath : `${dotfilesPath}/`;
  for (const [source] of Object.entries(links)) {
    if (isAbsolute(source) && !source.startsWith(prefix)) {
      warnings.push(`Link source is absolute and not under dotfiles root: ${source}`);
    }
  }
  return warnings;
}

/**
 * Convert an "effective" links map (which may contain absolute sources and absolute $HOME targets)
 * into a portable LinkMap suitable for dot.config.json (relative-to-dotfiles sources and ~ targets).
 */
export function convertEffectiveLinksToPortable(
  effectiveLinks: LinkMap,
  dotfilesPath: string,
  home: string,
): LinkMap {
  const out: LinkMap = {};
  const dotfilesPrefix = dotfilesPath.endsWith("/") ? dotfilesPath : `${dotfilesPath}/`;
  const homePrefix = home.endsWith("/") ? home : `${home}/`;

  for (const [source, target] of Object.entries(effectiveLinks)) {
    let newSource = source;
    if (isAbsolute(source) && source.startsWith(dotfilesPrefix)) {
      newSource = source.slice(dotfilesPrefix.length).replaceAll("\\", "/");
    }

    let newTarget = target;
    if (target === home) {
      newTarget = "~";
    } else if (target.startsWith(homePrefix)) {
      newTarget = `~/${target.slice(homePrefix.length)}`;
    }

    out[newSource] = newTarget;
  }
  return out;
}

async function editStringList(
  title: string,
  current: string[] | undefined,
): Promise<{ next: string[] | undefined; changed: boolean }> {
  let items = [...(current ?? [])];
  let changed = false;

  while (true) {
    const count = items.length;
    const hint = count === 0 ? "none" : `${count} item(s)`;
    const action = await p.select({
      message: `${title} (${hint})`,
      options: [
        { value: "add", label: "Add" },
        { value: "remove", label: "Remove" },
        { value: "done", label: "Done" },
      ],
    });
    checkCancel(action);

    if (action === "done") break;
    if (action === "add") {
      const v = await p.text({
        message: "Enter pattern:",
        placeholder: "e.g. .cache or **/*.tmp",
      });
      checkCancel(v);
      const trimmed = (v as string).trim();
      if (!trimmed) {
        p.log.warn("Pattern cannot be empty.");
        continue;
      }
      const before = items.length;
      items = uniq([...items, trimmed]);
      if (items.length !== before) changed = true;
      continue;
    }

    if (action === "remove") {
      if (items.length === 0) {
        p.log.info("Nothing to remove.");
        continue;
      }
      const selected = await p.multiselect({
        message: "Select patterns to remove:",
        options: items.map((x) => ({ value: x, label: x })),
        required: false,
      });
      checkCancel(selected);
      const toRemove = new Set(selected as string[]);
      if (toRemove.size === 0) continue;
      const before = items.length;
      items = items.filter((x) => !toRemove.has(x));
      if (items.length !== before) changed = true;
      continue;
    }
  }

  const next = items.length > 0 ? items : undefined;
  const changedNormalized =
    JSON.stringify(current ?? []) !== JSON.stringify(next ?? []);
  return { next, changed: changed || changedNormalized };
}

function formatDepLabel(dep: Dependency): string {
  const req = dep.required ? "required" : "recommended";
  const brew = dep.brewPackage ? `, brew: ${dep.brewPackage}` : "";
  return `${dep.name} (${req}${brew})`;
}

async function editDependencies(
  current: Dependency[] | undefined,
): Promise<{ next: Dependency[] | undefined; changed: boolean }> {
  let deps = [...(current ?? [])];
  let changed = false;

  while (true) {
    const count = deps.length;
    const hint = count === 0 ? "none" : `${count} item(s)`;
    const action = await p.select({
      message: `Dependencies (${hint})`,
      options: [
        { value: "add", label: "Add" },
        { value: "edit", label: "Edit" },
        { value: "remove", label: "Remove" },
        { value: "done", label: "Done" },
      ],
    });
    checkCancel(action);

    if (action === "done") break;

    if (action === "add") {
      const name = await p.text({ message: "Command name (e.g., starship):" });
      checkCancel(name);
      const n = (name as string).trim();
      if (!n) {
        p.log.warn("Name is required.");
        continue;
      }

      const required = await confirm("Required?", false);
      const brewPackage = await p.text({
        message: "Homebrew package (optional):",
        placeholder: 'e.g. "oven-sh/bun/bun"',
      });
      checkCancel(brewPackage);
      const bp = (brewPackage as string).trim();

      const description = await p.text({
        message: "Description (optional):",
        placeholder: "Shown in doctor output",
      });
      checkCancel(description);
      const desc = (description as string).trim();

      deps.push({
        name: n,
        required,
        ...(bp ? { brewPackage: bp } : {}),
        ...(desc ? { description: desc } : {}),
      });
      changed = true;
      continue;
    }

    if (action === "edit") {
      if (deps.length === 0) {
        p.log.info("No dependencies to edit.");
        continue;
      }
      const selected = await p.select({
        message: "Select dependency to edit:",
        options: deps.map((d, idx) => ({ value: String(idx), label: formatDepLabel(d) })),
      });
      checkCancel(selected);
      const idx = Number(selected as string);
      const dep = deps[idx];
      if (!dep) continue;

      const name = await p.text({
        message: "Command name:",
        defaultValue: dep.name,
      });
      checkCancel(name);
      const n = (name as string).trim();
      if (!n) {
        p.log.warn("Name is required.");
        continue;
      }

      const required = await confirm("Required?", dep.required);

      const brewPackage = await p.text({
        message: "Homebrew package (optional):",
        defaultValue: dep.brewPackage ?? "",
      });
      checkCancel(brewPackage);
      const bp = (brewPackage as string).trim();

      const description = await p.text({
        message: "Description (optional):",
        defaultValue: dep.description ?? "",
      });
      checkCancel(description);
      const desc = (description as string).trim();

      deps[idx] = {
        name: n,
        required,
        ...(bp ? { brewPackage: bp } : {}),
        ...(desc ? { description: desc } : {}),
      };
      changed = true;
      continue;
    }

    if (action === "remove") {
      if (deps.length === 0) {
        p.log.info("Nothing to remove.");
        continue;
      }
      const selected = await p.multiselect({
        message: "Select dependencies to remove:",
        options: deps.map((d, idx) => ({ value: String(idx), label: formatDepLabel(d) })),
        required: false,
      });
      checkCancel(selected);
      const toRemove = new Set((selected as string[]).map((x) => Number(x)));
      if (toRemove.size === 0) continue;
      const before = deps.length;
      deps = deps.filter((_, i) => !toRemove.has(i));
      if (deps.length !== before) changed = true;
      continue;
    }
  }

  const next = deps.length > 0 ? deps : undefined;
  const changedNormalized =
    JSON.stringify(current ?? []) !== JSON.stringify(next ?? []);
  return { next, changed: changed || changedNormalized };
}

export async function runBrewfileConfigFlow(params: {
  dotfilesPath: string;
  dotConfig: DotConfig;
  configFileKind: ConfigFileKind;
  home: string;
  intro?: boolean;
}): Promise<WizardResult> {
  const { dotfilesPath, dotConfig, configFileKind, home } = params;
  const intro = params.intro ?? true;

  try {
    const brewfile = await promptBrewfileConfig(dotConfig.brewfile, { intro });
    if (!brewfile) return "cancelled";

    const currentPath = dotConfig.brewfile?.path ?? "homebrew/brewfile";
    const currentExclude = dotConfig.brewfile?.exclude ?? ["vscode"];
    const hadBrewfile = dotConfig.brewfile !== undefined;
    const noChange =
      hadBrewfile &&
      brewfile.path === currentPath &&
      JSON.stringify(brewfile.exclude) === JSON.stringify(currentExclude);
    if (noChange) {
      p.outro("No changes");
      return "no_changes";
    }

    const nextConfig: DotConfig = {
      ...dotConfig,
      brewfile,
      links: dotConfig.links,
    };

    // Confirm write (and, for TS configs, explicitly allow JSON override).
    if (configFileKind === "ts") {
      p.log.info("dot.config.ts detected. Applying changes requires writing dot.config.json (it will take precedence).");
      const ok = await confirm(
        "Write dot.config.json to apply changes (it will take precedence over dot.config.ts)?",
        true,
      );
      if (!ok) return "no_changes";
    } else {
      p.log.step("Summary:");
      console.log(`  - Brewfile path: ${hadBrewfile ? currentPath : "(not set)"} -> ${brewfile.path}`);
      console.log(`  - Exclusions: ${(hadBrewfile ? currentExclude : []).join(", ") || "(defaults)"} -> ${brewfile.exclude.join(", ") || "(none)"}`);
      const ok = await confirm("Write these settings to dot.config.json?", true);
      if (!ok) return "no_changes";
    }

    const toWrite: DotConfig = {
      ...nextConfig,
      links: convertEffectiveLinksToPortable(nextConfig.links, dotfilesPath, home),
    };

    await writeConfig(dotfilesPath, toWrite);
    p.log.success(`Brewfile path: ${brewfile.path}`);
    if (brewfile.exclude.length > 0) {
      p.log.success(`Excluding: ${brewfile.exclude.join(", ")}`);
    } else {
      p.log.success("No exclusions");
    }
    p.outro("Run `dot sync` to update your brewfile");
    return "written";
  } catch (err) {
    if (err instanceof UserCancelledError) {
      p.outro("Cancelled");
      return "cancelled";
    }
    throw err;
  }
}

export async function runConfigWizard(params: {
  dotfilesPath: string;
  dotConfig: DotConfig;
  home: string;
  configFileKind: ConfigFileKind;
  section?: "brewfile" | "auto-commit" | "patterns" | "deps";
}): Promise<WizardResult> {
  const { dotfilesPath, dotConfig, home, configFileKind, section } = params;
  try {
    p.intro(section === "brewfile" ? "dot config brewfile" : "dot config");

    let wantsCreate = false;
    if (configFileKind === "none") {
      p.log.info("No dot.config.json found. You may be running with legacy defaults.");
      wantsCreate = await confirm("Create dot.config.json now?", true);
      if (!wantsCreate) {
        p.outro("No changes");
        return "no_changes";
      }
    } else if (configFileKind === "ts") {
      p.log.info("dot.config.ts detected. This wizard can only apply changes by writing dot.config.json (which takes precedence).");
    }

    const working: DotConfig = structuredClone(dotConfig);
    const changes: string[] = [];
    let changed = false;

    const runAutoCommit = async () => {
      const current = working.autoCommit;
      p.log.info(`Auto-commit is currently ${current ? "enabled" : "disabled"}.`);
      const next = await confirm("Enable auto-commit?", current);
      if (next !== current) {
        working.autoCommit = next;
        changed = true;
        changes.push(`Auto-commit: ${current ? "enabled" : "disabled"} -> ${next ? "enabled" : "disabled"}`);
      }
    };

    const runBrewfile = async (direct: boolean) => {
      const hadBrewfile = working.brewfile !== undefined;
      const currentPath = working.brewfile?.path ?? "homebrew/brewfile";
      const currentExclude = working.brewfile?.exclude ?? ["vscode"];
      p.log.info(`Brewfile path: ${currentPath}`);
      p.log.info(`Exclusions: ${currentExclude.length > 0 ? currentExclude.join(", ") : "none"}`);
      const keep = direct ? false : await confirm("Keep brewfile sync settings as-is?", true);
      if (!keep) {
        const next = await promptBrewfileConfig(working.brewfile, { intro: false });
        if (!next) return "cancelled";
        const nextNoChange =
          next.path === currentPath &&
          JSON.stringify(next.exclude) === JSON.stringify(currentExclude);
        if (!hadBrewfile || !nextNoChange) {
          working.brewfile = next;
          changed = true;
          changes.push(`Brewfile path: ${hadBrewfile ? currentPath : "(not set)"} -> ${next.path}`);
          changes.push(`Brewfile exclusions: ${(hadBrewfile ? currentExclude : []).join(", ") || "(defaults)"} -> ${next.exclude.join(", ") || "(none)"}`);
        }
      }
      return "ok";
    };

    const runPatterns = async (direct: boolean) => {
      const ignoreCount = working.ignorePatterns?.length ?? 0;
      p.log.info(`Ignore patterns: ${ignoreCount === 0 ? "none" : ignoreCount}`);
      if (ignoreCount > 0) {
        for (const x of (working.ignorePatterns ?? []).slice(0, 3)) console.log(`  - ${x}`);
        if (ignoreCount > 3) console.log(`  - ...and ${ignoreCount - 3} more`);
      }
      const keepIgnore = direct ? false : await confirm("Keep ignore patterns as-is?", true);
      if (!keepIgnore) {
        const ig = await editStringList("Ignore patterns", working.ignorePatterns);
        if (ig.changed) {
          working.ignorePatterns = ig.next;
          changed = true;
          changes.push("Updated ignore patterns");
        }
      }

      const lowCount = working.customPatterns?.lowValue?.length ?? 0;
      const highCount = working.customPatterns?.highValue?.length ?? 0;
      p.log.info(`Custom patterns: lowValue=${lowCount}, highValue=${highCount}`);
      const keepCustom = direct ? false : await confirm("Keep custom patterns as-is?", true);
      if (!keepCustom) {
        const low = await editStringList("Custom low-value patterns", working.customPatterns?.lowValue);
        const high = await editStringList("Custom high-value patterns", working.customPatterns?.highValue);
        if (low.changed || high.changed) {
          const customPatterns = normalizeCustomPatterns(low.next, high.next);
          if (customPatterns) working.customPatterns = customPatterns;
          else delete working.customPatterns;
          changed = true;
          changes.push("Updated custom patterns");
        }
      }
    };

    const runDeps = async (direct: boolean) => {
      const depCount = working.dependencies?.length ?? 0;
      p.log.info(`Dependencies: ${depCount === 0 ? "none" : depCount}`);
      if (depCount > 0) {
        for (const d of (working.dependencies ?? []).slice(0, 5)) {
          console.log(`  - ${formatDepLabel(d)}`);
        }
        if (depCount > 5) console.log(`  - ...and ${depCount - 5} more`);
      }
      const keepDeps = direct ? false : await confirm("Keep dependencies as-is?", true);
      if (!keepDeps) {
        const r = await editDependencies(working.dependencies);
        if (r.changed) {
          working.dependencies = r.next;
          changed = true;
          changes.push("Updated dependencies");
        }
      }
    };

    const runLinksReview = async () => {
      const entries = Object.entries(working.links);
      p.log.info(`Links: ${entries.length} mapping(s)`);
      if (entries.length > 0) {
        const sample = entries.slice(0, 5).map(([s, t]) => {
          const ss = abbreviateSourceForDisplay(s, dotfilesPath);
          const tt = abbreviateTargetForDisplay(t, home);
          return `  ${ss} -> ${tt}`;
        });
        console.log(sample.join("\n"));
        if (entries.length > 5) {
          console.log(`  ...and ${entries.length - 5} more`);
        }
      }
      const keep = await confirm("Keep link mappings as-is?", true);
      if (!keep) {
        p.log.info("Links are not edited here.");
        p.log.info("Use `dot link`, `dot move`, or edit dot.config.json manually.");
      }
    };

    // Section shortcuts.
    if (section) {
      if (section === "auto-commit") await runAutoCommit();
      else if (section === "brewfile") {
        const r = await runBrewfile(true);
        if (r === "cancelled") return "cancelled";
      } else if (section === "patterns") await runPatterns(true);
      else if (section === "deps") await runDeps(true);
    } else {
      // Full review flow.
      await runLinksReview();
      await runAutoCommit();

      const brewfileResult = await runBrewfile(false);
      if (brewfileResult === "cancelled") return "cancelled";

      await runPatterns(false);
      await runDeps(false);
    }

    const effectiveWarnings = computeNonPortableLinkWarnings(working.links, dotfilesPath);
    if (effectiveWarnings.length > 0) {
      p.log.warn("Some links may be non-portable:");
      for (const w of effectiveWarnings.slice(0, 3)) {
        console.log(`  - ${w}`);
      }
      if (effectiveWarnings.length > 3) console.log(`  - ...and ${effectiveWarnings.length - 3} more`);
    }

    const needsWrite = wantsCreate || changed;
    if (!needsWrite) {
      p.outro("No changes");
      return "no_changes";
    }

    // If TS config exists, require explicit opt-in to write JSON.
    if (configFileKind === "ts") {
      const ok = await confirm("Write dot.config.json to apply changes (it will take precedence over dot.config.ts)?", true);
      if (!ok) {
        p.outro("No changes");
        return "no_changes";
      }
    }

    if (changes.length > 0) {
      p.log.step("Summary:");
      for (const c of changes) console.log(`  - ${c}`);
    } else if (wantsCreate) {
      p.log.step("Summary:");
      console.log("  - Create dot.config.json");
    }

    const ok = await confirm("Write these settings to dot.config.json?", true);
    if (!ok) {
      p.outro("No changes");
      return "no_changes";
    }

    const toWrite: DotConfig = {
      ...working,
      links: convertEffectiveLinksToPortable(working.links, dotfilesPath, home),
    };
    await writeConfig(dotfilesPath, toWrite);
    p.outro("Config updated");
    return "written";
  } catch (err) {
    if (err instanceof UserCancelledError) {
      p.outro("Cancelled");
      return "cancelled";
    }
    throw err;
  }
}
