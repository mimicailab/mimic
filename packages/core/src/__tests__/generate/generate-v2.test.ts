import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { BlueprintEngine } from '../../generate/blueprint-engine.js';
import { BlueprintCache } from '../../generate/blueprint-cache.js';
import { CostTracker } from '../../llm/cost-tracker.js';
import type { LLMClient } from '../../llm/client.js';
import type { SchemaModel, AdapterResourceSpecs } from '../../types/index.js';
import type { SchemaMapping } from '../../types/blueprint.js';

const SCHEMA: SchemaModel = {
  tables: [
    {
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
    },
    {
      name: 'events',
      columns: [
        { name: 'id', type: 'integer', pgType: 'integer', isNullable: false, hasDefault: false, isAutoIncrement: true, isGenerated: false },
        { name: 'kind', type: 'text', pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    },
  ],
  enums: [],
  insertionOrder: ['users', 'events'],
};

const RESOURCE_SPECS: Record<string, AdapterResourceSpecs> = {
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

const MAPPING: SchemaMapping = {
  bridgeTables: ['users'],
  mappings: [
    { dbTable: 'users', dbColumn: 'external_id', adapterId: 'stripe', apiResource: 'customer', apiField: 'id', isBridgeTable: true, direction: 'mirror' },
  ],
};

function mockLlm(responses: Record<string, unknown>): LLMClient {
  const generateObject = vi.fn(async (opts: { label?: string }) => {
    // Some labels include the persona name; match by prefix.
    const matchedKey = Object.keys(responses).find((k) => opts.label?.startsWith(k));
    if (!matchedKey) {
      throw new Error(`mock LLM: no canned response for label "${opts.label}"`);
    }
    return { object: responses[matchedKey], promptTokens: 0, completionTokens: 0 };
  });
  return { generateObject, getModelId: () => 'mock' } as unknown as LLMClient;
}

describe('BlueprintEngine.generateV2 — end-to-end with mock LLM', () => {
  let tmpDir: string;
  let engine: BlueprintEngine;
  let llm: LLMClient;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mimic-v2-'));
    llm = mockLlm({
      'claim-extract': {
        personaId: 'sarah',
        domain: 'billing-ops',
        persona: {
          name: 'Sarah',
          age: 38,
          occupation: 'CFO',
          location: 'London',
          salary: null,
          description: 'Northwind CFO',
        },
        claims: [
          {
            id: 'c_stripe_total',
            quote: '1,200 customers paying via Stripe',
            kind: 'row_count',
            target: { surface: 'db', name: 'users', filter: { billing_platform: 'stripe' } },
            expected: 1200,
          },
          {
            id: 'c_events',
            quote: '300 login events',
            kind: 'row_count',
            target: { surface: 'db', name: 'events', filter: { kind: 'login' } },
            expected: 300,
          },
        ],
        anchors: [],
      },
      'content:db:events': {
        archetypes: [
          { label: 'login', fields: { kind: 'login' }, vary: {}, cites: ['c_events'] },
        ],
      },
      'content:api:stripe.customer': {
        archetypes: [
          { label: 'starter', cites: ['c_stripe_total'] },
        ],
      },
    });

    const cache = new BlueprintCache(tmpDir);
    const costTracker = new CostTracker();
    engine = new BlueprintEngine(llm, cache, costTracker);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('produces a Blueprint with persona, claims, anchors, and per-slot archetypes', async () => {
    const bp = await engine.generateV2(
      SCHEMA,
      { name: 'Sarah', description: 'Northwind CFO' },
      'billing-ops',
      { force: true, personaIndex: 1, totalPersonas: 1, volume: '6 months' },
      { stripe: { adapter: 'stripe' } },
      undefined,
      RESOURCE_SPECS,
      MAPPING,
    );

    expect(bp.personaId).toBe('sarah');
    expect(bp.domain).toBe('billing-ops');
    expect(bp.persona.name).toBe('Sarah');
    expect(bp.data.claims).toBeDefined();
    expect(bp.data.claims!.length).toBe(2);
    // Bridge rewrite: the stripe row_count claim was re-routed from db.users to api.stripe.customer
    const stripeClaim = bp.data.claims!.find((c) => c.id === 'c_stripe_total')!;
    expect(stripeClaim.target).toEqual({ surface: 'api', name: 'stripe.customer' });
  });

  it('emits archetypes for the api slot (stripe.customer) and skips bridge-table users db slot', async () => {
    const bp = await engine.generateV2(
      SCHEMA,
      { name: 'Sarah', description: 'd' },
      'billing-ops',
      { force: true, personaIndex: 1, totalPersonas: 1, volume: '6 months' },
      { stripe: { adapter: 'stripe' } },
      undefined,
      RESOURCE_SPECS,
      MAPPING,
    );

    // users is a bridge table → no DB archetypes for it
    expect(bp.data.entityArchetypes?.users).toBeUndefined();
    // events is internal → DB archetypes exist
    expect(bp.data.entityArchetypes?.events).toBeDefined();
    expect(bp.data.entityArchetypes!.events!.archetypes[0]!.label).toBe('login');
    // stripe.customer is an API slot → archetypes exist
    expect(bp.data.apiEntityArchetypes?.stripe?.customer).toBeDefined();
    expect(bp.data.apiEntityArchetypes!.stripe!.customer!.archetypes[0]!.label).toBe('starter');
  });

  it('sets suggested counts on slot configs from row_count claims', async () => {
    const bp = await engine.generateV2(
      SCHEMA,
      { name: 'Sarah', description: 'd' },
      'billing-ops',
      { force: true, personaIndex: 1, totalPersonas: 1, volume: '6 months' },
      { stripe: { adapter: 'stripe' } },
      undefined,
      RESOURCE_SPECS,
      MAPPING,
    );
    // events claim expected = 300 → events slot suggested 300
    expect(bp.data.entityArchetypes?.events?.count).toBe(300);
    // stripe.customer rewritten claim expected = 1200 → 1200
    expect(bp.data.apiEntityArchetypes?.stripe?.customer?.count).toBe(1200);
  });
});
