import { z } from 'zod';

export const WiseConfigSchema = z.object({
  version: z.enum(['v1', 'v2', 'v3', 'v4']).default('v2'),
});

export type WiseConfig = z.infer<typeof WiseConfigSchema>;
