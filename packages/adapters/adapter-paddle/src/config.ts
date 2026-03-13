import { z } from 'zod';

export const PaddleConfigSchema = z.object({
  port: z.number().optional(),
});

export type PaddleConfig = z.infer<typeof PaddleConfigSchema>;
