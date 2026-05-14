import { describe, it, expect } from 'vitest';
import { checkReconciliation } from '../../validation/helper-checkers/reconciliation.js';
import type { ReconciliationClause } from '../../contract/clause-types.js';
import type { ExpandedData } from '../../types/dataset.js';

function expandedWithTable(rows: Record<string, unknown>[]): ExpandedData {
  return {
    personaId: 't',
    blueprint: {} as any,
    tables: { mrr_events: rows },
    documents: {},
    apiResponses: {},
    files: [],
    events: [],
    facts: [],
  };
}

describe('reconciliation helper', () => {
  it('passes when bucket sums reconcile to the headline within tolerance', () => {
    const clause: ReconciliationClause = {
      id: 'mrr',
      quote: 'MRR drop $4820',
      family: 'reconciliation',
      strength: 'hard',
      metric: 'mrr_delta',
      headline: -4820,
      tolerance: 1,
      buckets: [
        { name: 'churned', value: -3000, target: { surface: 'db', name: 'mrr_events', filter: { bucket: 'churned' } }, field: 'delta', op: 'sum' },
        { name: 'downgrade', value: -1820, target: { surface: 'db', name: 'mrr_events', filter: { bucket: 'downgrade' } }, field: 'delta', op: 'sum' },
      ],
    };
    const expanded = expandedWithTable([
      { bucket: 'churned', delta: -2000 },
      { bucket: 'churned', delta: -1000 },
      { bucket: 'downgrade', delta: -1820 },
    ]);
    const result = checkReconciliation(clause, expanded);
    expect(result.passed).toBe(true);
    expect(result.bucketSum).toBe(-4820);
  });

  it('fails when bucket sums miss the headline outside tolerance', () => {
    const clause: ReconciliationClause = {
      id: 'mrr',
      quote: 'MRR drop $4820',
      family: 'reconciliation',
      strength: 'hard',
      metric: 'mrr_delta',
      headline: -4820,
      tolerance: 1,
      buckets: [
        { name: 'churned', value: -3000, target: { surface: 'db', name: 'mrr_events', filter: { bucket: 'churned' } }, field: 'delta', op: 'sum' },
        { name: 'downgrade', value: -1820, target: { surface: 'db', name: 'mrr_events', filter: { bucket: 'downgrade' } }, field: 'delta', op: 'sum' },
      ],
    };
    const expanded = expandedWithTable([
      { bucket: 'churned', delta: -1000 },
      { bucket: 'downgrade', delta: -1820 },
    ]);
    const result = checkReconciliation(clause, expanded);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('does not reconcile');
  });
});
