import { z } from 'zod';

export const DwollaConfigSchema = z.object({
  version: z.enum(['v2']).default('v2'),
});

export type DwollaConfig = z.infer<typeof DwollaConfigSchema>;
