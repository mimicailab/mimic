import { z } from 'zod';

export const GoCardlessConfigSchema = z.object({
  port: z.number().optional(),
});

export type GoCardlessConfig = z.infer<typeof GoCardlessConfigSchema>;
