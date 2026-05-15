import { describe, it, expect } from 'vitest';
import { softenIncompletePlatformReconciliations } from '../../contract/contract-compiler.js';
import type { Clause, ReconciliationClause } from '../../contract/clause-types.js';

describe('contract compiler post-processing', () => {
  it('softens incomplete platform reconciliations derived from a headline quote', () => {
    const reconciliation: ReconciliationClause = {
      id: 'platform-mrr-reconciliation',
      quote: 'approximately £127k MRR across 8 billing platforms',
      family: 'reconciliation',
      strength: 'hard',
      metric: 'total_mrr',
      headline: 12_700_000,
      tolerance: 0.05,
      buckets: [
        { name: 'stripe', value: 7_700_000, target: { surface: 'db', name: 'users' }, field: 'mrr_cents', op: 'sum' },
        { name: 'paddle', value: 2_800_000, target: { surface: 'db', name: 'users' }, field: 'mrr_cents', op: 'sum' },
        { name: 'revenuecat', value: 1_500_000, target: { surface: 'db', name: 'users' }, field: 'mrr_cents', op: 'sum' },
        { name: 'chargebee', value: 600_000, target: { surface: 'db', name: 'users' }, field: 'mrr_cents', op: 'sum' },
      ],
    };

    const clauses: Clause[] = [reconciliation];
    const softened = softenIncompletePlatformReconciliations(clauses);

    expect(softened).toBe(1);
    expect(reconciliation.strength).toBe('soft');
  });

  it('leaves fully bucketed platform reconciliations hard', () => {
    const reconciliation: ReconciliationClause = {
      id: 'platform-mrr-reconciliation',
      quote: 'approximately £127k MRR across 4 billing platforms',
      family: 'reconciliation',
      strength: 'hard',
      metric: 'total_mrr',
      headline: 12_600_000,
      tolerance: 0.05,
      buckets: [
        { name: 'stripe', value: 7_700_000, target: { surface: 'db', name: 'users' }, field: 'mrr_cents', op: 'sum' },
        { name: 'paddle', value: 2_800_000, target: { surface: 'db', name: 'users' }, field: 'mrr_cents', op: 'sum' },
        { name: 'revenuecat', value: 1_500_000, target: { surface: 'db', name: 'users' }, field: 'mrr_cents', op: 'sum' },
        { name: 'chargebee', value: 600_000, target: { surface: 'db', name: 'users' }, field: 'mrr_cents', op: 'sum' },
      ],
    };

    const clauses: Clause[] = [reconciliation];
    const softened = softenIncompletePlatformReconciliations(clauses);

    expect(softened).toBe(0);
    expect(reconciliation.strength).toBe('hard');
  });
});