/**
 * Phase 6 — Planner orchestrator tests.
 *
 * The planners are deterministic skeletons in V5; tests assert structural
 * shape (entities written, ledger balanced, slots reserved, anchor bound,
 * lifecycle events emitted) plus the plan's explicit invariants:
 *   - churn count matches cohort size
 *   - failed payments respect the window
 *   - identity slots carry no vendor-shaped strings (Phase 6 boundary)
 *   - regenerateFromOwner replays only the affected slice forward
 */
import { describe, it, expect } from 'vitest';
import { canonicaliseContract } from '../../contract/canonicaliser.js';
import {
  PLANNER_ORDER,
  runPlanners,
  regenerateFromOwner,
  runPreGenerationGate,
} from '../../planner/index.js';
import { createWorldState, SeededRandom } from '../../world/index.js';
import type {
  AggregateClause,
  AnchorClause,
  Clause,
  CountClause,
  ReconciliationClause,
  TemporalClause,
} from '../../contract/clause-types.js';
import type { PersonaContract } from '../../contract/persona-contract.js';

function makeContract(clauses: Clause[]): PersonaContract {
  return canonicaliseContract({
    personaId: 'p',
    domain: 'test',
    persona: { name: 'T', age: 30, occupation: 'eng', location: 'SF', salary: null, description: '' },
    source: { name: 'T', description: '' },
    clauses,
    anchors: [],
    compiledAt: new Date().toISOString(),
    compilerVersion: 'v5',
  });
}

function setUp(clauses: Clause[]) {
  const contract = makeContract(clauses);
  const gate = runPreGenerationGate(contract);
  expect(gate.ok).toBe(true);
  if (!gate.ok) throw new Error('gate failed');
  const initial = createWorldState(new SeededRandom(1));
  return { contract, graph: gate.obligationGraph, initial };
}

describe('orchestrator — planner order', () => {
  it('runs planners in the topological order specified in the design doc', () => {
    expect(PLANNER_ORDER).toEqual([
      'population',
      'identity',
      'lifecycle',
      'anchor',
      'reconciliation',
    ]);
  });
});

describe('population planner', () => {
  it('creates the expected number of canonical entities for a count clause', () => {
    const count: CountClause = {
      id: 'starter-100',
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
    const { contract, graph, initial } = setUp([count]);
    const { state } = runPlanners(contract, graph, initial);
    const pop = state.populations.get('paying_customers');
    expect(pop).toHaveLength(100);
    // Every entity carries the cohort label derived from the cohort rule.
    expect([...pop![0]!.cohorts]).toContain('tier:starter');
  });

  it('supports overlapping filtered counts within the same population', () => {
    const active: CountClause = {
      id: 'active-users',
      quote: '10 active users',
      family: 'count',
      strength: 'hard',
      target: { surface: 'db', name: 'users', filter: { status: 'active' } },
      expected: 10,
    };
    const orphans: CountClause = {
      id: 'orphan-users',
      quote: '2 active users with no external id',
      family: 'count',
      strength: 'hard',
      target: {
        surface: 'db',
        name: 'users',
        filter: { status: 'active', external_id: { is_null: true } },
      },
      expected: 2,
    };
    const { contract, graph, initial } = setUp([active, orphans]);
    const { state } = runPlanners(contract, graph, initial);
    const users = state.populations.get('db:users') ?? [];

    expect(users).toHaveLength(10);
    expect(users.filter((user) => user.attrs.status === 'active')).toHaveLength(10);
    expect(users.filter((user) => user.attrs.external_id == null)).toHaveLength(2);
  });
});

describe('lifecycle planner', () => {
  it('emits N events inside the requested window (failed payments respect window)', () => {
    const count: CountClause = {
      id: 'starter-100',
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
    const failed: TemporalClause = {
      id: 'failed-charges',
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
    const { contract, graph, initial } = setUp([count, failed]);
    const { state } = runPlanners(contract, graph, initial);
    const failures = state.lifecycleEvents.filter((e) => e.kind === 'failure');
    expect(failures).toHaveLength(8);
    const min = new Date('2026-05-08').getTime();
    const max = new Date('2026-05-15').getTime();
    for (const f of failures) {
      const ts = new Date(f.timestamp).getTime();
      expect(ts).toBeGreaterThanOrEqual(min);
      expect(ts).toBeLessThanOrEqual(max);
    }
  });
});

describe('identity planner — Phase 6 boundary', () => {
  it('reserves slots with adapter-agnostic seeds, never vendor-formatted IDs', () => {
    const count: CountClause = {
      id: 'c',
      quote: '3 customers',
      family: 'count',
      strength: 'hard',
      target: { surface: 'api', name: 'stripe.customer' },
      expected: 3,
    };
    const { contract, graph, initial } = setUp([count]);
    const { state } = runPlanners(contract, graph, initial);
    expect(state.identities.size).toBe(3);
    for (const [, record] of state.identities) {
      for (const slot of record.slots) {
        // The planner MUST NOT emit Stripe-style IDs (cus_…, sub_…) or
        // any other vendor prefix. Projection mints those.
        expect(slot.deterministicSeed).not.toMatch(/^(cus|sub|inv|pi|ch)_/i);
        expect(slot.deterministicSeed).toContain(record.entityId);
      }
    }
  });
});

describe('anchor planner', () => {
  it('binds named anchors to entities and writes AnchorBinding', () => {
    const count: CountClause = {
      id: 'c',
      quote: '5 customers',
      family: 'count',
      strength: 'hard',
      target: { surface: 'api', name: 'stripe.customer' },
      expected: 5,
    };
    const anchor: AnchorClause = {
      id: 'klein',
      quote: 'Klein duplicate charge on Apr 29',
      family: 'anchor',
      strength: 'hard',
      anchorId: 'klein-dup',
      customer: 'Klein Records',
      dates: { event: '2026-04-29' },
    };
    const { contract, graph, initial } = setUp([count, anchor]);
    const { state } = runPlanners(contract, graph, initial);
    const binding = state.anchors.get('klein-dup');
    expect(binding).toBeDefined();
    expect(binding!.dates).toEqual({ event: '2026-04-29' });

    const bound = [...state.populations.values()]
      .flat()
      .find((entity) => entity.id === binding!.entityId);
    expect(bound).toBeDefined();
    expect(bound!.attrs.company ?? bound!.attrs.name).toBe('Klein Records');
  });
});

describe('population planner — aggregate-only targets', () => {
  it('materialises a raw aggregate target even when no separate count clause exists', () => {
    const price: AggregateClause = {
      id: 'starter-price',
      quote: 'starter (£29/mo)',
      family: 'aggregate',
      op: 'sum',
      strength: 'hard',
      target: {
        surface: 'api',
        name: 'stripe.price',
        filter: { nickname: 'starter-monthly' },
      },
      field: 'unit_amount',
      expected: 2900,
    };
    const { contract, graph, initial } = setUp([price]);
    const { state } = runPlanners(contract, graph, initial);
    const prices = state.populations.get('api:stripe.price') ?? [];

    expect(prices).toHaveLength(1);
    expect(prices[0]!.attrs.nickname).toBe('starter-monthly');
    expect(prices[0]!.attrs.unit_amount).toBe(2900);
  });
});

describe('reconciliation planner', () => {
  it('writes a balanced budget ledger keyed by the canonical metric', () => {
    const recon: ReconciliationClause = {
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
    const { contract, graph, initial } = setUp([recon]);
    const { state } = runPlanners(contract, graph, initial);
    const ledger = state.budgets.get('mrr_change');
    expect(ledger).toBeDefined();
    expect(ledger!.total).toBe(-4820);
    expect(ledger!.parts.size).toBe(5);
    expect(
      [...ledger!.parts.values()].reduce((s, v) => s + v, 0),
    ).toBe(-4820);
  });
});

describe('regenerateFromOwner', () => {
  it('rebuilds the affected slice instead of appending duplicate state', () => {
    const count: CountClause = {
      id: 'starter-100',
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
    const failed: TemporalClause = {
      id: 'failed-charges',
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
    const { contract, graph, initial } = setUp([count, failed]);
    const { state: first } = runPlanners(contract, graph, initial);
    expect(first.populations.get('paying_customers')).toHaveLength(100);
    expect(first.lifecycleEvents.filter((e) => e.kind === 'failure')).toHaveLength(8);

    const { state } = regenerateFromOwner(contract, graph, first, 'population');
    expect(state.populations.get('paying_customers')).toHaveLength(100);
    expect(state.lifecycleEvents.filter((e) => e.kind === 'failure')).toHaveLength(8);
  });

  it('throws on an unknown owner', () => {
    const count: CountClause = {
      id: 'c',
      quote: '5 customers',
      family: 'count',
      strength: 'hard',
      target: { surface: 'db', name: 'users' },
      expected: 5,
    };
    const { contract, graph, initial } = setUp([count]);
    const { state } = runPlanners(contract, graph, initial);
    expect(() =>
      regenerateFromOwner(contract, graph, state, 'banana' as unknown as 'population'),
    ).toThrow();
  });
});
