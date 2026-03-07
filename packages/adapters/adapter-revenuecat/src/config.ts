import { z } from 'zod';

export const RevenueCatConfigSchema = z.object({
  projectId: z.string().default('proj_default'),
  port: z.number().optional(),
});

export type RevenueCatConfig = z.infer<typeof RevenueCatConfigSchema>;
