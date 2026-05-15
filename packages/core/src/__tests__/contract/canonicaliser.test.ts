/**
 * Phase 3 — Canonicaliser tests.
 */
import { describe, it, expect } from 'vitest';
import { canonicaliseContract } from '../../contract/canonicaliser.js';
import type {
  AggregateClause,
  AnchorClause,
  Clause,
  CountClause,
  CrossSurfaceClause,
  DistributionClause,
  NarrativeClause,
  ReconciliationClause,
  TemporalClause,
} from '../../contract/clause-types.js';
import type { PersonaContract } from '../../contract/persona-contract.js';

function makeContract(clauses: Clause[]): PersonaContract {
  return {
    personaId: 'p',
    domain: 'test',
    persona: { name: 'T', age: 30, occupation: 'eng', location: 'SF', salary: null, description: '' },
    source: { name: 'T', description: '' },
    clauses,
    anchors: [],
    compiledAt: new Date().toISOString(),
    compilerVersion: 'v5',
  };
}

describe('canonicaliser', () => {
  it('resolves a billing_customer_cohort count clause onto paying_customers', () => {
    const clause: CountClause = {
      id: 'c1',
      quote: '100 starter customers on Stripe',
      family: 'count',
      strength: 'hard',
      semanticTarget: {
        kind: 'billing_customer_cohort',
        adapter: 'stripe',
        facets: { billingState: 'paying', tier: 'starter' },
      },
      expected: 100,
    };
    const out = canonicaliseContract(makeContract([clause]));
    expect(out.clauses[0]!.canonicalTarget).toEqual({
      populationId: 'paying_customers:stripe',
      cohortRule: { tier: 'starter' },
      metricId: 'count',
    });
    expect(out.clauses[0]!.canonicalisationGap).toBeUndefined();
  });

  it('canonicalises an aggregate sum on MRR onto the mrr metric', () => {
    const clause: AggregateClause = {
      id: 'c2',
      quote: '£127k MRR among paying customers',
      family: 'aggregate',
      op: 'sum',
      strength: 'hard',
      field: 'mrr',
      expected: 12700000,
      semanticTarget: {
        kind: 'billing_customer_cohort',
        adapter: 'stripe',
        facets: { billingState: 'paying' },
      },
    };
    const out = canonicaliseContract(makeContract([clause]));
    expect(out.clauses[0]!.canonicalTarget).toEqual({
      populationId: 'paying_customers:stripe',
      metricId: 'mrr',
    });
  });

  it('canonicalises product-user revenue aggregates onto product populations with canonical revenue metrics', () => {
    const clause: AggregateClause = {
      id: 'c2b',
      quote: '£77k MRR on Stripe',
      family: 'aggregate',
      op: 'sum',
      strength: 'hard',
      field: 'mrr_cents',
      expected: 7_700_000,
      target: {
        surface: 'db',
        name: 'users',
        filter: { status: 'active', plan: { neq: 'free' }, billing_platform: 'stripe' },
      },
      semanticTarget: {
        kind: 'product_user_cohort',
        table: 'users',
        facets: { billingState: 'paying' },
      },
    };
    const out = canonicaliseContract(makeContract([clause]));
    expect(out.clauses[0]!.canonicalTarget).toEqual({
      populationId: 'product:users:paying',
      cohortRule: { status: 'active', plan: { neq: 'free' }, billing_platform: 'stripe' },
      metricId: 'mrr',
    });
  });

  it('promotes free billing state into the free_customers population', () => {
    const clause: CountClause = {
      id: 'c3',
      quote: '847 free-tier users',
      family: 'count',
      strength: 'hard',
      semanticTarget: {
        kind: 'billing_customer_cohort',
        adapter: 'stripe',
        facets: { billingState: 'free' },
      },
      expected: 847,
    };
    const out = canonicaliseContract(makeContract([clause]));
    expect(out.clauses[0]!.canonicalTarget?.populationId).toBe('free_customers:stripe');
  });

  it('falls back to raw db target when no semantic target is given', () => {
    const clause: CountClause = {
      id: 'c4',
      quote: '847 free-tier users',
      family: 'count',
      strength: 'hard',
      target: { surface: 'db', name: 'users', filter: { plan: 'free' } },
      expected: 847,
    };
    const out = canonicaliseContract(makeContract([clause]));
    expect(out.clauses[0]!.canonicalTarget).toEqual({
      populationId: 'db:users',
      cohortRule: { plan: 'free' },
      metricId: 'count',
    });
  });

  it('lifts a temporal window clause into start/end + granularity', () => {
    const clause: TemporalClause = {
      id: 'c5',
      quote: '8 failed charges this week',
      family: 'temporal',
      kind: 'window',
      strength: 'hard',
      target: { surface: 'api', name: 'stripe.charge', filter: { status: 'failed' } },
      field: 'created',
      min: '2026-05-08',
      max: '2026-05-15',
      expected: 8,
    };
    const out = canonicaliseContract(makeContract([clause]));
    const ct = out.clauses[0]!.canonicalTarget!;
    expect(ct.populationId).toBe('api:stripe.charge');
    expect(ct.cohortRule).toEqual({ status: 'failed' });
    expect(ct.metricId).toBe('count');
    expect(ct.window).toEqual({
      start: '2026-05-08',
      end: '2026-05-15',
      granularity: 'week',
    });
  });

  it('marks a clause with no target as unresolved + attaches a gap', () => {
    const clause: CountClause = {
      id: 'c6',
      quote: 'unspecified',
      family: 'count',
      strength: 'hard',
      expected: 1,
    };
    const out = canonicaliseContract(makeContract([clause]));
    expect(out.clauses[0]!.canonicalTarget?.populationId).toBe('unresolved');
    expect(out.clauses[0]!.canonicalisationGap).toMatchObject({
      reason: expect.stringContaining('count'),
      unresolvedText: '(no target)',
      quote: 'unspecified',
    });
  });

  it('canonicalises a reconciliation clause onto its metric', () => {
    const clause: ReconciliationClause = {
      id: 'mrr-drop',
      quote: 'MRR drop of -$4,820 explained by 5 causes',
      family: 'reconciliation',
      strength: 'hard',
      metric: 'mrr_change',
      headline: -4820,
      buckets: [
        { name: 'churn', value: -2000, target: { surface: 'api', name: 'stripe.subscription' }, field: 'mrr', op: 'sum' },
        { name: 'downgrade', value: -1500, target: { surface: 'api', name: 'stripe.subscription' }, field: 'mrr', op: 'sum' },
        { name: 'refunds', value: -800, target: { surface: 'api', name: 'stripe.subscription' }, field: 'mrr', op: 'sum' },
        { name: 'failed', value: -400, target: { surface: 'api', name: 'stripe.subscription' }, field: 'mrr', op: 'sum' },
        { name: 'pause', value: -120, target: { surface: 'api', name: 'stripe.subscription' }, field: 'mrr', op: 'sum' },
      ],
    };
    const out = canonicaliseContract(makeContract([clause]));
    expect(out.clauses[0]!.canonicalTarget).toEqual({
      populationId: 'api:stripe.subscription',
      metricId: 'mrr_change',
    });
  });

  it('stamps narrative clauses with the narrative_only population', () => {
    const clause: NarrativeClause = {
      id: 'tone',
      quote: 'tone is friendly but firm',
      family: 'narrative',
      strength: 'soft',
      note: 'tone is friendly but firm',
    };
    const out = canonicaliseContract(makeContract([clause]));
    expect(out.clauses[0]!.canonicalTarget?.populationId).toBe('narrative_only');
  });

  it('treats anchor clauses as their own population with an inferred window', () => {
    const clause: AnchorClause = {
      id: 'klein',
      quote: 'Klein Records duplicate charge on Apr 29',
      family: 'anchor',
      strength: 'hard',
      anchorId: 'klein-double-charge',
      customer: 'Klein Records',
      dates: { event: '2026-04-29' },
    };
    const out = canonicaliseContract(makeContract([clause]));
    expect(out.clauses[0]!.canonicalTarget?.populationId).toBe('anchor:klein-double-charge');
    expect(out.clauses[0]!.canonicalTarget?.window).toEqual({
      start: '2026-04-29',
      end: '2026-04-29',
      granularity: 'day',
    });
  });

  it('handles distribution clauses by canonicalising the underlying cohort', () => {
    const clause: DistributionClause = {
      id: 'dist',
      quote: '60% starter / 30% pro / 10% enterprise',
      family: 'distribution',
      strength: 'hard',
      field: 'tier',
      values: { starter: 60, pro: 30, enterprise: 10 },
      semanticTarget: {
        kind: 'billing_customer_cohort',
        adapter: 'stripe',
        facets: { billingState: 'paying' },
      },
      semanticField: 'tier',
    };
    const out = canonicaliseContract(makeContract([clause]));
    expect(out.clauses[0]!.canonicalTarget?.populationId).toBe('paying_customers:stripe');
    expect(out.clauses[0]!.canonicalTarget?.metricId).toBe('count');
  });

  it('canonicalises a cross_surface clause onto a cross_surface synthetic population', () => {
    const clause: CrossSurfaceClause = {
      id: 'larkspur-drift',
      quote: 'Larkspur active in Postgres, canceled in Stripe',
      family: 'cross_surface',
      strength: 'hard',
      entity: 'Larkspur',
      surfaceA: { surface: 'db', name: 'subscriptions' },
      surfaceB: { surface: 'api', name: 'stripe.subscription' },
      field: 'status',
      valueA: 'active',
      valueB: 'canceled',
      driftDays: 9,
    };
    const out = canonicaliseContract(makeContract([clause]));
    expect(out.clauses[0]!.canonicalTarget?.populationId).toBe('cross_surface:Larkspur');
    expect(out.clauses[0]!.canonicalTarget?.metricId).toBe('cross_surface_field');
  });
});

describe('canonicaliser anti-test: no parallel structure', () => {
  it('does not declare a CanonicalContract type or a Map<.*Canonical', async () => {
    // Anti-test required by the implementation plan. The canonicaliser
    // must enrich clauses in place, never produce a sidecar map keyed by
    // clauseId.
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(
      new URL('../../contract/canonicaliser.ts', import.meta.url),
      'utf8',
    );
    // Declarations only — a passing comment mentioning the forbidden
    // name as a non-goal is fine. We want no TYPE, INTERFACE, CLASS, or
    // CONST named CanonicalContract, and no Map<...Canonical...> values.
    expect(src).not.toMatch(/\b(?:type|interface|class|const|let|var)\s+CanonicalContract\b/);
    expect(src).not.toMatch(/Map<[^>]*Canonical[^>]*>/);
  });
});
