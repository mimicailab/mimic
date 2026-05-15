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

  it('does not fan out disjoint populations across unrelated surfaces', () => {
    const stripeCustomers: CountClause = {
      id: 'stripe-customers',
      quote: '3 stripe customers',
      family: 'count',
      strength: 'hard',
      target: { surface: 'api', name: 'stripe.customer' },
      expected: 3,
    };
    const dbUsers: CountClause = {
      id: 'db-users',
      quote: '2 database users',
      family: 'count',
      strength: 'hard',
      target: { surface: 'db', name: 'users' },
      expected: 2,
    };

    const { state } = setUp([stripeCustomers, dbUsers]);
    const { dataset } = runProjection(state);

    expect(dataset.apiResponses['stripe']!.responses['customer']!).toHaveLength(3);
    expect(dataset.tables['users']!).toHaveLength(2);
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

describe('projection — persona-index namespaces minted IDs', () => {
  it('uses state.personaIndex (not hardcoded 1) in the prefix', () => {
    registerProjectorHints({ adapterId: 'stripe', idPrefixes: { customer: 'cus_' } });
    const count: CountClause = {
      id: 'c',
      quote: '2 stripe customers',
      family: 'count',
      strength: 'hard',
      target: { surface: 'api', name: 'stripe.customer' },
      expected: 2,
    };
    const contract = makeContract([count]);
    const gate = runPreGenerationGate(contract);
    if (!gate.ok) throw new Error('gate failed');
    // Persona 2 (e.g. second persona in the batch).
    const initial = createWorldState(new SeededRandom(1), 2);
    const { state } = runPlanners(contract, gate.obligationGraph, initial);
    const { dataset } = runProjection(state);
    const responses = dataset.apiResponses['stripe']!.responses['customer']!;
    for (const r of responses) {
      const body = r.body as Record<string, unknown>;
      expect(String(body.id)).toMatch(/^cus_p2_/);
    }
  });
});

describe('projection — registry-derived hints (real wiring path)', () => {
  it('registerAdapter publishes hints derived from resourceSpecs.idPrefixes', async () => {
    const { registerAdapter, clearRegistry } = await import('../../adapter/registry.js');
    clearRegistry();
    __resetProjectorHints();

    // Minimal ApiMockAdapter stub with resourceSpecs carrying an id prefix.
    const fakeAdapter = {
      id: 'fakebill',
      name: 'Fake Billing',
      type: 'api-mock' as const,
      basePath: '/v1',
      resourceSpecs: {
        platform: {
          id: 'fakebill',
          name: 'Fake Billing',
          timestampFormat: 'iso8601' as const,
          idPrefix: 'fb_',
        },
        resources: {
          customer: {
            resource: 'customer',
            objectType: 'customer',
            fields: {
              id: { type: 'string' as const, required: true, idPrefix: 'fbc_' },
            },
          },
        },
      },
      init: async () => {},
      apply: async () => ({ adapterId: 'fakebill', success: true, stats: {}, duration: 0 }),
      clean: async () => {},
      healthcheck: async () => true,
      dispose: async () => {},
      registerRoutes: async () => {},
      getEndpoints: () => [],
      resolvePersona: () => null,
    };
    registerAdapter(fakeAdapter as any, {
      id: 'fakebill',
      name: 'Fake Billing',
      type: 'api-mock',
      description: '',
    });

    const { getProjectorHints } = await import('../../projection/projector-hints.js');
    const hints = getProjectorHints('fakebill');
    expect(hints.idPrefix).toBe('fb_');
    expect(hints.idPrefixes?.customer).toBe('fbc_');
  });
});

describe('projection — entity-owned surface bindings', () => {
  it('reserves only the surfaces a canonical entity actually owns', () => {
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

    // Cross-surface clauses no longer cause contract-wide slot fan-out.
    // This paying_customer cohort owns its semantic billing projection only.
    for (const [, record] of state.identities) {
      const surfaces = record.slots.map((s) => `${s.surface}.${s.objectKind}`);
      expect(surfaces).toContain('stripe.subscription');
      expect(surfaces).not.toContain('db.users');
      expect(surfaces).not.toContain('stripe.customer');
    }

    const entity = state.populations.get('paying_customers')![0]!;
    expect(entity.lifecycle.status).toBe('active');
  });
});
