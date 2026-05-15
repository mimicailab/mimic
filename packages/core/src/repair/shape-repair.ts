/**
 * V5 — Phase 10: Deterministic shape-only repair.
 *
 * Runs ONLY on `local-only` shape validator results. Allowed ops:
 *
 *   - missing ID generation (deterministic prefix + suffix)
 *   - format / casing of string fields
 *   - FK wiring across already-emitted rows
 *   - schema-shape conformance (drop extras, fill required nullables)
 *
 * Forbidden ops throw `IllegalRepairError`:
 *
 *   - rewriting counts / cohort membership
 *   - reassigning anchors
 *   - rewriting cross-surface meaning
 *   - rewriting budgets
 *
 * The repair loop is bounded: callers re-validate after each repair pass
 * and escalate to an `OwnerLevelFailureReport{cause: 'shape_owner_level'}`
 * if convergence isn't reached within 2 attempts.
 */

import type { SchemaModel } from '../types/schema.js';
import type { MaterialisedDataset } from '../projection/types.js';
import type { ShapeFailure } from '../validation/shape-validator.js';
import { getPersonaIdPrefix } from '../projection/identity-prefix.js';

// ---------------------------------------------------------------------------
// Illegal-op surface (planters of semantic intent — these throw)
// ---------------------------------------------------------------------------

export class IllegalRepairError extends Error {
  constructor(public readonly op: string, public readonly reason: string) {
    super(`Illegal shape repair op "${op}": ${reason}. Semantic concerns must regenerate via the owning planner, not be patched in output.`);
    this.name = 'IllegalRepairError';
  }
}

const FORBIDDEN_OPS = [
  'set_count',
  'add_cohort',
  'remove_cohort',
  'reassign_anchor',
  'rewrite_cross_surface_value',
  'rewrite_budget_part',
];

/**
 * Test seam (also exposed for the Phase 13 import-lint fixture). Any
 * attempted forbidden op throws — V5 forbids semantic patching of output.
 */
export function performRepairOp(op: string, _payload?: unknown): never {
  if (FORBIDDEN_OPS.includes(op)) {
    throw new IllegalRepairError(op, 'rewrites semantic intent; the owning planner must regenerate');
  }
  throw new IllegalRepairError(op, 'unknown shape-repair op');
}

// ---------------------------------------------------------------------------
// Public entry point — drives all 5 allowed ops in one pass
// ---------------------------------------------------------------------------

export interface ShapeRepairResult {
  /** A NEW dataset; the input is not mutated. */
  repaired: MaterialisedDataset;
  /** Op tags applied, in order. For telemetry only. */
  appliedOps: string[];
}

export function repairShape(
  materialised: MaterialisedDataset,
  failures: ShapeFailure[],
  schema?: SchemaModel,
): ShapeRepairResult {
  // Deep-clone the dataset so projector output stays immutable. This is
  // cheap enough at the scales V5 personas produce (tens of thousands of
  // rows at most); we'll switch to a fancier copy-on-write if a future
  // scale benchmark forces our hand.
  const next: MaterialisedDataset = {
    tables: Object.fromEntries(
      Object.entries(materialised.tables).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]),
    ),
    apiResponses: Object.fromEntries(
      Object.entries(materialised.apiResponses).map(([adapter, set]) => [
        adapter,
        {
          adapterId: set.adapterId,
          responses: Object.fromEntries(
            Object.entries(set.responses).map(([k, resps]) => [
              k,
              resps.map((r) => ({ ...r, body: deepCopyBody(r.body) })),
            ]),
          ),
        },
      ]),
    ),
  };

  const appliedOps: string[] = [];

  for (const failure of failures) {
    // V5 contract: shape-repair must NEVER accept an owner-level
    // failure. The shape validator's typing pins this at compile time
    // (owner-level kinds carry `scope: 'owner-level'`), but we belt-and-
    // braces it here so a future bug can't slip a regression past.
    if (failure.scope !== 'local') {
      throw new IllegalRepairError(
        failure.kind,
        `failure has scope "${failure.scope}" — only 'local' failures may be repaired`,
      );
    }

    switch (failure.kind) {
      case 'missing_id':
        if (failure.surface === 'db') {
          const row = next.tables[failure.target]?.[failure.index];
          if (row) {
            row.id = mintId('row', `${failure.target}-${failure.index}`);
            appliedOps.push(`missing_id:db:${failure.target}[${failure.index}]`);
          }
        } else {
          const resp = next.apiResponses[failure.target.split('.')[0]!]?.responses[
            failure.target.split('.')[1] ?? ''
          ]?.[failure.index];
          if (resp && typeof resp.body === 'object' && resp.body !== null) {
            const adapter = failure.target.split('.')[0]!;
            const resource = failure.target.split('.')[1] ?? 'r';
            (resp.body as Record<string, unknown>).id = mintId(
              resource.slice(0, 3),
              `${adapter}-${resource}-${failure.index}`,
            );
            appliedOps.push(`missing_id:api:${failure.target}[${failure.index}]`);
          }
        }
        break;

      case 'schema_mismatch': {
        const rows = next.tables[failure.table];
        const row = rows?.[failure.rowIndex];
        if (!row) break;
        // Drop unexpected columns
        for (const col of failure.unexpected) {
          delete row[col];
        }
        // Fill required nullables with explicit defaults
        const tableInfo = schema?.tables.find((t) => t.name === failure.table);
        for (const col of failure.missing) {
          const colInfo = tableInfo?.columns.find((c) => c.name === col);
          row[col] = defaultForColumn(colInfo?.type);
        }
        appliedOps.push(`schema_mismatch:${failure.table}[${failure.rowIndex}]`);
        break;
      }

      case 'format_violation':
      case 'casing_violation':
        // Placeholder: only triggers when the validator emits these
        // kinds, which the Phase 9 validator currently doesn't (the
        // canonical entity attrs land verbatim). Phase 13 can extend
        // both ends once we know what formats the validator should
        // enforce.
        appliedOps.push(`${failure.kind}:noop`);
        break;

      case 'fk_unresolved':
        // Placeholder: Phase 9 doesn't emit fk_unresolved yet. When it
        // does (Phase 13 sweep), this op walks the identity table for a
        // matching external_id and writes the FK column.
        appliedOps.push(`fk_unresolved:noop`);
        break;
    }
  }

  return { repaired: next, appliedOps };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mintId(prefix: string, seed: string): string {
  const tail = seed.replace(/[^a-z0-9]/gi, '').slice(-10).toLowerCase();
  return `${getPersonaIdPrefix(`${prefix}_`, 1)}${tail}`;
}

function defaultForColumn(type: string | undefined): unknown {
  if (!type) return null;
  const t = type.toLowerCase();
  if (t.includes('int') || t.includes('numeric') || t.includes('decimal') || t.includes('float')) return 0;
  if (t.includes('bool')) return false;
  if (t.includes('date') || t.includes('time')) return new Date(0).toISOString();
  return '';
}

function deepCopyBody(body: unknown): unknown {
  if (body == null || typeof body !== 'object') return body;
  return JSON.parse(JSON.stringify(body));
}
