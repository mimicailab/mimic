import { describe, it, expect } from 'vitest';
import { deriveSlots } from '../../generate/topology.js';
import type { SchemaModel, AdapterResourceSpecs, TableClassification } from '../../types/index.js';
import type { SchemaMapping } from '../../types/blueprint.js';
import type { Claim } from '../../types/claim.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USERS_TABLE = {
  name: 'users',
  columns: [
    { name: 'id', type: 'integer' as const, pgType: 'integer', isNullable: false, hasDefault: false, isAutoIncrement: true, isGenerated: false },
    { name: 'email', type: 'text' as const, pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
    { name: 'plan', type: 'text' as const, pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
  ],
  primaryKey: ['id'],
  foreignKeys: [],
  uniqueConstraints: [],
  checkConstraints: [],
};

const EVENTS_TABLE = {
  name: 'events',
  columns: [
    { name: 'id', type: 'integer' as const, pgType: 'integer', isNullable: false, hasDefault: false, isAutoIncrement: true, isGenerated: false },
    { name: 'kind', type: 'text' as const, pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
  ],
  primaryKey: ['id'],
  foreignKeys: [],
  uniqueConstraints: [],
  checkConstraints: [],
};

const SCHEMA: SchemaModel = {
  tables: [USERS_TABLE, EVENTS_TABLE],
  enums: [],
  insertionOrder: ['users', 'events'],
};

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
      price: {
        objectType: 'price',
        volumeHint: 'reference',
        fields: {
          id: { type: 'string', required: true, idPrefix: 'price_' },
          unit_amount: { type: 'integer', required: true, isAmount: true },
        },
      },
    },
  },
};

// users is a bridge table for stripe.customer
const MAPPING: SchemaMapping = {
  bridgeTables: ['users'],
  mappings: [
    { dbTable: 'users', dbColumn: 'external_id', adapterId: 'stripe', apiResource: 'customer', apiField: 'id', isBridgeTable: true, direction: 'mirror' },
  ],
};

describe('topology — deriveSlots', () => {
  it('creates a DB slot for every non-bridge table', () => {
    const slots = deriveSlots({ schema: SCHEMA, claims: [], schemaMapping: MAPPING });
    const dbSlots = slots.filter((s) => s.surface === 'db');
    expect(dbSlots.map((s) => s.name)).toEqual(['events']);
  });

  it('excludes bridge tables from DB slots', () => {
    const slots = deriveSlots({ schema: SCHEMA, claims: [], schemaMapping: MAPPING });
    expect(slots.find((s) => s.surface === 'db' && s.name === 'users')).toBeUndefined();
  });

  it('excludes external-mirrored tables per classification', () => {
    const classifications: TableClassification[] = [
      { table: 'events', role: 'external-mirrored' },
    ];
    const slots = deriveSlots({
      schema: SCHEMA,
      claims: [],
      schemaMapping: { bridgeTables: [], mappings: [] },
      tableClassifications: classifications,
    });
    expect(slots.find((s) => s.surface === 'db' && s.name === 'events')).toBeUndefined();
  });

  it('creates one API slot per adapter.resource', () => {
    const slots = deriveSlots({
      schema: SCHEMA,
      resourceSpecs: STRIPE_SPECS,
      schemaMapping: MAPPING,
      claims: [],
    });
    const apiSlots = slots.filter((s) => s.surface === 'api');
    expect(apiSlots.map((s) => s.name).sort()).toEqual(['stripe.customer', 'stripe.price']);
  });

  it('attaches db claims to their matching db slot', () => {
    const claims: Claim[] = [
      { id: 'c_events', quote: '', kind: 'row_count', target: { surface: 'db', name: 'events', filter: { kind: 'login' } }, expected: 100 },
    ];
    const slots = deriveSlots({ schema: SCHEMA, claims, schemaMapping: MAPPING });
    const eventsSlot = slots.find((s) => s.name === 'events');
    expect(eventsSlot?.claims).toHaveLength(1);
    expect(eventsSlot?.claims[0]!.id).toBe('c_events');
  });

  it('attaches api claims with exact resource match', () => {
    const claims: Claim[] = [
      { id: 'c_stripe', quote: '', kind: 'row_count', target: { surface: 'api', name: 'stripe.customer' }, expected: 1200 },
    ];
    const slots = deriveSlots({
      schema: SCHEMA,
      resourceSpecs: STRIPE_SPECS,
      schemaMapping: MAPPING,
      claims,
    });
    const stripeCustomer = slots.find((s) => s.name === 'stripe.customer');
    expect(stripeCustomer?.claims).toHaveLength(1);
    expect(stripeCustomer?.claims[0]!.id).toBe('c_stripe');
  });

  it('matches plural api claim names back to spec keys (customers → customer)', () => {
    const claims: Claim[] = [
      { id: 'c_plural', quote: '', kind: 'row_count', target: { surface: 'api', name: 'stripe.customers' }, expected: 50 },
    ];
    const slots = deriveSlots({
      schema: SCHEMA,
      resourceSpecs: STRIPE_SPECS,
      schemaMapping: MAPPING,
      claims,
    });
    const stripeCustomer = slots.find((s) => s.name === 'stripe.customer');
    expect(stripeCustomer?.claims).toHaveLength(1);
  });

  it('uses an unfiltered row_count claim expected as the suggested slot total', () => {
    const claims: Claim[] = [
      { id: 'c_total', quote: '', kind: 'row_count', target: { surface: 'api', name: 'stripe.customer' }, expected: 1200 },
      { id: 'c_pro', quote: '', kind: 'row_count', target: { surface: 'api', name: 'stripe.customer', filter: { plan: 'pro' } }, expected: 100 },
    ];
    const slots = deriveSlots({
      schema: SCHEMA,
      resourceSpecs: STRIPE_SPECS,
      schemaMapping: MAPPING,
      claims,
    });
    const stripeCustomer = slots.find((s) => s.name === 'stripe.customer');
    expect(stripeCustomer?.suggestedCount).toBe(1200);
  });

  it('falls back to reference default for reference-volume resources without claims', () => {
    const slots = deriveSlots({
      schema: { tables: [], enums: [], insertionOrder: [] },
      resourceSpecs: STRIPE_SPECS,
      schemaMapping: MAPPING,
      claims: [],
    });
    const price = slots.find((s) => s.name === 'stripe.price');
    expect(price?.suggestedCount).toBe(5); // DEFAULT_REFERENCE_COUNT
  });

  it('falls back to default DB count when no claims target the table', () => {
    const slots = deriveSlots({ schema: SCHEMA, claims: [], schemaMapping: MAPPING });
    const events = slots.find((s) => s.name === 'events');
    expect(events?.suggestedCount).toBe(50);
  });

  it('sums row_count claim expecteds when no unfiltered claim exists', () => {
    const claims: Claim[] = [
      { id: 'c_login', quote: '', kind: 'row_count', target: { surface: 'db', name: 'events', filter: { kind: 'login' } }, expected: 100 },
      { id: 'c_signup', quote: '', kind: 'row_count', target: { surface: 'db', name: 'events', filter: { kind: 'signup' } }, expected: 30 },
    ];
    const slots = deriveSlots({ schema: SCHEMA, claims, schemaMapping: MAPPING });
    const events = slots.find((s) => s.name === 'events');
    expect(events?.suggestedCount).toBe(130);
  });
});
