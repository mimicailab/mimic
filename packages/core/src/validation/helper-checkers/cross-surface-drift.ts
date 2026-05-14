/**
 * V4.5 helper — cross-surface drift checker.
 *
 * Confirms that the same entity disagrees (or agrees) between two surfaces
 * in the intended way. Example: "Larkspur is active in Postgres and canceled
 * in Stripe with a 9-day drift."
 */

import type { CrossSurfaceClause } from '../../contract/clause-types.js';
import type { ExpandedData } from '../../types/dataset.js';
import { selectRows } from '../../generate/claim-auditor.js';

export interface CrossSurfaceDriftResult {
  passed: boolean;
  entity: string;
  surfaceA: { target: string; field: string; expected: unknown; actual: unknown[] };
  surfaceB: { target: string; field: string; expected: unknown; actual: unknown[] };
  driftDays?: { expected: number; actual: number | null; tolerance: number };
  reason?: string;
}

export function checkCrossSurfaceDrift(
  clause: CrossSurfaceClause,
  expanded: ExpandedData,
): CrossSurfaceDriftResult {
  const rowsA = selectRows(clause.surfaceA, expanded);
  const rowsB = selectRows(clause.surfaceB, expanded);

  // Filter by entity descriptor — match against any string field that
  // includes the entity name (the persona-side identifier).
  const matchedA = rowsA.filter((r) => containsEntity(r, clause.entity));
  const matchedB = rowsB.filter((r) => containsEntity(r, clause.entity));

  const actualA = matchedA.map((r) => r[clause.field]);
  const actualB = matchedB.map((r) => r[clause.field]);

  const aOk = actualA.some((v) => looseEquals(v, clause.valueA));
  const bOk = actualB.some((v) => looseEquals(v, clause.valueB));

  let driftActual: number | null = null;
  let driftPassed = true;
  let driftTolerance = clause.driftTolerance ?? 0;
  if (typeof clause.driftDays === 'number') {
    // Try common timestamp fields to compute a drift between the two rows.
    const tsA = pickDate(matchedA[0]);
    const tsB = pickDate(matchedB[0]);
    if (tsA != null && tsB != null) {
      driftActual = Math.round((tsB - tsA) / (24 * 3600 * 1000));
      driftPassed = Math.abs(driftActual - clause.driftDays) <= driftTolerance;
    } else {
      driftPassed = false;
    }
  }

  const passed = aOk && bOk && driftPassed && matchedA.length > 0 && matchedB.length > 0;

  return {
    passed,
    entity: clause.entity,
    surfaceA: {
      target: `${clause.surfaceA.surface}.${clause.surfaceA.name}`,
      field: clause.field,
      expected: clause.valueA,
      actual: actualA,
    },
    surfaceB: {
      target: `${clause.surfaceB.surface}.${clause.surfaceB.name}`,
      field: clause.field,
      expected: clause.valueB,
      actual: actualB,
    },
    ...(typeof clause.driftDays === 'number'
      ? {
          driftDays: {
            expected: clause.driftDays,
            actual: driftActual,
            tolerance: driftTolerance,
          },
        }
      : {}),
    reason: passed
      ? undefined
      : buildReason(clause, matchedA.length, matchedB.length, aOk, bOk, driftPassed, driftActual),
  };
}

function containsEntity(row: Record<string, unknown>, entity: string): boolean {
  const needle = entity.toLowerCase();
  for (const v of Object.values(row)) {
    if (typeof v === 'string' && v.toLowerCase().includes(needle)) return true;
  }
  return false;
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === 'string' && typeof b === 'string') {
    return a.toLowerCase() === b.toLowerCase();
  }
  return String(a) === String(b);
}

function pickDate(row: Record<string, unknown> | undefined): number | null {
  if (!row) return null;
  const candidates = [
    'canceled_at',
    'cancelled_at',
    'updated_at',
    'created_at',
    'event_at',
    'occurred_at',
  ];
  for (const k of candidates) {
    const v = row[k];
    if (v == null) continue;
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
    if (typeof v === 'string') {
      const t = new Date(v).getTime();
      if (!Number.isNaN(t)) return t;
    }
  }
  return null;
}

function buildReason(
  clause: CrossSurfaceClause,
  matchedA: number,
  matchedB: number,
  aOk: boolean,
  bOk: boolean,
  driftPassed: boolean,
  driftActual: number | null,
): string {
  const parts: string[] = [];
  if (matchedA === 0)
    parts.push(`no row on ${clause.surfaceA.surface}.${clause.surfaceA.name} matches entity "${clause.entity}"`);
  if (matchedB === 0)
    parts.push(`no row on ${clause.surfaceB.surface}.${clause.surfaceB.name} matches entity "${clause.entity}"`);
  if (matchedA > 0 && !aOk)
    parts.push(`surfaceA.${clause.field} did not include expected ${JSON.stringify(clause.valueA)}`);
  if (matchedB > 0 && !bOk)
    parts.push(`surfaceB.${clause.field} did not include expected ${JSON.stringify(clause.valueB)}`);
  if (typeof clause.driftDays === 'number' && !driftPassed)
    parts.push(`drift ${driftActual ?? 'unavailable'}d does not match expected ${clause.driftDays}d`);
  return parts.join('; ');
}
