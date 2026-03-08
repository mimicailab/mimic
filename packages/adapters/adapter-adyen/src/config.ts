import { z } from 'zod';

export const AdyenConfigSchema = z.object({
  version: z.enum(['v70', 'v71']).default('v71'),
  port: z.number().optional(),
  merchantAccount: z.string().default('TestMerchantAccount'),
});

export type AdyenConfig = z.infer<typeof AdyenConfigSchema>;
