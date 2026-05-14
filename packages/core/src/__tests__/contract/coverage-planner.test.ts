import { describe, it, expect } from 'vitest';
import { planCoverage, LOWERING_TARGETS, HELPER_TARGETS } from '../../contract/coverage-planner.js';
import type { Clause } from '../../contract/clause-types.js';

describe('V4.5 coverage planner', () => {
  it('marks well-formed count clauses executable_now', () => {
    const clauses: Clause[] = [
      {
        id: 'overdue-count',
        quote: '3 overdue invoices',
        family: 'count',
        strength: 'hard',
        target: { surface: 'api', name: 'stripe.invoice', filter: { status: 'overdue' } },
        expected: 3,
      },
    ];
    const report = planCoverage(clauses);
    expect(report.decisions[0]!.status).toBe('executable_now');
    expect(report.decisions[0]!.loweringTarget).toBe(LOWERING_TARGETS.row_count);
    expect(report.blockers).toHaveLength(0);
  });

  it('marks semantic billing cohort counts executable_now through the registry', () => {
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

    const report = planCoverage(clauses);
    expect(report.decisions[0]!.status).toBe('executable_now');
    expect(report.decisions[0]!.ruleId).toBe('count.semantic_cohort');
    expect(report.blockers).toHaveLength(0);
  });

  it('routes semantic tier distributions to the semantic helper', () => {
    const clauses: Clause[] = [
      {
        id: 'paid-tier-mix',
        quote: '60% starter, 40% pro',
        family: 'distribution',
        strength: 'hard',
        semanticTarget: {
          kind: 'billing_customer_cohort',
          adapter: 'stripe',
          facets: { billingState: 'paying' },
        },
        semanticField: 'tier',
        field: 'plan_nickname',
        values: { starter: 60, pro: 40 },
      },
    ];

    const report = planCoverage(clauses);
    expect(report.decisions[0]!.status).toBe('executable_with_helper');
    expect(report.decisions[0]!.loweringTarget).toBe(HELPER_TARGETS.semantic_distribution);
  });

  it('routes reconciliation clauses with ≥2 valid buckets to a helper', () => {
    const clauses: Clause[] = [
      {
        id: 'mrr-recon',
        quote: 'MRR drop of -$4820 from 5 named causes',
        family: 'reconciliation',
        strength: 'hard',
        metric: 'mrr_delta',
        headline: -4820,
        tolerance: 1,
        buckets: [
          { name: 'churned', value: -3000, target: { surface: 'db', name: 'mrr_events' }, field: 'delta', op: 'sum' },
          { name: 'downgrades', value: -1820, target: { surface: 'db', name: 'mrr_events' }, field: 'delta', op: 'sum' },
        ],
      },
    ];
    const report = planCoverage(clauses);
    expect(report.decisions[0]!.status).toBe('executable_with_helper');
    expect(report.decisions[0]!.loweringTarget).toBe(HELPER_TARGETS.reconciliation);
  });

  it('blocks hard reconciliation clauses with <2 buckets (no guessing)', () => {
    const clauses: Clause[] = [
      {
        id: 'mrr-recon-bad',
        quote: 'MRR drop explained by some causes',
        family: 'reconciliation',
        strength: 'hard',
        metric: 'mrr_delta',
        headline: -100,
        buckets: [
          { name: 'only', value: -100, target: { surface: 'db', name: 'mrr_events' }, field: 'delta', op: 'sum' },
        ],
      },
    ];
    const report = planCoverage(clauses);
    expect(report.decisions[0]!.status).toBe('unsupported_blocking');
    expect(report.blockers).toHaveLength(1);
  });

  it('treats narrative clauses as soft_only', () => {
    const clauses: Clause[] = [
      {
        id: 'tone',
        quote: 'tone is friendly but firm',
        family: 'narrative',
        strength: 'soft',
        note: 'tone is friendly but firm',
      },
    ];
    const report = planCoverage(clauses);
    expect(report.decisions[0]!.status).toBe('soft_only');
    expect(report.blockers).toHaveLength(0);
  });

  it('blocks unknown hard clauses; degrades unknown soft clauses', () => {
    const clauses: Clause[] = [
      {
        id: 'hard-broken',
        quote: 'something hard',
        family: 'count',
        strength: 'hard',
        // missing target / expected — no rule should match
        target: undefined as any,
        expected: undefined as any,
      } as Clause,
      {
        id: 'soft-broken',
        quote: 'something soft',
        family: 'count',
        strength: 'soft',
        target: undefined as any,
        expected: undefined as any,
      } as Clause,
    ];
    const report = planCoverage(clauses);
    expect(report.decisions[0]!.status).toBe('unsupported_blocking');
    expect(report.decisions[1]!.status).toBe('soft_only');
  });
});
