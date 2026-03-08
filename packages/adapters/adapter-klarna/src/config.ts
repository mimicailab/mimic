import { z } from 'zod';

export const KlarnaConfigSchema = z.object({
  region: z.enum(['eu', 'na', 'oc']).default('eu'),
  port: z.number().optional(),
});

export type KlarnaConfig = z.infer<typeof KlarnaConfigSchema>;
