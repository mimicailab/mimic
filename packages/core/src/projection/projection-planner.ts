/**
 * V5 — Phase 7: Projection planner.
 *
 * Reads a frozen WorldState and decides which projectors to run for which
 * surface coordinates. The output is an execution plan; `runProjection`
 * (below) drives the plan and assembles the `MaterialisedDataset`.
 *
 * V5 invariant: projectors do NOT mutate world state. The planner
 * deep-freezes `state.populations`, `state.identities`, `state.anchors`,
 * and `state.budgets` before passing them downstream so any accidental
 * write throws.
 */

import type { WorldState } from '../world/world-state.js';
import type { SchemaModel } from '../types/schema.js';
import type { MaterialisedDataset } from './types.js';
import { createEmptyDataset } from './types.js';
import { projectDb } from './db-projector.js';
import { projectApi } from './api-projector.js';

export interface SurfaceCoord {
  surface: string;
  objectKind: string;
}

export interface ProjectionPlan {
  /** DB tables (surface='db') to project. */
  dbTables: SurfaceCoord[];
  /** API resources (surface !== 'db') to project, grouped by adapter. */
  apiResources: Map<string, SurfaceCoord[]>;
}

/**
 * Walk every entity's IdentityRecord to discover what surface coordinates
 * the projectors must materialise. This is the single decision point for
 * "what gets emitted" — no projector invents new surfaces.
 */
export function planProjection(state: WorldState): ProjectionPlan {
  const dbSeen = new Set<string>();
  const dbTables: SurfaceCoord[] = [];
  const apiByAdapter = new Map<string, Map<string, SurfaceCoord>>();

  for (const [, record] of state.identities) {
    for (const slot of record.slots) {
      if (slot.surface === 'db') {
        if (!dbSeen.has(slot.objectKind)) {
          dbSeen.add(slot.objectKind);
          dbTables.push({ surface: 'db', objectKind: slot.objectKind });
        }
      } else {
        const seen = apiByAdapter.get(slot.surface) ?? new Map();
        if (!seen.has(slot.objectKind)) {
          seen.set(slot.objectKind, { surface: slot.surface, objectKind: slot.objectKind });
        }
        apiByAdapter.set(slot.surface, seen);
      }
    }
  }

  const apiResources = new Map<string, SurfaceCoord[]>();
  for (const [adapter, coords] of apiByAdapter) {
    apiResources.set(adapter, [...coords.values()]);
  }

  return { dbTables, apiResources };
}

export interface ProjectionResult {
  dataset: MaterialisedDataset;
  plan: ProjectionPlan;
}

/**
 * Drive the projection plan. The world state is deep-frozen so any
 * projector that tries to mutate it throws (`TypeError: Cannot assign…`).
 *
 * The schema parameter is optional: when supplied, the DB projector
 * uses it to filter out object kinds the schema doesn't declare. When
 * omitted, every db slot becomes a table.
 */
export function runProjection(
  state: WorldState,
  schema?: SchemaModel,
): ProjectionResult {
  freezeWorldState(state);
  const plan = planProjection(state);
  const dataset: MaterialisedDataset = createEmptyDataset();

  for (const coord of plan.dbTables) {
    if (schema && !schema.tables.find((t) => t.name === coord.objectKind)) continue;
    dataset.tables[coord.objectKind] = projectDb(state, coord.objectKind, schema);
  }

  for (const [adapter, coords] of plan.apiResources) {
    const responses: Record<string, ReturnType<typeof projectApi>> = {};
    for (const coord of coords) {
      responses[coord.objectKind] = projectApi(state, coord.surface, coord.objectKind);
    }
    dataset.apiResponses[adapter] = { adapterId: adapter, responses };
  }

  return { dataset, plan };
}

// ---------------------------------------------------------------------------
// World-state freezing — projectors must never mutate
// ---------------------------------------------------------------------------

function freezeWorldState(state: WorldState): void {
  Object.freeze(state.populations);
  for (const [, entities] of state.populations) {
    for (const entity of entities) {
      Object.freeze(entity.cohorts);
      Object.freeze(entity.attrs);
      Object.freeze(entity.lifecycle);
      Object.freeze(entity);
    }
    Object.freeze(entities);
  }
  Object.freeze(state.identities);
  Object.freeze(state.anchors);
  for (const [, anchor] of state.anchors) {
    Object.freeze(anchor.dates);
    Object.freeze(anchor);
  }
  Object.freeze(state.budgets);
  for (const [, ledger] of state.budgets) {
    Object.freeze(ledger.parts);
    Object.freeze(ledger);
  }
  Object.freeze(state.lifecycleEvents);
  for (const e of state.lifecycleEvents) {
    Object.freeze(e.attrs);
    Object.freeze(e);
  }
}
