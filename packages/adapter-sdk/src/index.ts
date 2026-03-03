// ── Base class ──────────────────────────────────────────────────────────────
export { BaseApiMockAdapter } from './base-api-mock-adapter.js';

// ── Test helpers ────────────────────────────────────────────────────────────
export { buildTestServer } from './test-helpers.js';
export type { TestServer } from './test-helpers.js';

// ── Format helpers ──────────────────────────────────────────────────────────
export { unixNow, toDateStr, capitalize } from './format-helpers.js';

// ── Re-exports from core (convenience for adapter authors) ─────────────────
export {
  generateId,
  paginate,
  filterByDate,
  resolvePersonaFromBearer,
  resolvePersonaFromBody,
  StateStore,
  MockServer,
} from '@mimicailab/core';

export type {
  ApiMockAdapter,
  EndpointDefinition,
  AdapterManifest,
  AdapterContext,
  AdapterResult,
  ExpandedData,
  PaginatedResult,
} from '@mimicailab/core';
