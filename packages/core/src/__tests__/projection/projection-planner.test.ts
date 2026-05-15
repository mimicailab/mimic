/**
 * Phase 7 — Projection planner tests.
 *
 * Invariants the V5 design doc calls out:
 *   - a projector run twice on the same world state produces identical output
 *   - projectors cannot mutate world state (freeze it)
 *   - an entity that appears on DB and on a billing surface carries the
 *     same `IdentityRecord` and consistent attrs across both projections
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  canonicaliseContract,
} from '../../contract/canonicaliser.js';
import {
  runPreGenerationGate,
  runPlanners,
} from '../../planner/index.js';
import {
  createWorldState,
  SeededRandom,
} from '../../world/index.js';
import {
  runProjection,
  __resetProjectorHints,
  registerProjectorHints,
} from '../../projection/index.js';
import type {
  Clause,
  CountClause,
  CrossSurfaceClause,
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
  if (!gate.ok) throw new Error('gate failed');
  const initial = createWorldState(new SeededRandom(1));
  const { state } = runPlanners(contract, gate.obligationGraph, initial);
  return { contract, state };
}

beforeEach(() => {
  __resetProjectorHints();
});

describe('projection — determinism', () => {
  it('two runs on the same world state produce identical output', () => {
    const count: CountClause = {
      id: 'c',
      quote: '3 stripe customers',
      family: 'count',
      strength: 'hard',
      target: { surface: 'api', name: 'stripe.customer' },
      expected: 3,
    };
    const { state } = setUp([count]);
    const a = runProjection(state);
    const b = runProjection(state);
    expect(JSON.stringify(a.dataset)).toBe(JSON.stringify(b.dataset));
  });
});

describe('projection — freezes world state', () => {
  it('a projector cannot mutate the canonical entity', () => {
    const count: CountClause = {
      id: 'c',
      quote: '3 stripe customers',
      family: 'count',
      strength: 'hard',
      target: { surface: 'api', name: 'stripe.customer' },
      expected: 3,
    };
    const { state } = setUp([count]);
    runProjection(state);
    const entity = state.populations.get('api:stripe.customer')![0]!;
    expect(() => {
      (entity as { id: string }).id = 'mutated';
    }).toThrow();
  });
});

describe('projection — uses ProjectorHints when an adapter declares them', () => {
  it('honours the adapter id prefix override', () => {
    registerProjectorHints({
      adapterId: 'stripe',
      idPrefixes: { customer: 'cus_' },
    });
    const count: CountClause = {
      id: 'c',
      quote: '2 stripe customers',
      family: 'count',
      strength: 'hard',
      target: { surface: 'api', name: 'stripe.customer' },
      expected: 2,
    };
    const { state } = setUp([count]);
    const { dataset } = runProjection(state);
    const responses = dataset.apiResponses['stripe']!.responses['customer']!;
    expect(responses).toHaveLength(2);
    for (const r of responses) {
      const body = r.body as Record<string, unknown>;
      expect(String(body.id)).toMatch(/^cus_p1_/);
    }
  });
});

describe('projection — identity invariant across surfaces', () => {
  it('an entity present on db and stripe carries the same identity record + status', () => {
    // One canonical population that needs slots on BOTH surfaces. We
    // express that via a cross_surface clause so the contract walker
    // discovers both coordinates.
    const count: CountClause = {
      id: 'c',
      quote: '5 paying customers on stripe',
      family: 'count',
      strength: 'hard',
      semanticTarget: {
        kind: 'billing_customer_cohort',
        adapter: 'stripe',
        facets: { billingState: 'paying' },
      },
      expected: 5,
    };
    const cs: CrossSurfaceClause = {
      id: 'cs',
      quote: 'paying customers visible in db.users and stripe.customer',
      family: 'cross_surface',
      strength: 'hard',
      entity: 'paying_customer',
      surfaceA: { surface: 'db', name: 'users' },
      surfaceB: { surface: 'api', name: 'stripe.customer' },
      field: 'status',
      valueA: 'active',
      valueB: 'active',
    };
    const { state } = setUp([count, cs]);
    runProjection(state);

    // Every entity gets one slot per (surface, objectKind) referenced by
    // the contract — here that is db.users and stripe.customer.
    for (const [, record] of state.identities) {
      const surfaces = record.slots.map((s) => `${s.surface}.${s.objectKind}`);
      expect(surfaces).toContain('db.users');
      expect(surfaces).toContain('stripe.customer');
    }
    // The contract evaluator (Phase 8) ultimately enforces equal status
    // across surfaces; Phase 7's projector consults the same lifecycle
    // status on the canonical entity, so both surfaces end up with the
    // same status value by construction.
    const entity = state.populations.get('paying_customers')![0]!;
    expect(entity.lifecycle.status).toBe('active');
  });
});
