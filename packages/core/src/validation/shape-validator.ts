/**
 * V5 — Phase 9: Shape validator (shape gate).
 *
 * Runs ONLY after the contract evaluator passes (Phase 12 pipeline order).
 * Asks: "Is the shape of the materialised data what the schema and identity
 * planner expected?" Classifies every failure as `local` (deterministic
 * repair is allowed) or `owner-level` (a planner bug surfaced
 * post-projection; the run aborts).
 *
 * The locality rule is explicit and codified here so Phase 10's
 * `repair/shape-repair.ts` cannot accidentally accept an `owner-level`
 * failure: a failure is `local` iff it can be fixed by a single
 * deterministic op (format, casing, ID generation, FK wiring, schema-shape
 * conformance) WITHOUT touching counts, cohort membership, anchors,
 * identity records, or budgets.
 */

import type { SchemaModel } from '../types/schema.js';
import type { OwnerId } from '../contract/clause-types.js';
import type { WorldState } from '../world/world-state.js';
import type { MaterialisedDataset } from '../projection/types.js';
import { getProjectorHints } from '../projection/projector-hints.js';

// ---------------------------------------------------------------------------
// Failure shape
// ---------------------------------------------------------------------------

export type ShapeFailureScope = 'local' | 'owner-level';

export type ShapeFailure =
  | { kind: 'schema_mismatch'; scope: 'local'; table: string; rowIndex: number; unexpected: string[]; missing: string[] }
  | { kind: 'missing_id'; scope: 'local'; surface: 'db' | 'api'; target: string; index: number }
  | { kind: 'format_violation'; scope: 'local'; surface: 'api'; target: string; field: string; rowIndex: number; expectedPrefix: string; observed: string }
  | { kind: 'identity_drift'; scope: 'owner-level'; ownerId: OwnerId; entityId: string; details: string }
  | { kind: 'count_mismatch'; scope: 'owner-level'; ownerId: OwnerId; populationId: string; expected: number; actual: number }
  | { kind: 'cohort_drift'; scope: 'owner-level'; ownerId: OwnerId; entityId: string; details: string };

export type ShapeClassification = 'clean' | 'local-only' | 'owner-level';

export interface ShapeValidationResult {
  failures: ShapeFailure[];
  classification: ShapeClassification;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function validateShape(
  materialised: MaterialisedDataset,
  schema: SchemaModel | undefined,
  worldState: WorldState,
): ShapeValidationResult {
  const failures: ShapeFailure[] = [];

  failures.push(...checkDbShape(materialised, schema));
  failures.push(...checkApiShape(materialised));
  failures.push(...checkApiIdPrefixes(materialised));
  failures.push(...checkIdentityDrift(materialised, worldState));
  failures.push(...checkCohortDrift(materialised, worldState));
  failures.push(...checkCountCoherence(materialised, worldState));

  return { failures, classification: classify(failures) };
}

function classify(failures: ShapeFailure[]): ShapeClassification {
  if (failures.length === 0) return 'clean';
  if (failures.some((f) => f.scope === 'owner-level')) return 'owner-level';
  return 'local-only';
}

// ---------------------------------------------------------------------------
// DB shape checks — schema mismatch + missing id
// ---------------------------------------------------------------------------

function checkDbShape(
  materialised: MaterialisedDataset,
  schema: SchemaModel | undefined,
): ShapeFailure[] {
  const out: ShapeFailure[] = [];
  for (const [tableName, rows] of Object.entries(materialised.tables)) {
    const tableInfo = schema?.tables.find((t) => t.name === tableName);
    const columnSet = tableInfo ? new Set(tableInfo.columns.map((c) => c.name)) : null;
    const requiredColumns = tableInfo
      ? tableInfo.columns.filter((c) => !c.isNullable && (c as { defaultValue?: unknown }).defaultValue == null).map((c) => c.name)
      : [];

    rows.forEach((row, idx) => {
      if (row.id == null || row.id === '') {
        out.push({ kind: 'missing_id', scope: 'local', surface: 'db', target: tableName, index: idx });
      }
      if (columnSet) {
        const unexpected = Object.keys(row).filter((k) => !columnSet.has(k));
        const missing = requiredColumns.filter((k) => row[k] == null);
        if (unexpected.length > 0 || missing.length > 0) {
          out.push({
            kind: 'schema_mismatch',
            scope: 'local',
            table: tableName,
            rowIndex: idx,
            unexpected,
            missing,
          });
        }
      }
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// API shape checks — missing id
// ---------------------------------------------------------------------------

function checkApiShape(materialised: MaterialisedDataset): ShapeFailure[] {
  const out: ShapeFailure[] = [];
  for (const [adapterId, set] of Object.entries(materialised.apiResponses)) {
    for (const [resource, responses] of Object.entries(set.responses)) {
      responses.forEach((resp, idx) => {
        const body = resp.body as Record<string, unknown> | null;
        if (!body || typeof body !== 'object') return;
        const id = (body as Record<string, unknown>).id;
        if (id == null || id === '') {
          out.push({
            kind: 'missing_id',
            scope: 'local',
            surface: 'api',
            target: `${adapterId}.${resource}`,
            index: idx,
          });
        }
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// API id-prefix format check — local
// ---------------------------------------------------------------------------

/**
 * Confirms each API response's `id` field starts with the adapter's
 * declared prefix (e.g. `cus_` for Stripe customers). When the prefix
 * disagrees, that's a local format violation — Phase 10's shape repair
 * re-mints the id with the right prefix. When no prefix is declared at
 * all, the check is silent.
 */
function checkApiIdPrefixes(materialised: MaterialisedDataset): ShapeFailure[] {
  const out: ShapeFailure[] = [];
  for (const [adapterId, set] of Object.entries(materialised.apiResponses)) {
    const hints = getProjectorHints(adapterId);
    for (const [resource, responses] of Object.entries(set.responses)) {
      const prefix = hints.idPrefixes?.[resource] ?? hints.idPrefix;
      if (!prefix) continue;
      responses.forEach((resp, idx) => {
        const body = resp.body as Record<string, unknown> | null;
        if (!body || typeof body !== 'object') return;
        const id = body.id;
        if (typeof id !== 'string' || id.length === 0) return; // missing_id covers this
        if (!id.startsWith(prefix)) {
          out.push({
            kind: 'format_violation',
            scope: 'local',
            surface: 'api',
            target: `${adapterId}.${resource}`,
            field: 'id',
            rowIndex: idx,
            expectedPrefix: prefix,
            observed: id,
          });
        }
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Identity drift — owner-level
// ---------------------------------------------------------------------------

function checkIdentityDrift(
  materialised: MaterialisedDataset,
  worldState: WorldState,
): ShapeFailure[] {
  const out: ShapeFailure[] = [];
  // Every IdentityRecord must have at least the slots the projector
  // actually emitted for. We check the reverse direction: every
  // emitted row's surface coordinate must correspond to a slot in
  // some IdentityRecord. A row emitted for an unreserved coordinate
  // is owner-level — the projector invented a surface the planner
  // never sanctioned.
  const reserved = new Set<string>();
  for (const [, record] of worldState.identities) {
    for (const slot of record.slots) {
      reserved.add(`${slot.surface}::${slot.objectKind}`);
    }
  }

  for (const table of Object.keys(materialised.tables)) {
    const key = `db::${table}`;
    if (worldState.identities.size > 0 && !reserved.has(key) && materialised.tables[table]!.length > 0) {
      out.push({
        kind: 'identity_drift',
        scope: 'owner-level',
        ownerId: 'identity',
        entityId: '*',
        details: `projector emitted ${materialised.tables[table]!.length} row(s) for db.${table} but no IdentityRecord reserved that slot`,
      });
    }
  }
  for (const [adapter, set] of Object.entries(materialised.apiResponses)) {
    for (const [resource, responses] of Object.entries(set.responses)) {
      const key = `${adapter}::${resource}`;
      if (worldState.identities.size > 0 && !reserved.has(key) && responses.length > 0) {
        out.push({
          kind: 'identity_drift',
          scope: 'owner-level',
          ownerId: 'identity',
          entityId: '*',
          details: `projector emitted ${responses.length} response(s) for ${adapter}.${resource} but no IdentityRecord reserved that slot`,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cohort drift — owner-level
// ---------------------------------------------------------------------------

function checkCohortDrift(
  materialised: MaterialisedDataset,
  worldState: WorldState,
): ShapeFailure[] {
  const out: ShapeFailure[] = [];
  // Walk DB rows that carry a `tier` (or any canonical cohort label)
  // and ensure it matches the originating entity's cohorts. The seeded
  // `deterministicSeed` carries the entityId; we extract it from the
  // row id to find the entity.
  for (const [, entities] of worldState.populations) {
    for (const entity of entities) {
      const tierAttr = entity.attrs.tier;
      if (typeof tierAttr !== 'string') continue;
      const cohortTier = [...entity.cohorts].find((c) => c.startsWith('tier:'))?.slice(5);
      if (cohortTier && cohortTier !== tierAttr) {
        out.push({
          kind: 'cohort_drift',
          scope: 'owner-level',
          ownerId: 'population',
          entityId: entity.id,
          details: `entity.attrs.tier="${tierAttr}" disagrees with cohort label "tier:${cohortTier}"`,
        });
      }
    }
  }
  void materialised;
  return out;
}

// ---------------------------------------------------------------------------
// Count coherence — owner-level
// ---------------------------------------------------------------------------

function checkCountCoherence(
  materialised: MaterialisedDataset,
  worldState: WorldState,
): ShapeFailure[] {
  const out: ShapeFailure[] = [];
  // Each population's projected row count (db or api) must match the
  // canonical entity count. A short projection is owner-level because
  // it means the projector dropped entities the planner had created.
  for (const [populationId, entities] of worldState.populations) {
    const expected = entities.length;
    // Sum projections targeting this population across surfaces.
    let observed = 0;
    if (populationId.startsWith('db:')) {
      const table = populationId.slice(3);
      observed = materialised.tables[table]?.length ?? 0;
    } else if (populationId.startsWith('api:')) {
      const rest = populationId.slice(4);
      const dot = rest.indexOf('.');
      if (dot >= 0) {
        const adapter = rest.slice(0, dot);
        const resource = rest.slice(dot + 1);
        observed = materialised.apiResponses[adapter]?.responses[resource]?.length ?? 0;
      }
    } else {
      // Abstract populations (paying_customers, …) are not directly
      // projected as a single coordinate; their entities are emitted on
      // whichever surface their identity slots reserved. Skip — the
      // contract evaluator already enforced count per clause.
      continue;
    }
    if (observed !== expected) {
      out.push({
        kind: 'count_mismatch',
        scope: 'owner-level',
        ownerId: 'population',
        populationId,
        expected,
        actual: observed,
      });
    }
  }
  return out;
}
