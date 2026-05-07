import { describe, it, expect } from 'vitest';
import { assembleResourceArchetypes } from '../../generate/resource-assembler.js';
import { toDistributionOutput } from '../../generate/blueprint-zod.js';
import { validateApiOnlyCap } from '../../generate/validate-identity-contract.js';
import { BlueprintGenerationError } from '../../utils/errors.js';
import type { AdapterResourceSpecs } from '../../types/index.js';
import type { DistributionOutput } from '../../generate/resource-assembler.js';
import type { DistributionOutputRaw } from '../../generate/blueprint-zod.js';

const STRIPE_SPECS: AdapterResourceSpecs = {
  platform: { timestampFormat: 'unix_seconds', amountFormat: 'integer_cents', idPrefix: 'cus_' },
  resources: {
    customer: {
      objectType: 'customer',
      volumeHint: 'entity',
      fields: {
        id: { type: 'string', required: true, idPrefix: 'cus_' },
        email: { type: 'string', required: true, semanticType: 'email' },
      },
    },
  },
};

describe('apiOnly: schema → assembler propagation', () => {
  it('toDistributionOutput preserves apiOnly + count from the LLM array form', () => {
    const raw: DistributionOutputRaw = {
      resources: [
        {
          resource: 'customer',
          distribution: {
            count: 100,
            archetypes: [
              { label: 'healthy', weight: 0.96 },
              { label: 'stripe-only-orphan', weight: 0.04, apiOnly: true, count: 3 },
            ],
          },
        },
      ],
    };
    const { distributions } = toDistributionOutput(raw);
    const customer = distributions.customer!;
    expect(customer.archetypes[0]!.apiOnly).toBeUndefined();
    expect(customer.archetypes[1]!.apiOnly).toBe(true);
    expect(customer.archetypes[1]!.count).toBe(3);
  });

  it('assembleResourceArchetypes carries apiOnly + count onto the EntityArchetype output', () => {
    const distribution: DistributionOutput = {
      customer: {
        count: 100,
        archetypes: [
          { label: 'healthy', weight: 1.0 },
          { label: 'stripe-only-orphan', weight: 0.04, apiOnly: true, count: 3 },
        ],
      },
    };
    const result = assembleResourceArchetypes(STRIPE_SPECS, distribution);
    const customer = result.customer!;
    expect(customer.count).toBe(100); // matched count, unchanged
    expect(customer.archetypes[0]!.apiOnly).toBeUndefined();
    expect(customer.archetypes[1]!.apiOnly).toBe(true);
    expect(customer.archetypes[1]!.count).toBe(3);
  });
});

describe('apiOnly: validateApiOnlyCap', () => {
  const cap = (apiOnlyCount: number, matchedCount: number) =>
    validateApiOnlyCap({
      apiEntityArchetypes: {
        stripe: {
          customer: {
            count: matchedCount,
            archetypes: [
              { label: 'matched', weight: 1.0, fields: {}, vary: {} },
              { label: 'orphan', weight: 0, apiOnly: true, count: apiOnlyCount, fields: {}, vary: {} },
            ],
          },
        },
      },
    });

  it('passes when apiOnly is well below cap (3 of 100)', () => {
    expect(() => cap(3, 100)).not.toThrow();
  });

  it('passes at the boundary (30 of 100 = 30%)', () => {
    expect(() => cap(30, 100)).not.toThrow();
  });

  it('throws when apiOnly exceeds the cap (50 of 100 = 50%)', () => {
    expect(() => cap(50, 100)).toThrow(BlueprintGenerationError);
    expect(() => cap(50, 100)).toThrow(/apiOnly cap exceeded/);
    expect(() => cap(50, 100)).toThrow(/stripe\.customer/);
  });

  it('respects custom maxApiOnlyRatio', () => {
    expect(() => validateApiOnlyCap(
      {
        apiEntityArchetypes: {
          stripe: {
            customer: {
              count: 100,
              archetypes: [
                { label: 'matched', weight: 1.0, fields: {}, vary: {} },
                { label: 'orphan', weight: 0, apiOnly: true, count: 40, fields: {}, vary: {} },
              ],
            },
          },
        },
      },
      { maxApiOnlyRatio: 0.5 },
    )).not.toThrow();
  });

  it('is a no-op when there are no apiOnly archetypes', () => {
    expect(() => validateApiOnlyCap({
      apiEntityArchetypes: {
        stripe: {
          customer: {
            count: 100,
            archetypes: [{ label: 'all-matched', weight: 1.0, fields: {}, vary: {} }],
          },
        },
      },
    })).not.toThrow();
  });

  it('falls back to weight × matched count when apiOnly archetype omits explicit count', () => {
    expect(() => validateApiOnlyCap({
      apiEntityArchetypes: {
        stripe: {
          customer: {
            count: 100,
            archetypes: [
              { label: 'matched', weight: 1.0, fields: {}, vary: {} },
              // No explicit count → 0.5 × 100 = 50, exceeds 30% cap
              { label: 'orphan', weight: 0.5, apiOnly: true, fields: {}, vary: {} },
            ],
          },
        },
      },
    })).toThrow(/apiOnly cap exceeded/);
  });
});
