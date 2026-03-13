import { describe, it, expect } from 'vitest';
import { assembleResourceArchetypes } from '../../generate/resource-assembler.js';
import type { AdapterResourceSpecs } from '../../types/index.js';
import type { DistributionOutput } from '../../generate/resource-assembler.js';

const stripeSpecs: AdapterResourceSpecs = {
  platform: {
    timestampFormat: 'unix_seconds',
    amountFormat: 'integer_cents',
    idPrefix: 'cus_',
  },
  resources: {
    customers: {
      objectType: 'customer',
      volumeHint: 'entity',
      fields: {
        id: { type: 'string', required: true, idPrefix: 'cus_' },
        object: { type: 'string', required: true, default: 'customer' },
        email: { type: 'string', required: true, semanticType: 'email' },
        name: { type: 'string', required: true },
        currency: { type: 'string', required: true, semanticType: 'currency_code', default: 'usd' },
        created: { type: 'integer', required: true, timestamp: 'unix_seconds', auto: true },
      },
    },
    subscriptions: {
      objectType: 'subscription',
      volumeHint: 'entity',
      refs: ['customers'],
      fields: {
        id: { type: 'string', required: true, idPrefix: 'sub_' },
        object: { type: 'string', required: true, default: 'subscription' },
        customer: { type: 'string', required: true, ref: 'customers' },
        status: {
          type: 'string', required: true,
          enum: ['active', 'past_due', 'canceled', 'trialing'],
        },
        amount: { type: 'integer', required: true, isAmount: true },
        created: { type: 'integer', required: true, timestamp: 'unix_seconds', auto: true },
      },
    },
    products: {
      objectType: 'product',
      volumeHint: 'reference',
      fields: {
        id: { type: 'string', required: true, idPrefix: 'prod_' },
        object: { type: 'string', required: true, default: 'product' },
        name: { type: 'string', required: true },
        active: { type: 'boolean', required: true, default: true },
        created: { type: 'integer', required: true, timestamp: 'unix_seconds', auto: true },
      },
    },
  },
};

describe('assembleResourceArchetypes', () => {
  it('should assemble archetypes from specs and distribution', () => {
    const distribution: DistributionOutput = {
      customers: {
        count: 50,
        archetypes: [
          { label: 'starter', weight: 0.6, fieldOverrides: { currency: 'usd' } },
          { label: 'enterprise', weight: 0.4, fieldOverrides: { currency: 'eur' } },
        ],
      },
    };

    const result = assembleResourceArchetypes(stripeSpecs, distribution);

    expect(result.customers).toBeDefined();
    expect(result.customers!.count).toBe(50);
    expect(result.customers!.archetypes).toHaveLength(2);

    const starter = result.customers!.archetypes[0]!;
    expect(starter.label).toBe('starter');
    expect(starter.weight).toBe(0.6);
    expect(starter.fields.currency).toBe('usd');
    expect(starter.fields.object).toBe('customer');
    expect(starter.vary.id.type).toBe('sequence');
    expect(starter.vary.id.prefix).toBe('cus_');
    expect(starter.vary.email.type).toBe('email');
    expect(starter.vary.name.type).toBe('fullName');
  });

  it('should skip auto fields (no created in vary or fields)', () => {
    const distribution: DistributionOutput = {
      customers: {
        count: 10,
        archetypes: [{ label: 'default', weight: 1.0 }],
      },
    };

    const result = assembleResourceArchetypes(stripeSpecs, distribution);
    const arch = result.customers!.archetypes[0]!;

    expect(arch.vary.created).toBeUndefined();
    expect(arch.fields.created).toBeUndefined();
  });

  it('should derive sequence variation for ID fields with prefixes', () => {
    const distribution: DistributionOutput = {
      subscriptions: {
        count: 30,
        archetypes: [
          { label: 'active', weight: 0.7, fieldOverrides: { status: 'active' } },
          { label: 'canceled', weight: 0.3, fieldOverrides: { status: 'canceled' } },
        ],
      },
    };

    const result = assembleResourceArchetypes(stripeSpecs, distribution);
    const active = result.subscriptions!.archetypes[0]!;

    expect(active.vary.id.type).toBe('sequence');
    expect(active.vary.id.prefix).toBe('sub_');
    expect(active.fields.status).toBe('active');
    expect(active.fields.object).toBe('subscription');
  });

  it('should derive range variation for amount fields', () => {
    const distribution: DistributionOutput = {
      subscriptions: {
        count: 10,
        archetypes: [{ label: 'default', weight: 1.0 }],
      },
    };

    const result = assembleResourceArchetypes(stripeSpecs, distribution);
    const arch = result.subscriptions!.archetypes[0]!;

    expect(arch.vary.amount.type).toBe('range');
    expect(arch.vary.amount.min).toBeDefined();
    expect(arch.vary.amount.max).toBeDefined();
  });

  it('should handle empty distribution gracefully', () => {
    const result = assembleResourceArchetypes(stripeSpecs, {});
    // Backfill ensures every spec resource gets default data even with empty distributions
    expect(Object.keys(result)).toHaveLength(Object.keys(stripeSpecs.resources).length);
    for (const key of Object.keys(stripeSpecs.resources)) {
      expect(result[key]).toBeDefined();
      expect(result[key]!.archetypes).toHaveLength(1);
      expect(result[key]!.archetypes[0]!.label).toBe('default');
    }
  });

  it('should skip resources not in specs', () => {
    const distribution: DistributionOutput = {
      nonexistent_resource: {
        count: 5,
        archetypes: [{ label: 'x', weight: 1.0 }],
      },
    };

    const result = assembleResourceArchetypes(stripeSpecs, distribution);
    expect(result.nonexistent_resource).toBeUndefined();
  });

  it('should namespace sequence prefixes with persona index', () => {
    const distribution: DistributionOutput = {
      customers: {
        count: 20,
        archetypes: [{ label: 'default', weight: 1.0 }],
      },
      subscriptions: {
        count: 10,
        archetypes: [{ label: 'active', weight: 1.0, fieldOverrides: { status: 'active' } }],
      },
    };

    const result = assembleResourceArchetypes(stripeSpecs, distribution, { personaIndex: 2 });

    const cusArch = result.customers!.archetypes[0]!;
    expect(cusArch.vary.id.prefix).toBe('cus_p2_');

    const subArch = result.subscriptions!.archetypes[0]!;
    expect(subArch.vary.id.prefix).toBe('sub_p2_');
  });

  it('should only skip created/created_at/updated_at auto fields, not arbitrary auto fields', () => {
    const specsWithCustomAuto: AdapterResourceSpecs = {
      platform: { timestampFormat: 'unix_seconds', amountFormat: 'integer_cents' },
      resources: {
        widgets: {
          objectType: 'widget',
          volumeHint: 'entity',
          fields: {
            id: { type: 'string', required: true, idPrefix: 'wid_' },
            created: { type: 'integer', required: true, timestamp: 'unix_seconds', auto: true },
            updated_at: { type: 'integer', required: true, timestamp: 'unix_seconds', auto: true },
            tracking_id: { type: 'string', required: true, idPrefix: 'trk_', auto: true },
            region: { type: 'string', required: true, auto: true, enum: ['us-east', 'us-west', 'eu'] },
            status: { type: 'string', required: true, enum: ['active', 'inactive'] },
          },
        },
      },
    };

    const distribution: DistributionOutput = {
      widgets: {
        count: 5,
        archetypes: [{ label: 'default', weight: 1.0 }],
      },
    };

    const result = assembleResourceArchetypes(specsWithCustomAuto, distribution);
    const arch = result.widgets!.archetypes[0]!;

    // created and updated_at should be skipped (expander auto-fills them)
    expect(arch.vary.created).toBeUndefined();
    expect(arch.fields.created).toBeUndefined();
    expect(arch.vary.updated_at).toBeUndefined();
    expect(arch.fields.updated_at).toBeUndefined();

    // tracking_id is auto but NOT an expander auto field — must NOT be skipped;
    // it has idPrefix so it should get a sequence variation
    expect(arch.vary.tracking_id).toBeDefined();
    expect(arch.vary.tracking_id.type).toBe('sequence');
    expect(arch.vary.tracking_id.prefix).toBe('trk_');

    // region is auto but NOT an expander auto field — must NOT be skipped;
    // it has enum so it should get a pick variation
    expect(arch.vary.region).toBeDefined();
    expect(arch.vary.region.type).toBe('pick');
  });

  it('should use per-archetype vary specs from distribution', () => {
    const distribution: DistributionOutput = {
      customers: {
        count: 20,
        archetypes: [{
          label: 'custom',
          weight: 1.0,
          vary: {
            name: { type: 'companyName' },
          },
        }],
      },
    };

    const result = assembleResourceArchetypes(stripeSpecs, distribution);
    const arch = result.customers!.archetypes[0]!;
    expect(arch.vary.name.type).toBe('companyName');
  });
});
