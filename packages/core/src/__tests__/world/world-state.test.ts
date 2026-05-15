/**
 * Phase 5 — WorldState immutability + conflict tests.
 */
import { describe, it, expect } from 'vitest';
import {
  createWorldState,
  mergeDelta,
  WorldStateConflictError,
  SeededRandom,
  ledgerBalances,
  assertLedgerBalances,
  BudgetIdentityError,
  type CanonicalEntity,
  type WorldStateDelta,
} from '../../world/index.js';

function rng() {
  return new SeededRandom(1);
}

function customer(id: string, populationId = 'paying_customers'): CanonicalEntity {
  return {
    id,
    populationId,
    cohorts: new Set(['paying', 'starter']),
    attrs: { tier: 'starter' },
    lifecycle: { start: '2026-01-01', status: 'active' },
  };
}

describe('WorldState — merge preserves immutability', () => {
  it('returns a new object; never mutates the source', () => {
    const state = createWorldState(rng());
    const delta: WorldStateDelta = {
      populations: [{ populationId: 'paying_customers', entities: [customer('e1')] }],
    };
    const next = mergeDelta(state, delta);
    expect(next).not.toBe(state);
    expect(state.populations.has('paying_customers')).toBe(false);
    expect(next.populations.get('paying_customers')).toHaveLength(1);
  });

  it('appends entities to existing population rosters across passes', () => {
    const state = createWorldState(rng());
    const after1 = mergeDelta(state, {
      populations: [{ populationId: 'paying_customers', entities: [customer('e1')] }],
    });
    const after2 = mergeDelta(after1, {
      populations: [{ populationId: 'paying_customers', entities: [customer('e2'), customer('e3')] }],
    });
    expect(after2.populations.get('paying_customers')!.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    // First pass remains unchanged
    expect(after1.populations.get('paying_customers')!.map((e) => e.id)).toEqual(['e1']);
  });

  it('appends lifecycle events deterministically', () => {
    const state = createWorldState(rng());
    const next = mergeDelta(state, {
      lifecycleEvents: [
        { entityId: 'e1', kind: 'start', timestamp: '2026-01-01', attrs: {} },
        { entityId: 'e1', kind: 'churn', timestamp: '2026-03-15', attrs: {} },
      ],
    });
    expect(next.lifecycleEvents).toHaveLength(2);
    expect(next.lifecycleEvents[1]!.kind).toBe('churn');
  });

  it('preserves the PRNG instance across passes (deterministic stream)', () => {
    const state = createWorldState(rng());
    const next = mergeDelta(state, {});
    expect(next.prng).toBe(state.prng);
  });
});

describe('WorldState — conflict semantics', () => {
  it('throws WorldStateConflictError when an anchor disagrees', () => {
    const state = createWorldState(rng());
    const first = mergeDelta(state, {
      anchors: [
        ['klein', { anchorId: 'klein', entityId: 'e1', dates: { event: '2026-04-29' } }],
      ],
    });
    expect(() =>
      mergeDelta(first, {
        anchors: [
          ['klein', { anchorId: 'klein', entityId: 'e2', dates: { event: '2026-04-29' } }],
        ],
      }),
    ).toThrow(WorldStateConflictError);
  });

  it('is idempotent on equal-content anchor rewrites', () => {
    const state = createWorldState(rng());
    const first = mergeDelta(state, {
      anchors: [
        ['klein', { anchorId: 'klein', entityId: 'e1', dates: { event: '2026-04-29' } }],
      ],
    });
    expect(() =>
      mergeDelta(first, {
        anchors: [
          ['klein', { anchorId: 'klein', entityId: 'e1', dates: { event: '2026-04-29' } }],
        ],
      }),
    ).not.toThrow();
  });

  it('throws on conflicting identity record writes', () => {
    const state = createWorldState(rng());
    const a = mergeDelta(state, {
      identities: [
        [
          'e1',
          {
            entityId: 'e1',
            slots: [{ surface: 'stripe', objectKind: 'customer', deterministicSeed: 'e1' }],
          },
        ],
      ],
    });
    expect(() =>
      mergeDelta(a, {
        identities: [
          [
            'e1',
            {
              entityId: 'e1',
              slots: [{ surface: 'stripe', objectKind: 'customer', deterministicSeed: 'other-seed' }],
            },
          ],
        ],
      }),
    ).toThrow(WorldStateConflictError);
  });

  it('throws on conflicting budget ledger writes', () => {
    const state = createWorldState(rng());
    const a = mergeDelta(state, {
      budgets: [
        ['mrr-drop', { id: 'mrr-drop', total: -4820, parts: new Map([['churn', -4820]]), tolerance: 1 }],
      ],
    });
    expect(() =>
      mergeDelta(a, {
        budgets: [
          ['mrr-drop', { id: 'mrr-drop', total: -3000, parts: new Map([['churn', -3000]]), tolerance: 1 }],
        ],
      }),
    ).toThrow(WorldStateConflictError);
  });
});

describe('BudgetLedger — sum identity', () => {
  it('balances within tolerance', () => {
    const ledger = {
      id: 'b',
      total: -4820,
      parts: new Map([['churn', -2000], ['downgrade', -1500], ['refunds', -800], ['failed', -400], ['pause', -120]]),
      tolerance: 0,
    };
    expect(ledgerBalances(ledger)).toBe(true);
    expect(() => assertLedgerBalances(ledger)).not.toThrow();
  });

  it('throws BudgetIdentityError when parts do not sum to total', () => {
    const ledger = {
      id: 'b',
      total: -4820,
      parts: new Map([['churn', -1000]]),
      tolerance: 0,
    };
    expect(() => assertLedgerBalances(ledger)).toThrow(BudgetIdentityError);
  });
});
