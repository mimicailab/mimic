import { z } from 'zod';

export const RecurlyConfigSchema = z.object({
  site: z.string().default('test-site'),
  port: z.number().optional(),
});

export type RecurlyConfig = z.infer<typeof RecurlyConfigSchema>;
