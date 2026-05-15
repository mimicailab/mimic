/**
 * V5 — Projection barrel.
 */

export type { MaterialisedDataset } from './types.js';
export { createEmptyDataset } from './types.js';
export {
  runProjection,
  planProjection,
  type ProjectionPlan,
  type ProjectionResult,
  type SurfaceCoord,
} from './projection-planner.js';
export { projectDb } from './db-projector.js';
export { projectApi } from './api-projector.js';
export { FkResolutionError, resolveMirroredFks } from './fk-resolver.js';
export { getPersonaIdPrefix, getResourceIdPrefix } from './identity-prefix.js';
export {
  registerProjectorHints,
  getProjectorHints,
  defaultHints,
  __resetProjectorHints,
} from './projector-hints.js';
export type { ProjectorHints } from './projector-hints.js';
