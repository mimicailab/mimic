import { describe, expect, it } from 'vitest';
import { sanitiseClaims } from '../../generate/claim-sanitiser.js';
import type { AdapterResourceSpecs, SchemaModel } from '../../types/index.js';
import type { Claim } from '../../types/claim.js';

const SCHEMA: SchemaModel = {
  tables: [
    {
      name: 'users',
      columns: [
        { name: 'id', type: 'integer', pgType: 'integer', isNullable: false, hasDefault: false, isAutoIncrement: true, isGenerated: false },
        { name: 'plan', type: 'text', pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    },
  ],
  enums: [],
  insertionOrder: ['users'],
};

const RESOURCE_SPECS: Record<string, AdapterResourceSpecs> = {
  stripe: {
    platform: { timestampFormat: 'unix_seconds', amountFormat: 'integer_cents', idPrefix: 'sub_' },
    resources: {
      subscription: {
        objectType: 'subscription',
        volumeHint: 'entity',
        fields: {
          id: { type: 'string', required: true, idPrefix: 'sub_' },
          status: { type: 'string', required: true },
          customer: { type: 'string', required: false },
          items: { type: 'object', required: true },
        },
      },
    },
  },
};

describe('sanitiseClaims target normalisation', () => {
  it('rewrites api-prefixed api target names before grounding', () => {
    const claim: Claim = {
      id: 'c_subs',
      quote: '320 Stripe subscriptions',
      kind: 'row_count',
      target: { surface: 'api', name: 'api.stripe.subscription' },
      expected: 320,
    };

    const result = sanitiseClaims([claim], { resourceSpecs: RESOURCE_SPECS });

    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]!.target.name).toBe('stripe.subscription');
    expect(result.decisions.some((d) => d.reason.includes('rewrote api.api.stripe.subscription -> api.stripe.subscription'))).toBe(true);
  });

  it('drops unknown api targets when adapter specs are available', () => {
    const claim: Claim = {
      id: 'c_unknown',
      quote: '20 mystery rows',
      kind: 'row_count',
      target: { surface: 'api', name: 'stripe.unknown_resource' },
      expected: 20,
    };

    const result = sanitiseClaims([claim], { resourceSpecs: RESOURCE_SPECS });

    expect(result.claims).toHaveLength(0);
    expect(result.decisions.some((d) => d.reason.includes('unknown target api.stripe.unknown_resource'))).toBe(true);
  });

  it('rewrites db-prefixed db targets before grounding', () => {
    const claim: Claim = {
      id: 'c_users',
      quote: '100 users',
      kind: 'row_count',
      target: { surface: 'db', name: 'db.users' },
      expected: 100,
    };

    const result = sanitiseClaims([claim], { schema: SCHEMA });

    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]!.target.name).toBe('users');
    expect(result.decisions.some((d) => d.reason.includes('rewrote db.db.users -> db.users'))).toBe(true);
  });

  it('rewrites Stripe subscription plan aliases to nested item price paths', () => {
    const claim: Claim = {
      id: 'c_plan',
      quote: '160 starter subscriptions',
      kind: 'row_count',
      target: {
        surface: 'api',
        name: 'stripe.subscription',
        filter: { plan_nickname: 'starter-monthly' },
      },
      expected: 160,
    };

    const result = sanitiseClaims([claim], { resourceSpecs: RESOURCE_SPECS });

    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]!.target.filter).toEqual({ 'items.data.price.nickname': 'starter-monthly' });
    expect(result.decisions.some((d) => d.reason.includes('filter.plan_nickname -> items.data.price.nickname'))).toBe(true);
  });
});