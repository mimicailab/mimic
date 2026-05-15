/**
 * V4.5 helper — reconciliation checker.
 *
 * Confirms that a headline metric equals the sum of named bucket
 * contributions in the expanded data. Examples:
 *   - "MRR drop of -$4,820 explained by 5 named causes."
 *   - "Refunds of $1,200 split across stripe ($800), chargebee ($400)."
 *
 * Rule: a helper reads the final expanded data and computes a checkable
 * result. It does NOT invent hidden state or new entities.
 */

import type { ReconciliationClause } from '../../contract/clause-types.js';
import type { ExpandedData } from '../../types/dataset.js';
import type { Filter, ResourceTarget } from '../../types/claim.js';
import { selectRows } from '../select-rows.js';
import { resolveNumericTolerance } from '../../utils/tolerance.js';

export interface ReconciliationCheckResult {
  passed: boolean;
  headline: number;
  bucketSum: number;
  tolerance: number;
  per_bucket: Array<{
    name: string;
    expected: number;
    actual: number;
    matched_rows: number;
  }>;
  reason?: string;
}

export function checkReconciliation(
  clause: ReconciliationClause,
  expanded: ExpandedData,
): ReconciliationCheckResult {
  const tolerance = resolveNumericTolerance(clause.headline, clause.tolerance);
  const per_bucket: ReconciliationCheckResult['per_bucket'] = [];

  let bucketSum = 0;
  for (const b of clause.buckets) {
    const target: ResourceTarget = {
      ...b.target,
      filter: mergeFilters(b.target.filter, b.filter),
    };
    const rows = selectRows(target, expanded);
    let actual = 0;
    if (b.op === 'count') {
      actual = rows.length;
    } else {
      for (const r of rows) actual += toNumber(r[b.field]);
    }
    bucketSum += actual;
    per_bucket.push({
      name: b.name,
      expected: b.value,
      actual,
      matched_rows: rows.length,
    });
  }

  const delta = Math.abs(bucketSum - clause.headline);
  const passed = delta <= tolerance;

  return {
    passed,
    headline: clause.headline,
    bucketSum,
    tolerance,
    per_bucket,
    reason: passed
      ? undefined
      : `Bucket sum ${bucketSum} does not reconcile to headline ${clause.headline} (delta ${delta}, tolerance ${tolerance}).`,
  };
}

function mergeFilters(a: Filter | undefined, b: Filter | undefined): Filter | undefined {
  if (!a && !b) return undefined;
  return { ...(a ?? {}), ...(b ?? {}) };
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}
