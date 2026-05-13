import { describe, it, expect, vi } from 'vitest';
import { generateAllSlots } from '../../generate/content-generator.js';
import type { ResourceSlot } from '../../generate/topology.js';
import type { LLMClient } from '../../llm/client.js';
import type { AdapterResourceSpecs, TableInfo } from '../../types/index.js';

const STRIPE_SPECS: Record<string, AdapterResourceSpecs> = {
  stripe: {
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
  },
};

const USERS_TABLE: TableInfo = {
  name: 'users',
  columns: [
    { name: 'id', type: 'integer', pgType: 'integer', isNullable: false, hasDefault: false, isAutoIncrement: true, isGenerated: false },
    { name: 'email', type: 'text', pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
    { name: 'plan', type: 'text', pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
  ],
  primaryKey: ['id'],
  foreignKeys: [],
  uniqueConstraints: [],
  checkConstraints: [],
};

/**
 * Mock LLMClient that returns a fixed object per call. The label distinguishes
 * db slot calls (`content:db:...`) from api slot calls (`content:api:...`).
 */
function mockLlm(perLabel: Record<string, unknown>): LLMClient {
  const generateObject = vi.fn(async (opts: { label?: string }) => {
    const obj = perLabel[opts.label ?? ''];
    if (!obj) throw new Error(`mock LLM: no canned response for label "${opts.label}"`);
    return { object: obj, promptTokens: 0, completionTokens: 0 };
  });
  return { generateObject, getModelId: () => 'mock' } as unknown as LLMClient;
}

describe('content-generator — per-slot fan-out', () => {
  it('returns one config per slot with archetypes from the LLM', async () => {
    const slots: ResourceSlot[] = [
      {
        surface: 'db',
        name: 'users',
        key: 'db:users',
        dbTable: USERS_TABLE,
        claims: [],
        suggestedCount: 50,
      },
      {
        surface: 'api',
        name: 'stripe.customer',
        key: 'api:stripe.customer',
        adapterId: 'stripe',
        resourceType: 'customer',
        apiPlatform: STRIPE_SPECS.stripe!.platform,
        apiResource: STRIPE_SPECS.stripe!.resources.customer,
        claims: [],
        suggestedCount: 100,
      },
    ];

    const llm = mockLlm({
      'content:db:users:Test': {
        archetypes: [
          { label: 'free', fields: { plan: 'free' }, vary: {} },
          { label: 'pro', fields: { plan: 'pro' }, vary: {} },
        ],
      },
      'content:api:stripe.customer:Test': {
        archetypes: [
          { label: 'starter', fieldOverrides: [{ field: 'name', value: 'Acme' }] },
        ],
      },
    });

    const results = await generateAllSlots(llm, slots, {
      persona: { name: 'Test', description: 'd' },
      domain: 'd',
      anchors: [],
      resourceSpecs: STRIPE_SPECS,
      concurrency: 2,
    });

    expect(results).toHaveLength(2);
    const dbResult = results.find((r) => r.slot.surface === 'db')!;
    expect(dbResult.config.count).toBe(50);
    expect(dbResult.config.archetypes.map((a) => a.label).sort()).toEqual(['free', 'pro']);
    // Uniform weight defaulting
    expect(dbResult.config.archetypes[0]!.weight).toBeCloseTo(0.5);
    expect(dbResult.config.archetypes[1]!.weight).toBeCloseTo(0.5);

    const apiResult = results.find((r) => r.slot.surface === 'api')!;
    expect(apiResult.config.count).toBe(100);
    expect(apiResult.config.archetypes).toHaveLength(1);
    expect(apiResult.config.archetypes[0]!.label).toBe('starter');
  });

  it('weights anchor-bound archetypes at 0 and shares the remainder uniformly', async () => {
    const slots: ResourceSlot[] = [
      {
        surface: 'db',
        name: 'users',
        key: 'db:users',
        dbTable: USERS_TABLE,
        claims: [],
        suggestedCount: 100,
      },
    ];
    const llm = mockLlm({
      'content:db:users:Test': {
        archetypes: [
          { label: 'free', fields: {}, vary: {} },
          { label: 'pro', fields: {}, vary: {} },
          { label: 'klein-event', fields: {}, vary: {}, anchor: 'klein_double_charge' },
        ],
      },
    });

    const results = await generateAllSlots(llm, slots, {
      persona: { name: 'Test', description: 'd' },
      domain: 'd',
      anchors: [
        { id: 'klein_double_charge', customer: { match: 'Klein' }, dates: { event: '2026-04-29' } },
      ],
    });

    const archs = results[0]!.config.archetypes;
    const free = archs.find((a) => a.label === 'free')!;
    const pro = archs.find((a) => a.label === 'pro')!;
    const klein = archs.find((a) => a.label === 'klein-event')!;
    expect(klein.weight).toBe(0);
    expect(free.weight).toBeCloseTo(0.5);
    expect(pro.weight).toBeCloseTo(0.5);
    expect(klein.anchor).toBe('klein_double_charge');
  });

  it('propagates cites onto assembled archetypes', async () => {
    const slots: ResourceSlot[] = [
      {
        surface: 'api',
        name: 'stripe.customer',
        key: 'api:stripe.customer',
        adapterId: 'stripe',
        resourceType: 'customer',
        apiPlatform: STRIPE_SPECS.stripe!.platform,
        apiResource: STRIPE_SPECS.stripe!.resources.customer,
        claims: [
          { id: 'claim_total', quote: '', kind: 'row_count', target: { surface: 'api', name: 'stripe.customer' }, expected: 100 },
        ],
        suggestedCount: 100,
      },
    ];
    const llm = mockLlm({
      'content:api:stripe.customer:Test': {
        archetypes: [
          { label: 'starter', cites: ['claim_total'] },
        ],
      },
    });
    const results = await generateAllSlots(llm, slots, {
      persona: { name: 'Test', description: 'd' },
      domain: 'd',
      anchors: [],
      resourceSpecs: STRIPE_SPECS,
    });
    expect(results[0]!.config.archetypes[0]!.cites).toEqual(['claim_total']);
  });
});
