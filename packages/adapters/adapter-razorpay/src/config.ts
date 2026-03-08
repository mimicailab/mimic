import { z } from 'zod';

export const RazorpayConfigSchema = z.object({
  version: z.enum(['v1']).default('v1'),
});

export type RazorpayConfig = z.infer<typeof RazorpayConfigSchema>;
