import { z } from 'zod';

export const RevenueCatConfigSchema = z.object({
  port: z.number().optional(),
});

export type RevenueCatConfig = z.infer<typeof RevenueCatConfigSchema>;
