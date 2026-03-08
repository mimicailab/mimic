import { z } from 'zod';

export const CheckoutComConfigSchema = z.object({
  version: z.enum(['default']).default('default'),
  environment: z.enum(['sandbox', 'production']).default('sandbox'),
  processingChannelId: z.string().default('pc_mimic_test'),
  simulate3DS: z.boolean().default(false),
});

export type CheckoutComConfig = z.infer<typeof CheckoutComConfigSchema>;
