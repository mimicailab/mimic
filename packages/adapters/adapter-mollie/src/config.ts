import { z } from 'zod';

export const MollieConfigSchema = z.object({
  version: z.enum(['v2']).default('v2'),
  port: z.number().optional(),
  webhookSecret: z.string().optional(),
});

export type MollieConfig = z.infer<typeof MollieConfigSchema>;
