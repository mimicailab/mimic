import { describe, it, expect } from 'vitest';
import {
  getPersonaIdPrefix,
  getResourceIdPrefix,
} from '../../generate/identity-prefix.js';
import type { AdapterResourceSpecs, PromptContext } from '../../types/index.js';

describe('getPersonaIdPrefix', () => {
  it('composes a resource prefix with the persona namespace', () => {
    expect(getPersonaIdPrefix('cus_', 1)).toBe('cus_p1_');
    expect(getPersonaIdPrefix('sub_', 2)).toBe('sub_p2_');
    expect(getPersonaIdPrefix('in_', 12)).toBe('in_p12_');
  });

  it('passes through edge inputs without special-casing', () => {
    // Non-typical inputs are caller's problem — helper just composes.
    expect(getPersonaIdPrefix('', 1)).toBe('p1_');
    expect(getPersonaIdPrefix('cus_', 0)).toBe('cus_p0_');
  });
});

describe('getResourceIdPrefix', () => {
  const stripeSpecs: AdapterResourceSpecs = {
    platform: { timestampFormat: 'unix_seconds', amountFormat: 'integer_cents', idPrefix: 'cus_' },
    resources: {
      customer: {
        objectType: 'customer',
        volumeHint: 'entity',
        fields: { id: { type: 'string', required: true, idPrefix: 'cus_' } },
      },
      subscription: {
        objectType: 'subscription',
        volumeHint: 'entity',
        fields: { id: { type: 'string', required: true, idPrefix: 'sub_' } },
      },
    },
  };

  it('prefers ResourceSpec field-level idPrefix', () => {
    expect(
      getResourceIdPrefix('stripe', 'subscription', undefined, { stripe: stripeSpecs }),
    ).toBe('sub_');
  });

  it('falls back to PromptContext platform-level idPrefix when no ResourceSpec', () => {
    const pc: Record<string, PromptContext> = {
      stripe: { resources: ['customer'], amountFormat: '', relationships: [], requiredFields: {}, idPrefix: 'cus_' },
    };
    expect(getResourceIdPrefix('stripe', 'customer', pc, undefined)).toBe('cus_');
  });

  it('returns undefined when neither source declares a prefix', () => {
    expect(getResourceIdPrefix('unknown', 'customer', {}, {})).toBeUndefined();
    expect(getResourceIdPrefix('unknown', 'customer', undefined, undefined)).toBeUndefined();
  });
});
