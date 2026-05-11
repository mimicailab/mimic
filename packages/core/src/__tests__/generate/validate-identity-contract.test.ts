import { describe, it, expect } from 'vitest';
import {
  validatePhase1IdentityContract,
  validatePhase2IdentityContract,
} from '../../generate/validate-identity-contract.js';
import type { IdentityContractEntry } from '../../generate/prompts.js';

const STRIPE_CUS_CONTRACT: IdentityContractEntry = {
  dbTable: 'customers',
  dbColumn: 'stripe_customer_id',
  adapterId: 'stripe',
  apiResource: 'customer',
  apiField: 'id',
  prefix: 'cus_p1_',
};

describe('validatePhase1IdentityContract', () => {
  it('passes when an archetype enforces the right prefix via vary.sequence', () => {
    expect(() =>
      validatePhase1IdentityContract(
        {
          entityArchetypes: {
            customers: {
              count: 100,
              archetypes: [
                {
                  label: 'healthy',
                  weight: 1,
                  fields: { name: 'Alice' },
                  vary: { stripe_customer_id: { type: 'sequence', prefix: 'cus_p1_' } },
                },
              ],
            },
          },
        },
        [STRIPE_CUS_CONTRACT],
      ),
    ).not.toThrow();
  });

  it('throws when an archetype emits a non-conforming prefix', () => {
    expect(() =>
      validatePhase1IdentityContract(
        {
          entityArchetypes: {
            customers: {
              count: 100,
              archetypes: [
                {
                  label: 'expired',
                  weight: 1,
                  fields: {},
                  vary: { stripe_customer_id: { type: 'sequence', prefix: 'cus_expired' } },
                },
              ],
            },
          },
        },
        [STRIPE_CUS_CONTRACT],
      ),
    ).toThrow(/identity-contract violation.*customers\.stripe_customer_id.*cus_expired.*cus_p1_/s);
  });

  it('passes when a static row in entities[] starts with the right prefix', () => {
    expect(() =>
      validatePhase1IdentityContract(
        {
          entities: {
            customers: [{ stripe_customer_id: 'cus_p1_001' }, { stripe_customer_id: 'cus_p1_002' }],
          },
        },
        [STRIPE_CUS_CONTRACT],
      ),
    ).not.toThrow();
  });

  it('throws when a static row uses a different prefix', () => {
    expect(() =>
      validatePhase1IdentityContract(
        {
          entities: {
            customers: [{ stripe_customer_id: 'cus_healthy024' }],
          },
        },
        [STRIPE_CUS_CONTRACT],
      ),
    ).toThrow(/cus_healthy024/);
  });

  it('is a no-op when the contract is empty (no cross-surface FKs)', () => {
    expect(() => validatePhase1IdentityContract({ entityArchetypes: {} }, [])).not.toThrow();
  });

  it('skips constraints whose table was not generated at all', () => {
    // No data for "customers" → likely a separate coverage issue, not a
    // contract violation. Validator stays silent.
    expect(() =>
      validatePhase1IdentityContract({ entityArchetypes: {}, entities: {} }, [STRIPE_CUS_CONTRACT]),
    ).not.toThrow();
  });
});

describe('validatePhase2IdentityContract', () => {
  it('passes when API archetype enforces the right id prefix', () => {
    expect(() =>
      validatePhase2IdentityContract(
        {
          apiEntityArchetypes: {
            stripe: {
              customer: {
                count: 100,
                archetypes: [
                  {
                    label: 'healthy',
                    weight: 1,
                    fields: {},
                    vary: { id: { type: 'sequence', prefix: 'cus_p1_' } },
                  },
                ],
              },
            },
          },
        },
        [STRIPE_CUS_CONTRACT],
      ),
    ).not.toThrow();
  });

  it('throws when ANY archetype is non-conforming, even if others conform', () => {
    // Real bug shape from revenue-recovery-agent: one "healthy-active"
    // archetype uses vary.id={type:'uuid'} alongside others that pin the
    // contract prefix. The mixed case must fail loud, not silently produce
    // UUID rows that 404 against the DB.
    expect(() =>
      validatePhase2IdentityContract(
        {
          apiEntityArchetypes: {
            stripe: {
              customer: {
                count: 100,
                archetypes: [
                  {
                    label: 'healthy-active',
                    weight: 0.7,
                    fields: {},
                    vary: { id: { type: 'uuid' } },
                  },
                  {
                    label: 'klein-records',
                    weight: 0.3,
                    fields: {},
                    vary: { id: { type: 'sequence', prefix: 'cus_p1_' } },
                  },
                ],
              },
            },
          },
        },
        [STRIPE_CUS_CONTRACT],
      ),
    ).toThrow(/healthy-active.*vary type="uuid".*cus_p1_/s);
  });

  it('throws on the canonical bug shape (semantic archetype prefix)', () => {
    expect(() =>
      validatePhase2IdentityContract(
        {
          apiEntityArchetypes: {
            stripe: {
              customer: {
                count: 100,
                archetypes: [
                  {
                    label: 'expired-cards',
                    weight: 1,
                    fields: {},
                    vary: { id: { type: 'sequence', prefix: 'cus_expired' } },
                  },
                ],
              },
            },
          },
        },
        [STRIPE_CUS_CONTRACT],
      ),
    ).toThrow(/identity-contract violation.*stripe\.customer\.id.*cus_expired.*cus_p1_/s);
  });

  it('is a no-op when contract is empty', () => {
    expect(() =>
      validatePhase2IdentityContract({ apiEntityArchetypes: { stripe: { customer: { count: 1, archetypes: [] } } } }, []),
    ).not.toThrow();
  });
});
