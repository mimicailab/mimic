import { z } from 'zod';

export const MercadoPagoConfigSchema = z.object({
  version: z.enum(['v1']).default('v1'),
});

export type MercadoPagoConfig = z.infer<typeof MercadoPagoConfigSchema>;
