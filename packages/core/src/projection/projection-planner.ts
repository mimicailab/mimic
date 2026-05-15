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

export class ProjectionInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectionInvariantError';
  }
}

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

  assertProjectionOwnershipInvariant(state, dataset, schema);

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

function assertProjectionOwnershipInvariant(
  state: WorldState,
  dataset: MaterialisedDataset,
  schema: SchemaModel | undefined,
): void {
  const expected = collectExpectedProjectionCounts(state, schema);
  const actual = collectActualProjectionCounts(dataset);
  const keys = new Set([...expected.keys(), ...actual.keys()]);

  for (const key of keys) {
    const expectedCount = expected.get(key) ?? 0;
    const actualCount = actual.get(key) ?? 0;
    if (expectedCount === actualCount) continue;
    throw new ProjectionInvariantError(
      `projection ownership invariant failed for ${describeCoordKey(key)}: expected ${expectedCount} row(s), emitted ${actualCount}`,
    );
  }
}

function collectExpectedProjectionCounts(
  state: WorldState,
  schema: SchemaModel | undefined,
): Map<string, number> {
  const hasOwnedBindings = [...state.populations.values()]
    .flat()
    .some((entity) => (entity.surfaceBindings?.length ?? 0) > 0);

  const counts = new Map<string, number>();

  const add = (surface: string, objectKind: string): void => {
    if (surface === 'db' && schema && !schema.tables.find((table) => table.name === objectKind)) {
      return;
    }
    const key = `${surface}::${objectKind}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  if (hasOwnedBindings) {
    for (const [, entities] of state.populations) {
      for (const entity of entities) {
        for (const binding of entity.surfaceBindings ?? []) {
          add(binding.surface, binding.objectKind);
        }
      }
    }
    return counts;
  }

  for (const [, identity] of state.identities) {
    for (const slot of identity.slots) {
      add(slot.surface, slot.objectKind);
    }
  }

  return counts;
}

function collectActualProjectionCounts(dataset: MaterialisedDataset): Map<string, number> {
  const counts = new Map<string, number>();

  for (const [table, rows] of Object.entries(dataset.tables)) {
    counts.set(`db::${table}`, rows.length);
  }

  for (const [adapter, responseSet] of Object.entries(dataset.apiResponses)) {
    for (const [resource, responses] of Object.entries(responseSet.responses)) {
      counts.set(`${adapter}::${resource}`, responses.length);
    }
  }

  return counts;
}

function describeCoordKey(key: string): string {
  const [surface, objectKind] = key.split('::');
  return `${surface}.${objectKind}`;
}
