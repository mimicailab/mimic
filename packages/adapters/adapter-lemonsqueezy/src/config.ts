import { z } from 'zod';

export const LemonSqueezyConfigSchema = z.object({
  environment: z.enum(['test', 'production']).default('test'),
  port: z.number().optional(),
});

export type LemonSqueezyConfig = z.infer<typeof LemonSqueezyConfigSchema>;
