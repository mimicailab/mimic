import { z } from 'zod';

export const XenditConfigSchema = z.object({
  version: z.enum(['v2', 'v3']).default('v3'),
});

export type XenditConfig = z.infer<typeof XenditConfigSchema>;
