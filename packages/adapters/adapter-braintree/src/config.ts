import { z } from 'zod';

export const BraintreeConfigSchema = z.object({
  version: z.enum(['rest', 'graphql']).default('rest'),
  merchantId: z.string().default('test_merchant'),
});

export type BraintreeConfig = z.infer<typeof BraintreeConfigSchema>;
