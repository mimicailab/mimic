import { z } from 'zod';

export const plaidConfigSchema = z.object({
  /** Plaid environment: sandbox or production */
  environment: z.enum(['sandbox', 'production']).default('sandbox'),
});

export type PlaidConfig = z.infer<typeof plaidConfigSchema>;
