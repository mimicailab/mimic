import { z } from 'zod';

export const FlutterwaveConfigSchema = z.object({
  version: z.enum(['v3']).default('v3'),
});

export type FlutterwaveConfig = z.infer<typeof FlutterwaveConfigSchema>;
