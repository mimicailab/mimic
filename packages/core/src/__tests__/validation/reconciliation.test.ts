import { describe, it, expect } from 'vitest';
import { checkReconciliation } from '../../validation/helper-checkers/reconciliation.js';
import type { ReconciliationClause } from '../../contract/clause-types.js';
import type { ExpandedData } from '../../types/dataset.js';

function expandedWithTable(rows: Record<string, unknown>[]): ExpandedData {
  return {
    personaId: 't',
    persona: { name: 'T', age: 0, occupation: '', location: '', salary: null, description: '' },
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

  it('treats fractional tolerance as relative to the headline magnitude', () => {
    const clause: ReconciliationClause = {
      id: 'mrr',
      quote: 'approximately £127k MRR across 8 billing platforms',
      family: 'reconciliation',
      strength: 'hard',
      metric: 'total_mrr',
      headline: 12_700_000,
      tolerance: 0.05,
      buckets: [
        { name: 'stripe', value: 7_700_000, target: { surface: 'db', name: 'mrr_events', filter: { bucket: 'stripe' } }, field: 'delta', op: 'sum' },
        { name: 'paddle', value: 2_800_000, target: { surface: 'db', name: 'mrr_events', filter: { bucket: 'paddle' } }, field: 'delta', op: 'sum' },
        { name: 'revenuecat', value: 1_500_000, target: { surface: 'db', name: 'mrr_events', filter: { bucket: 'revenuecat' } }, field: 'delta', op: 'sum' },
        { name: 'chargebee', value: 600_000, target: { surface: 'db', name: 'mrr_events', filter: { bucket: 'chargebee' } }, field: 'delta', op: 'sum' },
      ],
    };
    const expanded = expandedWithTable([
      { bucket: 'stripe', delta: 7_700_000 },
      { bucket: 'paddle', delta: 2_800_000 },
      { bucket: 'revenuecat', delta: 1_500_000 },
      { bucket: 'chargebee', delta: 600_000 },
    ]);
    const result = checkReconciliation(clause, expanded);
    expect(result.passed).toBe(true);
    expect(result.tolerance).toBe(635_000);
  });
});
