import { z } from 'zod';

export const LinkMapSchema = z.record(z.string(), z.string());
export type LinkMap = z.infer<typeof LinkMapSchema>;

/**
 * Dependency definition for doctor command.
 */
export const DependencySchema = z.object({
  /** Command name to check (e.g., "starship") */
  name: z.string(),
  /** Whether this dependency is required (blocks install) or just recommended */
  required: z.boolean().default(false),
  /** Homebrew package name if different from command name (e.g., "oven-sh/bun/bun") */
  brewPackage: z.string().optional(),
  /** Description shown in doctor output */
  description: z.string().optional(),
});
export type Dependency = z.infer<typeof DependencySchema>;

/**
 * Brewfile configuration for sync command.
 */
export const BrewfileConfigSchema = z.object({
  /** Path to brewfile relative to dotfiles root (default: "homebrew/brewfile") */
  path: z.string().default("homebrew/brewfile"),
  /** Package type prefixes to exclude from sync (e.g., ["vscode", "mas"]) */
  exclude: z.array(z.string()).default(["vscode"]),
});
export type BrewfileConfig = z.infer<typeof BrewfileConfigSchema>;

/**
 * Custom patterns for file classification in init wizard.
 */
export const CustomPatternsSchema = z.object({
  /** Additional patterns to treat as low-value (caches, history, temp files) */
  lowValue: z.array(z.string()).optional(),
  /** Patterns to always treat as valuable (overrides lowValue classification) */
  highValue: z.array(z.string()).optional(),
});
export type CustomPatterns = z.infer<typeof CustomPatternsSchema>;

/**
 * Main dot configuration file schema.
 */
export const DotConfigSchema = z.object({
  /** Symlink mappings: source (relative to dotfiles) -> target (where symlink goes) */
  links: LinkMapSchema,
  /** Auto-commit after track command (default: true) */
  autoCommit: z.boolean().default(true),
  /** Dependencies to check in doctor command */
  dependencies: z.array(DependencySchema).optional(),
  /** Brewfile configuration for sync command */
  brewfile: BrewfileConfigSchema.optional(),
  /** Extra patterns to ignore during init scan (added to built-in skip list) */
  ignorePatterns: z.array(z.string()).optional(),
  /** Custom patterns for file classification (low-value vs valuable) */
  customPatterns: CustomPatternsSchema.optional(),
});
export type DotConfig = z.infer<typeof DotConfigSchema>;

export const DotStateSchema = z.object({
  dotfilesPath: z.string(),
  configuredAt: z.string(),  // ISO date
});
export type DotState = z.infer<typeof DotStateSchema>;
