import { z } from 'zod';

export const HubSpotConfigSchema = z
  .object({
    /** Optional: portal/account id reflected in `/account-info`. */
    portalId: z.number().int().optional(),
    /** Optional: portal name surfaced in account-info responses. */
    portalName: z.string().optional(),
    /** Optional: time zone string returned by account-info. */
    timeZone: z.string().optional(),
  })
  .optional();

export type HubSpotConfig = z.infer<typeof HubSpotConfigSchema>;
