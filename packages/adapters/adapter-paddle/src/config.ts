import { z } from 'zod';

export const PaddleConfigSchema = z.object({
  environment: z.enum(['sandbox', 'production']).default('sandbox'),
  port: z.number().optional(),
});

export type PaddleConfig = z.infer<typeof PaddleConfigSchema>;
