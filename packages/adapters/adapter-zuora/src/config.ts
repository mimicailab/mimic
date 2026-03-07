import { z } from 'zod';

export const ZuoraConfigSchema = z.object({
  tenant: z.string().default('test-tenant'),
  port: z.number().optional(),
});

export type ZuoraConfig = z.infer<typeof ZuoraConfigSchema>;
