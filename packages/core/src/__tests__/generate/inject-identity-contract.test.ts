import { describe, it, expect } from 'vitest';
import {
  injectPhase1IdentityContract,
  injectPhase2IdentityContract,
} from '../../generate/inject-identity-contract.js';
import type { IdentityContractEntry } from '../../generate/prompts.js';
import type { EntityArchetypeConfig } from '../../types/blueprint.js';

const STRIPE_CUS: IdentityContractEntry = {
  dbTable: 'customers',
  dbColumn: 'stripe_customer_id',
  adapterId: 'stripe',
  apiResource: 'customer',
  apiField: 'id',
  prefix: 'cus_p1_',
};

describe('injectPhase2IdentityContract', () => {
  it('rewrites a uuid-typed archetype to sequence with the contracted prefix', () => {
    const data = {
      apiEntityArchetypes: {
        stripe: {
          customer: {
            count: 100,
            archetypes: [
              { label: 'healthy-active', weight: 0.7, fields: {}, vary: { id: { type: 'uuid' as const } } },
            ],
          },
        },
      },
    };
    const mutated = injectPhase2IdentityContract(data, [STRIPE_CUS]);
    expect(mutated).toBe(1);
    expect(data.apiEntityArchetypes.stripe.customer.archetypes[0]!.vary.id).toEqual({
      type: 'sequence',
      prefix: 'cus_p1_',
    });
  });

  it('strips a static `id` from `fields` while pinning vary.id', () => {
    const cfg: EntityArchetypeConfig = {
      count: 1,
      archetypes: [
        { label: 'demo', weight: 1, fields: { id: 'cus_demo_static', email: 'a@b.c' }, vary: {} },
      ],
    };
    const data = { apiEntityArchetypes: { stripe: { customer: cfg } } };
    injectPhase2IdentityContract(data, [STRIPE_CUS]);
    const a = cfg.archetypes[0]!;
    expect(a.fields).not.toHaveProperty('id');
    expect(a.fields).toHaveProperty('email', 'a@b.c'); // other fields untouched
    expect(a.vary.id).toEqual({ type: 'sequence', prefix: 'cus_p1_' });
  });

  it('is idempotent — re-running on already-correct data is a no-op', () => {
    const data = {
      apiEntityArchetypes: {
        stripe: {
          customer: {
            count: 1,
            archetypes: [
              { label: 'ok', weight: 1, fields: {}, vary: { id: { type: 'sequence' as const, prefix: 'cus_p1_' } } },
            ],
          },
        },
      },
    };
    expect(injectPhase2IdentityContract(data, [STRIPE_CUS])).toBe(0);
    expect(injectPhase2IdentityContract(data, [STRIPE_CUS])).toBe(0);
  });

  it('pins every archetype, not just the first one (real bug shape)', () => {
    const data = {
      apiEntityArchetypes: {
        stripe: {
          customer: {
            count: 100,
            archetypes: [
              { label: 'healthy', weight: 0.7, fields: {}, vary: { id: { type: 'uuid' as const } } },
              { label: 'klein',   weight: 0.2, fields: {}, vary: { id: { type: 'sequence' as const, prefix: 'cus_p1_' } } },
              { label: 'orphan',  weight: 0.1, fields: {}, vary: { id: { type: 'sequence' as const, prefix: 'cus_other' } } },
            ],
          },
        },
      },
    };
    const mutated = injectPhase2IdentityContract(data, [STRIPE_CUS]);
    expect(mutated).toBe(2); // healthy (uuid→seq) + orphan (wrong prefix→seq); klein already correct
    for (const a of data.apiEntityArchetypes.stripe.customer.archetypes) {
      expect(a.vary.id).toEqual({ type: 'sequence', prefix: 'cus_p1_' });
    }
  });

  it('is a no-op when contract is empty', () => {
    const data = { apiEntityArchetypes: { stripe: { customer: { count: 1, archetypes: [{ label: 'x', weight: 1, fields: {}, vary: { id: { type: 'uuid' as const } } }] } } } };
    expect(injectPhase2IdentityContract(data, [])).toBe(0);
    // Untouched
    expect(data.apiEntityArchetypes.stripe.customer.archetypes[0]!.vary.id).toEqual({ type: 'uuid' });
  });

  it('skips resources with no archetypes (e.g. flat apiEntities-only)', () => {
    const data = {
      apiEntityArchetypes: { stripe: { customer: { count: 0, archetypes: [] } } },
      apiEntities: { stripe: { customer: [{ id: 'cus_p1_001' }] } },
    };
    expect(injectPhase2IdentityContract(data, [STRIPE_CUS])).toBe(0);
  });
});

describe('injectPhase1IdentityContract', () => {
  it('pins DB-side archetypes the same way Phase 2 does', () => {
    const cfg: EntityArchetypeConfig = {
      count: 100,
      archetypes: [
        { label: 'healthy', weight: 0.7, fields: {}, vary: { stripe_customer_id: { type: 'uuid' } } },
        { label: 'klein',   weight: 0.3, fields: {}, vary: {} },
      ],
    };
    injectPhase1IdentityContract({ entityArchetypes: { customers: cfg } }, [STRIPE_CUS]);
    for (const a of cfg.archetypes) {
      expect(a.vary.stripe_customer_id).toEqual({ type: 'sequence', prefix: 'cus_p1_' });
    }
  });
});
