import { z } from 'zod';

export const GoCardlessConfigSchema = z.object({
  environment: z.enum(['sandbox', 'live']).default('sandbox'),
  port: z.number().optional(),
});

export type GoCardlessConfig = z.infer<typeof GoCardlessConfigSchema>;
