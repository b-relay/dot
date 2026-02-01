import { z } from 'zod';

export const LinkMapSchema = z.record(z.string(), z.string());
export type LinkMap = z.infer<typeof LinkMapSchema>;

export const DotConfigSchema = z.object({
  links: LinkMapSchema,
  autoCommit: z.boolean().default(true),
});
export type DotConfig = z.infer<typeof DotConfigSchema>;

export const DotStateSchema = z.object({
  dotfilesPath: z.string(),
  configuredAt: z.string(),  // ISO date
});
export type DotState = z.infer<typeof DotStateSchema>;
