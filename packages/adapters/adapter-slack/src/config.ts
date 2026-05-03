import { z } from 'zod';

export const SlackConfigSchema = z
  .object({
    /** Optional: workspace domain to use for synthesised data (e.g. "northwind"). */
    teamDomain: z.string().optional(),
    /** Optional: workspace name displayed in `team.info`. */
    teamName: z.string().optional(),
  })
  .optional();

export type SlackConfig = z.infer<typeof SlackConfigSchema>;
