/**
 * Row selection — target + filter → row[].
 *
 * Extracted from the V4.5 `generate/claim-auditor.ts` so the helper checkers
 * (reconciliation, temporal_gap, cross_surface_drift, semantic_distribution)
 * and the Phase 9 shape validator can share the same selection semantics
 * without depending on the deleted auditor.
 *
 * V5 boundary: this module is the *only* place that knows how to traverse
 * `ExpandedData` for a `ResourceTarget`. Both gates (contract evaluator and
 * shape validator) call `selectRows`; the canonical world holds the truth
 * the projector materialised, and this helper queries that truth.
 */
import type { ResourceTarget, Filter, FilterOp } from '../types/claim.js';
import type { ExpandedData, Row } from '../types/dataset.js';

/**
 * Resolve and filter rows for a ResourceTarget.
 */
export function selectRows(target: ResourceTarget, expanded: ExpandedData): Row[] {
  const all = resolveRows(target, expanded);
  if (!target.filter) return all;
  return all.filter((row) => filterMatches(row, target.filter!));
}

/**
 * Resolve all rows for a target without applying its filter. Used by helpers
 * that need to scan a population (e.g. orphan detection) before applying
 * filters of their own.
 */
export function resolveRows(target: ResourceTarget, expanded: ExpandedData): Row[] {
  if (target.surface === 'db') {
    return (expanded.tables[target.name] ?? []) as Row[];
  }
  // api: "<adapter>.<resource>"
  const dot = target.name.indexOf('.');
  if (dot < 0) return [];
  const adapter = target.name.slice(0, dot);
  const resource = target.name.slice(dot + 1);
  const responses = expanded.apiResponses[adapter]?.responses[resource] ?? [];
  return responses
    .map((r) => r.body)
    .filter(
      (b): b is Record<string, unknown> => b !== null && typeof b === 'object' && !Array.isArray(b),
    ) as Row[];
}

function filterMatches(row: Row, filter: Filter): boolean {
  for (const [field, predicate] of Object.entries(filter)) {
    if (!matchesPredicate(getNested(row, field), predicate)) return false;
  }
  return true;
}

function matchesPredicate(value: unknown, predicate: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => matchesPredicate(item, predicate));
  }

  // A bare-null predicate means "explicitly null" — see the matching
  // note in population-planner.ts::matchesPredicate. Use the `is_null`
  // op to catch missing/empty values as well.
  if (predicate === null) {
    return value === null;
  }
  // Bare value → equality
  if (typeof predicate !== 'object' || Array.isArray(predicate)) {
    return valueEquals(value, predicate);
  }
  const op = predicate as FilterOp;
  if ('eq' in op) return valueEquals(value, op.eq);
  if ('neq' in op) return !valueEquals(value, op.neq);
  if ('in' in op) return op.in.some((v) => valueEquals(value, v));
  if ('nin' in op) return !op.nin.some((v) => valueEquals(value, v));
  if ('gte' in op) return compareScalar(value, op.gte) >= 0;
  if ('lte' in op) return compareScalar(value, op.lte) <= 0;
  if ('gt' in op) return compareScalar(value, op.gt) > 0;
  if ('lt' in op) return compareScalar(value, op.lt) < 0;
  if ('is_null' in op) {
    const isNull = value === null || value === undefined || value === '';
    return isNull === op.is_null;
  }
  if ('age_days_gte' in op) {
    const ms = toMillis(value);
    if (ms == null) return false;
    return ageDays(ms) >= op.age_days_gte;
  }
  if ('age_days_lte' in op) {
    const ms = toMillis(value);
    if (ms == null) return false;
    return ageDays(ms) <= op.age_days_lte;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Value helpers — also exported for helper checkers that compute their own
// aggregates over a selected row set.
// ---------------------------------------------------------------------------

export function valueEquals(a: unknown, b: unknown): boolean {
  if (Array.isArray(a)) return a.some((item) => valueEquals(item, b));
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === 'number' && typeof b === 'string') return a === Number(b);
  if (typeof a === 'string' && typeof b === 'number') return Number(a) === b;
  return false;
}

export function compareScalar(a: unknown, b: number | string): number {
  if (Array.isArray(a)) return compareScalar(firstScalar(a), b);
  if (typeof b === 'number') {
    const an = toNumber(a);
    return an - b;
  }
  const ams = toMillis(a);
  const bms = toMillis(b);
  if (ams != null && bms != null) return ams - bms;
  return String(a).localeCompare(String(b));
}

export function toNumber(v: unknown): number {
  if (Array.isArray(v)) return toNumber(firstScalar(v));
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

export function toMillis(v: unknown): number | null {
  if (Array.isArray(v)) return toMillis(firstScalar(v));
  if (v == null) return null;
  if (typeof v === 'number') {
    // unix seconds vs ms heuristic
    return v < 1e12 ? v * 1000 : v;
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    const t = d.getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function ageDays(ms: number): number {
  return (Date.now() - ms) / (24 * 3600 * 1000);
}

export function readRowField(row: Row, field: string): unknown {
  return getNested(row, field);
}

/** Get a nested field with `a.b.c` dotted paths, traversing arrays as any-match lists. */
function getNested(obj: Record<string, unknown>, path: string): unknown {
  if (!path.includes('.')) return obj[path];
  return getNestedParts(obj, path.split('.'));
}

function getNestedParts(cur: unknown, parts: string[]): unknown {
  if (parts.length === 0) return cur;
  if (Array.isArray(cur)) {
    const values = cur.flatMap((item) => flattenNestedValue(getNestedParts(item, parts)));
    if (values.length === 0) return undefined;
    if (values.length === 1) return values[0];
    return values;
  }
  if (cur == null || typeof cur !== 'object') return undefined;
  const [head, ...tail] = parts;
  return getNestedParts((cur as Record<string, unknown>)[head!], tail);
}

function flattenNestedValue(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((item) => flattenNestedValue(item));
  return [value];
}

export function firstScalar(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  for (const item of value) {
    const nested = firstScalar(item);
    if (nested !== undefined) return nested;
  }
  return undefined;
}
