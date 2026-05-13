import { describe, it, expect } from 'vitest';
import { buildClaimExtractionPrompt } from '../../generate/prompts.js';
import type { SchemaModel } from '../../types/index.js';
import type { SchemaMapping } from '../../types/blueprint.js';

const SCHEMA: SchemaModel = {
  tables: [
    {
      name: 'users',
      columns: [
        { name: 'id', type: 'integer', pgType: 'integer', isNullable: false, hasDefault: false, isAutoIncrement: true, isGenerated: false },
        { name: 'email', type: 'text', pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
        { name: 'billing_platform', type: 'text', pgType: 'text', isNullable: true, hasDefault: false, isAutoIncrement: false, isGenerated: false },
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

const MAPPING: SchemaMapping = {
  bridgeTables: ['users'],
  mappings: [
    { dbTable: 'users', dbColumn: 'external_id', adapterId: 'stripe', apiResource: 'customer', apiField: 'id', isBridgeTable: true, direction: 'mirror' },
    { dbTable: 'users', dbColumn: 'external_id', adapterId: 'paddle', apiResource: 'customer', apiField: 'id', isBridgeTable: true, direction: 'mirror' },
  ],
};

describe('claim-extraction prompt', () => {
  it('renders persona, domain, date range, and table summary in user prompt', () => {
    const { system, user } = buildClaimExtractionPrompt({
      schema: SCHEMA,
      persona: { name: 'Sarah', description: 'CFO at Northwind — 1,200 Stripe customers, 600 Paddle.' },
      domain: 'billing-ops',
      currentDate: '2026-05-12',
      volume: '6 months',
    });

    // Sanity: the system prompt mentions claim kinds and the bridge rule
    expect(system).toMatch(/row_count|aggregate_sum|pinned_field|date_window/);
    expect(system).toMatch(/BRIDGE TABLES/);
    // It is the narrow claim-extraction prompt, not the monolithic phase-1 prompt
    expect(system).toMatch(/structured contract of checkable claims/i);

    // User prompt
    expect(user).toContain('billing-ops');
    expect(user).toContain('Sarah');
    expect(user).toMatch(/Date range: 2025-11-12 → 2026-05-12/);
    expect(user).toContain('users:');
    expect(user).toContain('email');
  });

  it('renders adapter resources block when adapters are provided', () => {
    const { user } = buildClaimExtractionPrompt({
      schema: SCHEMA,
      persona: { name: 'p', description: 'd' },
      domain: 'd',
      adapterResources: { stripe: ['customer', 'subscription'], paddle: ['customer'] },
    });
    expect(user).toContain('--- API ADAPTERS');
    expect(user).toContain('stripe: customer, subscription');
    expect(user).toContain('paddle: customer');
  });

  it('renders bridge-table block with concrete api targets', () => {
    const { user } = buildClaimExtractionPrompt({
      schema: SCHEMA,
      persona: { name: 'p', description: 'd' },
      domain: 'd',
      schemaMapping: MAPPING,
    });
    expect(user).toContain('--- BRIDGE TABLES');
    // Each api target appears
    expect(user).toContain('users');
    expect(user).toMatch(/paddle\.customer|stripe\.customer/);
  });

  it('omits the bridge-table block when no bridge tables exist', () => {
    const { user } = buildClaimExtractionPrompt({
      schema: SCHEMA,
      persona: { name: 'p', description: 'd' },
      domain: 'd',
      schemaMapping: { bridgeTables: [], mappings: [] },
    });
    expect(user).not.toContain('--- BRIDGE TABLES');
  });

  it('includes persona index for ID namespacing when provided', () => {
    const { user } = buildClaimExtractionPrompt({
      schema: SCHEMA,
      persona: { name: 'p', description: 'd' },
      domain: 'd',
      personaIndex: 2,
      totalPersonas: 4,
    });
    expect(user).toMatch(/Persona index: 2.*of 4/);
  });
});
