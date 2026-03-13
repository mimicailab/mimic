import { describe, it, expect } from 'vitest';
import { derivePromptContext, deriveDataSpec } from '../../types/adapter.js';
import type { AdapterResourceSpecs } from '../../types/index.js';

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
        created: { type: 'integer', required: true, timestamp: 'unix_seconds', auto: true },
      },
    },
    subscriptions: {
      objectType: 'subscription',
      volumeHint: 'entity',
      refs: ['customers', 'prices'],
      fields: {
        id: { type: 'string', required: true, idPrefix: 'sub_' },
        object: { type: 'string', required: true, default: 'subscription' },
        customer: { type: 'string', required: true, ref: 'customers' },
        status: {
          type: 'string', required: true,
          enum: ['active', 'past_due', 'canceled'],
        },
        amount: { type: 'integer', required: true, isAmount: true },
        created: { type: 'integer', required: true, timestamp: 'unix_seconds', auto: true },
      },
    },
    charges: {
      objectType: 'charge',
      volumeHint: 'entity',
      refs: ['customers'],
      fields: {
        id: { type: 'string', required: true, idPrefix: 'ch_' },
        amount: { type: 'integer', required: true, isAmount: true },
        status: {
          type: 'string', required: true,
          enum: ['succeeded', 'pending', 'failed'],
        },
        created: { type: 'integer', required: true, timestamp: 'unix_seconds', auto: true },
      },
    },
  },
};

describe('derivePromptContext', () => {
  it('should derive resource list from specs', () => {
    const ctx = derivePromptContext(stripeSpecs);
    expect(ctx.resources).toContain('customers');
    expect(ctx.resources).toContain('subscriptions');
    expect(ctx.resources).toContain('charges');
  });

  it('should derive amount format', () => {
    const ctx = derivePromptContext(stripeSpecs);
    expect(ctx.amountFormat).toContain('cents');
  });

  it('should derive relationships from refs', () => {
    const ctx = derivePromptContext(stripeSpecs);
    expect(ctx.relationships).toContain('subscriptions → customers, prices');
    expect(ctx.relationships).toContain('charges → customers');
  });

  it('should derive required fields', () => {
    const ctx = derivePromptContext(stripeSpecs);
    expect(ctx.requiredFields.customers).toContain('id');
    expect(ctx.requiredFields.customers).toContain('email');
    expect(ctx.requiredFields.customers).toContain('name');
  });

  it('should include id prefix', () => {
    const ctx = derivePromptContext(stripeSpecs);
    expect(ctx.idPrefix).toBe('cus_');
  });

  it('should include notes about timestamp format', () => {
    const ctx = derivePromptContext(stripeSpecs);
    expect(ctx.notes).toContain('Unix seconds');
  });
});

describe('deriveDataSpec', () => {
  it('should derive timestamp format', () => {
    const spec = deriveDataSpec(stripeSpecs);
    expect(spec.timestampFormat).toBe('unix_seconds');
  });

  it('should derive ID prefixes', () => {
    const spec = deriveDataSpec(stripeSpecs);
    expect(spec.idPrefixes?.customers).toBe('cus_');
    expect(spec.idPrefixes?.subscriptions).toBe('sub_');
    expect(spec.idPrefixes?.charges).toBe('ch_');
  });

  it('should derive amount fields', () => {
    const spec = deriveDataSpec(stripeSpecs);
    expect(spec.amountFields).toContain('amount');
  });

  it('should derive status enums', () => {
    const spec = deriveDataSpec(stripeSpecs);
    expect(spec.statusEnums?.subscriptions).toContain('active');
    expect(spec.statusEnums?.charges).toContain('succeeded');
  });

  it('should derive timestamp fields', () => {
    const spec = deriveDataSpec(stripeSpecs);
    expect(spec.timestampFields).toContain('created');
  });
});
