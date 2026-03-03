import { z } from 'zod';

export const StripeConfigSchema = z.object({
  version: z
    .enum(['2025-03-31.basil', '2025-09-30.clover', '2026-02-25.clover'])
    .default('2026-02-25.clover'),
  port: z.number().optional(),
  webhookSecret: z.string().optional(),
});

export type StripeConfig = z.infer<typeof StripeConfigSchema>;
