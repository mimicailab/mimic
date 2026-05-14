import type { DistributionClause } from '../../contract/clause-types.js';
import type { ExpandedData } from '../../types/dataset.js';
import { selectRows } from '../../generate/claim-auditor.js';
import {
  canonicaliseBillingTierValue,
  extractSemanticFieldValue,
  resolveSemanticTarget,
} from '../../contract/semantic-capabilities.js';

export interface SemanticDistributionResult {
  passed: boolean;
  actual: Record<string, number>;
  reason?: string;
}

export function checkSemanticDistribution(
  clause: DistributionClause,
  expanded: ExpandedData,
): SemanticDistributionResult {
  if (!clause.semanticTarget || !clause.semanticField) {
    return {
      passed: false,
      actual: {},
      reason: 'Distribution clause is missing semanticTarget or semanticField.',
    };
  }

  const resolved = resolveSemanticTarget(clause.semanticTarget);
  if (!resolved) {
    return {
      passed: false,
      actual: {},
      reason: 'No capability registry entry can resolve the semantic distribution target.',
    };
  }

  const rows = selectRows(resolved.target, expanded);
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = extractSemanticFieldValue(
      row as Record<string, unknown>,
      clause.semanticTarget,
      clause.semanticField,
    );
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const actual: Record<string, number> = {};
  const misses: string[] = [];
  const tolerance = clause.tolerance ?? 2;

  for (const [bucket, expected] of Object.entries(clause.values)) {
    const canonicalBucket = canonicaliseBillingTierValue(bucket) ?? bucket;
    const pct = total === 0 ? 0 : ((counts[canonicalBucket] ?? 0) / total) * 100;
    actual[canonicalBucket] = pct;
    if (Math.abs(pct - expected) > tolerance) {
      misses.push(`${canonicalBucket}: expected ${expected}%, got ${pct.toFixed(1)}%`);
    }
  }

  return {
    passed: misses.length === 0,
    actual,
    reason: misses.length === 0 ? undefined : misses.join('; '),
  };
}