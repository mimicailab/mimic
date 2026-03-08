import { z } from 'zod';

export const PayPalConfigSchema = z.object({
  version: z.enum(['v1', 'v2']).default('v2'),
});

export type PayPalConfig = z.infer<typeof PayPalConfigSchema>;
