import { z } from 'zod';

export const SlackConfigSchema = z.object({
  teamId: z.string().default('T01MIMIC'),
  teamName: z.string().default('Mimic Workspace'),
  botUserId: z.string().default('U01MIMICBOT'),
});

export type SlackConfig = z.infer<typeof SlackConfigSchema>;
