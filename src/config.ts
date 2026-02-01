import { DotConfigSchema, type DotConfig, type LinkMap } from './types';

/**
 * Load config from dotfiles repository.
 *
 * Priority:
 * 1. JSON config (dot.config.json) - works with compiled binary
 * 2. TypeScript config (dot.config.ts) - only works with non-compiled bun
 *
 * @param dotfilesPath Path to the dotfiles repository
 * @returns Config object or null if no config found
 */
export async function loadConfig(dotfilesPath: string): Promise<DotConfig | null> {
  const jsonPath = `${dotfilesPath}/dot.config.json`;
  const tsPath = `${dotfilesPath}/dot.config.ts`;

  // Try JSON first (works with compiled binary)
  if (await Bun.file(jsonPath).exists()) {
    try {
      const raw = await Bun.file(jsonPath).json();
      const result = DotConfigSchema.safeParse(raw);
      if (!result.success) {
        console.error("Invalid config:", result.error.flatten().fieldErrors);
        throw new Error("Config validation failed. See errors above.");
      }
      return result.data;
    } catch (error) {
      if (error instanceof Error && error.message.includes("validation failed")) {
        throw error;
      }
      console.error("Error reading config file:", error);
      throw new Error("Failed to read config file");
    }
  }

  // Try TypeScript (only works with non-compiled Bun)
  if (await Bun.file(tsPath).exists()) {
    // Warn about compiled binary limitation
    // Check if we're running as a compiled binary by checking argv[0]
    const argv0 = process.argv[0] ?? '';
    const isCompiled = !argv0.includes('bun');
    if (isCompiled) {
      console.warn("Warning: TypeScript configs require running via 'bun dot' instead of the compiled binary.");
      console.warn("Consider using dot.config.json for full compatibility.");
      return null;
    }

    try {
      const module = await import(tsPath);
      const config = module.default;
      const result = DotConfigSchema.safeParse(config);
      if (!result.success) {
        console.error("Invalid config:", result.error.flatten().fieldErrors);
        throw new Error("Config validation failed. See errors above.");
      }
      return result.data;
    } catch (error) {
      if (error instanceof Error && error.message.includes("validation failed")) {
        throw error;
      }
      console.error("Error loading TypeScript config:", error);
      throw new Error("Failed to load TypeScript config");
    }
  }

  return null;
}

/**
 * Write config to JSON file in dotfiles repository.
 *
 * @param dotfilesPath Path to the dotfiles repository
 * @param config Config object to write
 */
export async function writeConfig(dotfilesPath: string, config: DotConfig): Promise<void> {
  const jsonPath = `${dotfilesPath}/dot.config.json`;
  await Bun.write(jsonPath, JSON.stringify(config, null, 2) + "\n");
}

/**
 * Update config by adding a new link mapping.
 *
 * @param dotfilesPath Path to the dotfiles repository
 * @param newLink New link to add (source: path in repo, target: symlink location)
 * @returns Updated config
 */
export async function updateConfigLinks(
  dotfilesPath: string,
  newLink: { source: string; target: string }
): Promise<DotConfig> {
  // Load existing config or create new one
  let config = await loadConfig(dotfilesPath);

  if (!config) {
    config = {
      links: {},
      autoCommit: true,
    };
  }

  // Add new link
  config.links[newLink.source] = newLink.target;

  // Validate before writing
  const result = DotConfigSchema.safeParse(config);
  if (!result.success) {
    console.error("Invalid config after update:", result.error.flatten().fieldErrors);
    throw new Error("Config validation failed after adding link");
  }

  // Write updated config
  await writeConfig(dotfilesPath, result.data);

  return result.data;
}
