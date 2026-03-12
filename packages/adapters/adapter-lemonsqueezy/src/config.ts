import { z } from 'zod';

export const LemonSqueezyConfigSchema = z.object({
  version: z.literal('v1').default('v1'),
  port: z.number().int().positive().default(4100),
});

export type LemonSqueezyConfig = z.infer<typeof LemonSqueezyConfigSchema>;
