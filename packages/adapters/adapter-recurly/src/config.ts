import { z } from 'zod';

export const RecurlyConfigSchema = z.object({
  version: z.enum(['v2021-02-25']).default('v2021-02-25'),
  port: z.number().optional(),
  site: z.string().optional().describe('Recurly site subdomain'),
});

export type RecurlyConfig = z.infer<typeof RecurlyConfigSchema>;
