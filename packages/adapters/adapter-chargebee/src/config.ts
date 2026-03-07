import { z } from 'zod';

export const ChargebeeConfigSchema = z.object({
  site: z.string().default('test-site'),
  port: z.number().optional(),
});

export type ChargebeeConfig = z.infer<typeof ChargebeeConfigSchema>;
