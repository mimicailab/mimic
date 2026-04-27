import { z } from 'zod';

export const GranolaConfigSchema = z
  .object({
    /** Optional: workspace name returned in note `workspace_name` fields. */
    workspaceName: z.string().optional(),
    /** Optional: default page size for list endpoints (max 100, default 20). */
    defaultPageSize: z.number().int().min(1).max(100).optional(),
  })
  .optional();

export type GranolaConfig = z.infer<typeof GranolaConfigSchema>;
