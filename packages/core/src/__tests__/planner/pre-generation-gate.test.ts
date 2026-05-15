/**
 * Phase 4 — Pre-generation gate tests.
 */
import { describe, it, expect } from 'vitest';
import { canonicaliseContract } from '../../contract/canonicaliser.js';
import {
  runPreGenerationGate,
  OWNERS_REGISTRY_VERSION,
} from '../../planner/index.js';
import type {
  AnchorClause,
  Clause,
  CountClause,
  CrossSurfaceClause,
  ReconciliationClause,
  TemporalClause,
} from '../../contract/clause-types.js';
import type { PersonaContract } from '../../contract/persona-contract.js';

function makeContract(clauses: Clause[]): PersonaContract {
  return canonicaliseContract({
    personaId: 'p',
    domain: 'test',
    persona: {
      name: 'T',
      age: 30,
      occupation: 'eng',
      location: 'SF',
      salary: null,
      description: '',
    },
    source: { name: 'T', description: '' },
    clauses,
    anchors: [],
    compiledAt: new Date().toISOString(),
    compilerVersion: 'v5',
  });
}

describe('pre-generation gate', () => {
  it('passes a clean contract and emits an obligation graph covering every hard clause exactly once', () => {
    const clauses: Clause[] = [
      {
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
      } as CountClause,
      {
        id: 'c2',
        quote: '8 failed charges this week',
        family: 'temporal',
        kind: 'window',
        strength: 'hard',
        target: { surface: 'api', name: 'stripe.charge', filter: { status: 'failed' } },
        field: 'created',
        min: '2026-05-08',
        max: '2026-05-15',
        expected: 8,
      } as TemporalClause,
      {
        id: 'c3',
        quote: 'Klein duplicate charge on Apr 29',
        family: 'anchor',
        strength: 'hard',
        anchorId: 'klein',
        customer: 'Klein Records',
        dates: { event: '2026-04-29' },
      } as AnchorClause,
    ];
    const contract = makeContract(clauses);
    const result = runPreGenerationGate(contract);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.obligationGraph.nodes).toHaveLength(3);
    const ids = result.obligationGraph.nodes.map((n) => n.clauseId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.obligationGraph.byClauseId.get('c1')?.ownerId).toBe('population');
    expect(result.obligationGraph.byClauseId.get('c2')?.ownerId).toBe('lifecycle');
    expect(result.obligationGraph.byClauseId.get('c3')?.ownerId).toBe('anchor');
  });

  it('reports a sum-identity contradiction', () => {
    const clause: ReconciliationClause = {
      id: 'mrr-drop',
      quote: 'MRR drop of -$4,820 explained by 5 causes',
      family: 'reconciliation',
      strength: 'hard',
      metric: 'mrr_change',
      headline: -4820,
      buckets: [
        { name: 'churn', value: -2000, target: { surface: 'api', name: 'stripe.subscription' }, field: 'mrr', op: 'sum' },
        { name: 'downgrade', value: -1000, target: { surface: 'api', name: 'stripe.subscription' }, field: 'mrr', op: 'sum' },
        // Sum is only -3000 — does not match headline -4820.
      ],
    };
    const result = runPreGenerationGate(makeContract([clause]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.report.contradictions[0]?.ruleId).toBe('sum_identity');
    expect(result.report.contradictions[0]?.clauseIds).toContain('mrr-drop');
  });

  it('reports a population-coherence contradiction when two count clauses disagree on the same cohort', () => {
    const a: CountClause = {
      id: 'starter-a',
      quote: '100 starter customers',
      family: 'count',
      strength: 'hard',
      semanticTarget: {
        kind: 'billing_customer_cohort',
        adapter: 'stripe',
        facets: { billingState: 'paying', tier: 'starter' },
      },
      expected: 100,
    };
    const b: CountClause = {
      id: 'starter-b',
      quote: '200 starter customers',
      family: 'count',
      strength: 'hard',
      semanticTarget: {
        kind: 'billing_customer_cohort',
        adapter: 'stripe',
        facets: { billingState: 'paying', tier: 'starter' },
      },
      expected: 200,
    };
    const result = runPreGenerationGate(makeContract([a, b]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.report.contradictions.some((f) => f.ruleId === 'population_coherence')).toBe(true);
  });

  it('reports an anchor uniqueness contradiction when two clauses bind the same anchorId to different customers', () => {
    const a: AnchorClause = {
      id: 'a1',
      quote: 'Klein duplicate charge on Apr 29',
      family: 'anchor',
      strength: 'hard',
      anchorId: 'shared',
      customer: 'Klein Records',
      dates: { event: '2026-04-29' },
    };
    const b: AnchorClause = {
      id: 'a2',
      quote: 'Larkspur duplicate charge on Apr 29',
      family: 'anchor',
      strength: 'hard',
      anchorId: 'shared',
      customer: 'Larkspur',
      dates: { event: '2026-04-29' },
    };
    const result = runPreGenerationGate(makeContract([a, b]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.report.contradictions.some((f) => f.ruleId === 'anchor_uniqueness')).toBe(true);
  });

  it('reports a cross-surface consistency contradiction when two clauses on the same entity disagree', () => {
    const a: CrossSurfaceClause = {
      id: 'cs1',
      quote: 'Larkspur active in db, canceled in stripe',
      family: 'cross_surface',
      strength: 'hard',
      entity: 'Larkspur',
      surfaceA: { surface: 'db', name: 'subscriptions' },
      surfaceB: { surface: 'api', name: 'stripe.subscription' },
      field: 'status',
      valueA: 'active',
      valueB: 'canceled',
    };
    const b: CrossSurfaceClause = {
      id: 'cs2',
      quote: 'Larkspur paused in db, active in stripe',
      family: 'cross_surface',
      strength: 'hard',
      entity: 'Larkspur',
      surfaceA: { surface: 'db', name: 'subscriptions' },
      surfaceB: { surface: 'api', name: 'stripe.subscription' },
      field: 'status',
      valueA: 'paused',
      valueB: 'active',
    };
    const result = runPreGenerationGate(makeContract([a, b]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.report.contradictions.some((f) => f.ruleId === 'cross_surface_consistency')).toBe(true);
  });

  it('reports a missing owner when a hard clause has no resolvable canonical target', () => {
    const clause: CountClause = {
      id: 'orphan',
      quote: 'we want a thing',
      family: 'count',
      strength: 'hard',
      expected: 1,
    };
    const result = runPreGenerationGate(makeContract([clause]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The canonicaliser sets `populationId='unresolved'` here, so the gate
    // surfaces this as a canonicalisation gap (not a missing-owner failure).
    expect(result.report.canonicalisationGaps).toHaveLength(1);
    expect(result.report.summary).toContain(OWNERS_REGISTRY_VERSION);
  });

  it('combines contradictions, missing owners and gaps in a single report (no short-circuit)', () => {
    const contradiction: ReconciliationClause = {
      id: 'mrr-drop',
      quote: 'MRR drop of -$4,820 explained by 5 causes',
      family: 'reconciliation',
      strength: 'hard',
      metric: 'mrr_change',
      headline: -4820,
      buckets: [
        { name: 'churn', value: -2000, target: { surface: 'api', name: 'stripe.subscription' }, field: 'mrr', op: 'sum' },
      ],
    };
    const gap: CountClause = {
      id: 'orphan',
      quote: 'we want a thing',
      family: 'count',
      strength: 'hard',
      expected: 1,
    };
    const result = runPreGenerationGate(makeContract([contradiction, gap]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.report.contradictions.length).toBeGreaterThan(0);
    expect(result.report.canonicalisationGaps.length).toBeGreaterThan(0);
  });

  it('records owner decisions for every clause, including narrative (no owner)', () => {
    const count: CountClause = {
      id: 'c',
      quote: '5 things',
      family: 'count',
      strength: 'hard',
      target: { surface: 'db', name: 'things' },
      expected: 5,
    };
    const narrative: Clause = {
      id: 'n',
      quote: 'friendly tone',
      family: 'narrative',
      strength: 'soft',
      note: 'friendly tone',
    } as Clause;
    const result = runPreGenerationGate(makeContract([count, narrative]));
    expect(result.ownerDecisions).toHaveLength(2);
    const counts = result.ownerDecisions.find((d) => d.clauseId === 'c');
    const narr = result.ownerDecisions.find((d) => d.clauseId === 'n');
    expect(counts?.ownerId).toBe('population');
    expect(narr?.ownerId).toBeNull();
    expect(narr?.ruleId).toBe('narrative.unowned.v1');
  });
});
