/**
 * V5 — Phase 7: DB projector.
 *
 * Translates canonical entities + lifecycle events into rows for one DB
 * table. Pure deterministic function of the world state; never mutates
 * its input.
 *
 * The projector is conservative: it emits ONLY the columns it can derive
 * from the canonical entity (id from the entity's identity slot, plus
 * attrs flattened by column name). Tables the schema declares but the
 * world has no entities for emit an empty row list, not an error — the
 * shape validator (Phase 9) decides whether that's acceptable.
 */

import type { SchemaModel } from '../types/schema.js';
import type { Row } from '../types/dataset.js';
import type { WorldState } from '../world/world-state.js';
import { getPersonaIdPrefix } from './identity-prefix.js';

/**
 * Build rows for one DB table from the world state.
 */
export function projectDb(
  state: WorldState,
  tableName: string,
  schema?: SchemaModel,
): Row[] {
  const tableInfo = schema?.tables.find((t) => t.name === tableName);
  const columns = tableInfo?.columns.map((c) => c.name) ?? [];
  const rows: Row[] = [];

  for (const [populationId, entities] of state.populations) {
    void populationId;
    for (const entity of entities) {
      const slot = state.identities
        .get(entity.id)
        ?.slots.find((s) => s.surface === 'db' && s.objectKind === tableName);
      if (!slot) continue;

      const row: Row = {};
      const id = mintDbId(slot.deterministicSeed);
      row.id = id;
      // Canonical entity attrs become row columns when names line up
      // with the schema. Unknown columns are dropped — projectors never
      // invent fields the schema didn't declare.
      for (const [k, v] of Object.entries(entity.attrs)) {
        if (columns.length === 0 || columns.includes(k)) {
          row[k] = v;
        }
      }
      // Lifecycle status maps to a status column when the schema has one.
      if (columns.length === 0 || columns.includes('status')) {
        if (row.status == null) row.status = entity.lifecycle.status;
      }
      if (columns.includes('created_at') && row.created_at == null) {
        row.created_at = entity.lifecycle.start;
      }
      rows.push(row);
    }
  }

  return rows;
}

function mintDbId(seed: string): string {
  // Deterministic, adapter-agnostic — no provider-shaped prefix here.
  // The seed already encodes (entityId, surface, objectKind); we hash to
  // a short stable token for readability.
  const trimmed = seed.replace(/[^a-z0-9]/gi, '').slice(-12).toLowerCase();
  return `${getPersonaIdPrefix('row_', 1)}${trimmed}`;
}
