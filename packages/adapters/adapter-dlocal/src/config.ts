import { z } from 'zod';

export const DLocalConfigSchema = z.object({
  version: z.enum(['2.1']).default('2.1'),
});

export type DLocalConfig = z.infer<typeof DLocalConfigSchema>;
