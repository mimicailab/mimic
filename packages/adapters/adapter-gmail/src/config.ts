import { z } from 'zod';

export const GmailConfigSchema = z
  .object({
    /** Default user identity to scope requests against. Gmail API uses 'me' for the authenticated user. */
    defaultUserId: z.string().default('me'),
    /** Optional: domain to use when synthesising email addresses for seeded data. */
    primaryDomain: z.string().optional(),
  })
  .optional();

export type GmailConfig = z.infer<typeof GmailConfigSchema>;
