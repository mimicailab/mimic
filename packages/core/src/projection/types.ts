/**
 * V5 — Phase 7: Projection types.
 *
 * The projector consumes a frozen WorldState and emits a
 * `MaterialisedDataset`: tables + per-adapter resource collections. This
 * shape mirrors the legacy `ExpandedData` so seed/inspect/mock-server
 * keep working without churn, but the production path is now
 * world-state → projectors only (no Blueprint, no expander).
 */

import type { Row, ApiResponseSet } from '../types/dataset.js';

export interface MaterialisedDataset {
  /** DB rows keyed by table name. */
  tables: Record<string, Row[]>;
  /** API responses keyed by adapter id, then resource. */
  apiResponses: Record<string, ApiResponseSet>;
}

export function createEmptyDataset(): MaterialisedDataset {
  return { tables: {}, apiResponses: {} };
}
