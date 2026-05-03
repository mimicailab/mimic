import { z } from 'zod';

export const AttioConfigSchema = z
  .object({
    /** Optional: workspace UUID for synthesised data. Defaults to a deterministic placeholder. */
    workspaceId: z.string().optional(),
    /** Optional: workspace human-readable name (returned by `/v2/self` and embedded in records). */
    workspaceName: z.string().optional(),
    /** Optional: workspace slug (used in web_url construction). */
    workspaceSlug: z.string().optional(),
  })
  .optional();

export type AttioConfig = z.infer<typeof AttioConfigSchema>;
