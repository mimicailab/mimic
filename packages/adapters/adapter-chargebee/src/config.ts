import { z } from 'zod';

export const ChargebeeConfigSchema = z.object({
  version: z.enum(['v2']).default('v2'),
  port: z.number().optional(),
  site: z.string().optional().describe('Chargebee site name (for persona resolution)'),
});

export type ChargebeeConfig = z.infer<typeof ChargebeeConfigSchema>;
