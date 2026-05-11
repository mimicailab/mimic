import { describe, it, expect } from 'vitest';
import { BlueprintExpander } from '../../generate/expander.js';
import type {
  Blueprint,
  SchemaModel,
  SchemaMapping,
  TableClassification,
} from '../../types/index.js';

// Minimal fixture: a `customers` identity table seeded by the Stripe adapter,
// plus one matched archetype (97 entities) and one apiOnly archetype (3
// entities). The expander should produce 100 API customer entities and 97 DB
// rows — proving cross-platform asymmetry survives end-to-end.

const SCHEMA: SchemaModel = {
  enums: [],
  insertionOrder: ['customers'],
  tables: [
    {
      name: 'customers',
      primaryKey: ['id'],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
      columns: [
        { name: 'id', type: 'integer', pgType: 'serial', isNullable: false, hasDefault: true, isAutoIncrement: true, isGenerated: false },
        { name: 'stripe_customer_id', type: 'text', pgType: 'text', isNullable: true, hasDefault: false, isAutoIncrement: false, isGenerated: false },
        { name: 'email', type: 'text', pgType: 'text', isNullable: true, hasDefault: false, isAutoIncrement: false, isGenerated: false },
      ],
    },
  ],
};

const SCHEMA_MAPPING: SchemaMapping = {
  bridgeTables: [],
  mappings: [
    {
      dbTable: 'customers',
      dbColumn: 'stripe_customer_id',
      adapterId: 'stripe',
      apiResource: 'customer',
      apiField: 'id',
      isBridgeTable: false,
      direction: 'mirror',
    },
  ],
};

const CLASSIFICATIONS: TableClassification[] = [
  {
    table: 'customers',
    role: 'identity',
    sources: [
      {
        adapter: 'stripe',
        resource: 'customer',
        discriminator: undefined,
      } as TableClassification['sources'] extends (infer U)[] | undefined ? U : never,
    ],
  },
];

const BLUEPRINT: Blueprint = {
  version: '1.0',
  personaId: 'test-persona',
  domain: 'test',
  generatedAt: '2026-05-07T00:00:00Z',
  generatedBy: 'test',
  checksum: 'test',
  persona: {
    name: 'test',
    age: 30,
    occupation: 'tester',
    location: 'nowhere',
    description: 'test persona',
  },
  data: {
    entities: { customers: [] },
    patterns: [],
    apiEntityArchetypes: {
      stripe: {
        customer: {
          count: 97,
          archetypes: [
            {
              label: 'matched',
              weight: 1.0,
              fields: { object: 'customer' },
              vary: {
                id: { type: 'sequence', prefix: 'cus_p1_' },
                email: { type: 'email' },
              },
            },
            {
              label: 'stripe-only-orphan',
              weight: 0.04,
              apiOnly: true,
              count: 3,
              fields: { object: 'customer' },
              vary: {
                id: { type: 'sequence', prefix: 'cus_p1_' },
                email: { type: 'email' },
              },
            },
          ],
        },
      },
    },
  },
};

describe('apiOnly: end-to-end expander behavior', () => {
  it('emits matched + apiOnly entities to the API side, but only matched to DB', () => {
    const expander = new BlueprintExpander(42);
    const expanded = expander.expand(
      BLUEPRINT,
      SCHEMA,
      '7 days',
      undefined,
      SCHEMA_MAPPING,
      CLASSIFICATIONS,
    );

    const stripeCustomers = expanded.apiResponses.stripe?.responses.customer ?? [];
    const dbCustomers = expanded.tables.customers ?? [];

    // 97 matched + 3 apiOnly = 100 total API entities
    expect(stripeCustomers.length).toBe(100);

    // DB has only 97 — apiOnly entities are NOT mirrored
    expect(dbCustomers.length).toBe(97);

    // Sanity: every DB row's stripe_customer_id should match a Stripe API id
    const dbStripeIds = new Set(dbCustomers.map(r => r.stripe_customer_id as string));
    const apiIds = new Set(stripeCustomers.map(r => (r.body as { id?: string }).id!));

    // Every DB-side id appears on the API side
    for (const id of dbStripeIds) {
      expect(apiIds.has(id)).toBe(true);
    }

    // Exactly 3 API ids have no DB counterpart — the orphans
    const apiOnlyIds = [...apiIds].filter(id => !dbStripeIds.has(id));
    expect(apiOnlyIds.length).toBe(3);
  });

  it('a matched-only archetype produces symmetric data (regression guard)', () => {
    const symmetricBlueprint: Blueprint = {
      ...BLUEPRINT,
      data: {
        ...BLUEPRINT.data,
        apiEntityArchetypes: {
          stripe: {
            customer: {
              count: 50,
              archetypes: [
                {
                  label: 'matched',
                  weight: 1.0,
                  fields: { object: 'customer' },
                  vary: {
                    id: { type: 'sequence', prefix: 'cus_p1_' },
                    email: { type: 'email' },
                  },
                },
              ],
            },
          },
        },
      },
    };

    const expander = new BlueprintExpander(42);
    const expanded = expander.expand(
      symmetricBlueprint,
      SCHEMA,
      '7 days',
      undefined,
      SCHEMA_MAPPING,
      CLASSIFICATIONS,
    );

    expect(expanded.apiResponses.stripe?.responses.customer?.length).toBe(50);
    expect(expanded.tables.customers?.length).toBe(50);
  });
});
