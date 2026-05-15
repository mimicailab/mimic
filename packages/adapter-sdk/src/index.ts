// ── Base classes ─────────────────────────────────────────────────────────────
export { BaseApiMockAdapter } from './base-api-mock-adapter.js';
export { OpenApiMockAdapter } from './openapi-mock-adapter.js';
export type {
  OverrideHandler,
  OverrideMap,
  DefaultFactory,
  ListResponse,
  NotFoundError,
  StripeNotFoundError,
} from './openapi-mock-adapter.js';

// ── Marshalling ──────────────────────────────────────────────────────────────
export { runMarshallers } from './marshalling.js';
export type {
  Body,
  MarshalContext,
  Marshaller,
  StandaloneMarshaller,
  EmbeddedMarshaller,
  PrecomputeMarshalContext,
} from './marshalling.js';

// ── Shared OpenAPI types (used by codegen + runtime) ─────────────────────────
export type { GeneratedRoute, RouteMethod, RouteOperation } from './openapi-types.js';

// ── Test helpers ────────────────────────────────────────────────────────────
export { buildTestServer } from './test-helpers.js';
export type { TestServer } from './test-helpers.js';

// ── Format helpers ──────────────────────────────────────────────────────────
export { unixNow, toDateStr, capitalize } from './format-helpers.js';

// ── V5 projector hints ──────────────────────────────────────────────────────
// Source of truth lives in @mimicai/core (so the core projector can read
// the registry without inverting the dependency direction). Adapters call
// `registerProjectorHints` from their module init to declare their hints.
export {
  registerProjectorHints,
  getProjectorHints,
  defaultHints,
  __resetProjectorHints,
} from '@mimicai/core';
export type { ProjectorHints } from '@mimicai/core';

// ── Re-exports from core (convenience for adapter authors) ─────────────────
export {
  generateId,
  paginate,
  filterByDate,
  resolvePersonaFromBearer,
  resolvePersonaFromBody,
  StateStore,
  MockServer,
} from '@mimicai/core';

export type {
  ApiMockAdapter,
  DataSpec,
  EndpointDefinition,
  AdapterManifest,
  AdapterContext,
  AdapterResult,
  ExpandedData,
  PaginatedResult,
  PromptContext,
} from '@mimicai/core';
