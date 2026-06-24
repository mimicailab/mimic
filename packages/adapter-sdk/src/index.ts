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

// ── Behavior DSL ─────────────────────────────────────────────────────────────
export { evalExpr, evalBool, resolveTemplate } from './behavior/expr.js';
export { buildActionHandler, mountBehaviorPack } from './behavior/interpreter.js';
export type { BehaviorContext, ErrorFactory, EmitSink, RegisterOverrideFn } from './behavior/interpreter.js';
export { loadBehaviorPack } from './behavior/loader.js';
export { createWebhookEmitSink, webhookSinkFromConfig, WebhookDelivery } from './behavior/webhook.js';
export type { WebhookSinkOptions, EnvelopeStyle, DeliveryMode } from './behavior/webhook.js';
export { webhookHub, WebhookHub } from '@mimicai/core';
export type { RecordedWebhook } from '@mimicai/core';
export type {
  BehaviorPack, ActionSpec, Effect, EmitSpec, ErrorSpec, TargetRef,
  CreateEffect, SetEffect, UpdateEffect, VarEffect, WhenEffect, ErrorEffect,
} from './behavior/types.js';

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
