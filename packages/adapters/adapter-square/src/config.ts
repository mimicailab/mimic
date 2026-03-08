import { z } from 'zod';

export const SquareConfigSchema = z.object({
  version: z.string().default('2025-10-16'),
});

export type SquareConfig = z.infer<typeof SquareConfigSchema>;
