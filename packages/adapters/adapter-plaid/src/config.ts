import { z } from 'zod';

export const PlaidConfigSchema = z.object({
  version: z.literal('2020-09-14').default('2020-09-14'),
  personalFinanceCategoryVersion: z.enum(['v1', 'v2']).default('v2'),
  port: z.number().optional(),
  simulateErrors: z.object({
    rate: z.number().min(0).max(1).default(0),
    types: z.array(z.enum([
      'ITEM_LOGIN_REQUIRED', 'PRODUCT_NOT_READY',
      'RATE_LIMIT_EXCEEDED', 'INTERNAL_SERVER_ERROR',
    ])).default([]),
  }).optional(),
});

export type PlaidConfig = z.infer<typeof PlaidConfigSchema>;
