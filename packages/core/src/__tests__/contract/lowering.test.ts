import { describe, it, expect } from 'vitest';
import { lowerContract } from '../../contract/lowering.js';
import { planCoverage } from '../../contract/coverage-planner.js';
import type { Clause } from '../../contract/clause-types.js';

describe('V4.5 lowering', () => {
  it('lowers count clauses to row_count claims with the original quote', () => {
    const clauses: Clause[] = [
      {
        id: 'overdue-count',
        quote: '3 overdue invoices',
        family: 'count',
        strength: 'hard',
        target: { surface: 'api', name: 'stripe.invoice' },
        expected: 3,
      },
    ];
    const coverage = planCoverage(clauses);
    const result = lowerContract(clauses, coverage);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]!.kind).toBe('row_count');
    expect(result.claims[0]!.quote).toBe('3 overdue invoices');
    expect(result.clauseIdToClaimIds['overdue-count']).toHaveLength(1);
  });

  it('registers anchors from anchor-family clauses', () => {
    const clauses: Clause[] = [
      {
        id: 'klein-event',
        quote: 'Klein Records double-charge on 2026-04-29',
        family: 'anchor',
        strength: 'hard',
        anchorId: 'klein_double_charge',
        customer: 'Klein Records',
        dates: { event: '2026-04-29' },
      },
    ];
    const coverage = planCoverage(clauses);
    const result = lowerContract(clauses, coverage);
    expect(result.anchors).toHaveLength(1);
    expect(result.anchors[0]!.id).toBe('klein_double_charge');
    expect(result.anchors[0]!.customer?.match).toBe('Klein Records');
    expect(result.anchors[0]!.dates.event).toBe('2026-04-29');
    expect(result.claims).toHaveLength(0);
  });

  it('lowers semantic billing cohort counts through Stripe subscriptions', () => {
    const clauses: Clause[] = [
      {
        id: 'starter-customers',
        quote: '100 starter customers',
        family: 'count',
        strength: 'hard',
        semanticTarget: {
          kind: 'billing_customer_cohort',
          adapter: 'stripe',
          facets: { billingState: 'paying', tier: 'starter' },
        },
        expected: 100,
      },
    ];
    const coverage = planCoverage(clauses);
    const result = lowerContract(clauses, coverage);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]!.target.surface).toBe('api');
    expect(result.claims[0]!.target.name).toBe('stripe.subscription');
    expect(result.claims[0]!.target.filter).toMatchObject({
      status: { in: ['active', 'trialing', 'past_due', 'unpaid'] },
      'items.data.price.lookup_key': {
        in: expect.arrayContaining(['starter', 'starter-monthly', 'starter_annual']),
      },
    });
  });

  it('skips helper-only clauses without emitting claims', () => {
    const clauses: Clause[] = [
      {
        id: 'mrr-recon',
        quote: 'MRR drop',
        family: 'reconciliation',
        strength: 'hard',
        metric: 'mrr_delta',
        headline: -4820,
        buckets: [
          { name: 'a', value: -3000, target: { surface: 'db', name: 't' }, field: 'd', op: 'sum' },
          { name: 'b', value: -1820, target: { surface: 'db', name: 't' }, field: 'd', op: 'sum' },
        ],
      },
    ];
    const coverage = planCoverage(clauses);
    const result = lowerContract(clauses, coverage);
    expect(result.claims).toHaveLength(0);
    expect(result.skipped.map((s) => s.clauseId)).toContain('mrr-recon');
  });
});
