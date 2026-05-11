import { describe, it, expect } from 'vitest';
import { SeededRandom } from '../../generate/seed-random.js';
import { BlueprintExpander, parseVolume } from '../../generate/expander.js';
import type { Blueprint, SchemaModel, SchemaMapping } from '../../types/index.js';

describe('SeededRandom', () => {
  it('should produce deterministic results with same seed', () => {
    const rng1 = new SeededRandom(42);
    const rng2 = new SeededRandom(42);

    const values1 = Array.from({ length: 10 }, () => rng1.next());
    const values2 = Array.from({ length: 10 }, () => rng2.next());

    expect(values1).toEqual(values2);
  });

  it('should produce different results with different seeds', () => {
    const rng1 = new SeededRandom(42);
    const rng2 = new SeededRandom(99);

    const v1 = rng1.next();
    const v2 = rng2.next();

    expect(v1).not.toBe(v2);
  });

  it('should generate integers in range', () => {
    const rng = new SeededRandom(42);
    for (let i = 0; i < 100; i++) {
      const val = rng.intBetween(10, 20);
      expect(val).toBeGreaterThanOrEqual(10);
      expect(val).toBeLessThanOrEqual(20);
      expect(Number.isInteger(val)).toBe(true);
    }
  });

  it('should generate decimals in range', () => {
    const rng = new SeededRandom(42);
    for (let i = 0; i < 100; i++) {
      const val = rng.decimalBetween(1.0, 5.0, 2);
      expect(val).toBeGreaterThanOrEqual(1.0);
      expect(val).toBeLessThanOrEqual(5.0);
    }
  });

  it('should pick from array deterministically', () => {
    const rng1 = new SeededRandom(42);
    const rng2 = new SeededRandom(42);
    const items = ['a', 'b', 'c', 'd', 'e'];

    const picks1 = Array.from({ length: 10 }, () => rng1.pick(items));
    const picks2 = Array.from({ length: 10 }, () => rng2.pick(items));

    expect(picks1).toEqual(picks2);
  });

  it('should shuffle deterministically', () => {
    const rng1 = new SeededRandom(42);
    const rng2 = new SeededRandom(42);
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    const shuffled1 = rng1.shuffle([...items]);
    const shuffled2 = rng2.shuffle([...items]);

    expect(shuffled1).toEqual(shuffled2);
  });

  it('should handle chance correctly', () => {
    const rng = new SeededRandom(42);
    let trueCount = 0;
    const iterations = 1000;

    for (let i = 0; i < iterations; i++) {
      if (rng.chance(0.5)) trueCount++;
    }

    expect(trueCount).toBeGreaterThan(400);
    expect(trueCount).toBeLessThan(600);
  });
});

describe('@default(now()) timestamp filling', () => {
  // A minimal `payments` table mirroring the shape that exposed the bug:
  // `created_at` carries a `now()` SQL default and the LLM/expander would
  // otherwise leave it unset, causing the seeder to drop the column and
  // every row to collapse to seed-insertion time.
  const SCHEMA: SchemaModel = {
    enums: [],
    insertionOrder: ['payments'],
    tables: [
      {
        name: 'payments',
        primaryKey: ['id'],
        foreignKeys: [],
        uniqueConstraints: [],
        checkConstraints: [],
        columns: [
          { name: 'id', type: 'integer', pgType: 'serial', isNullable: false, hasDefault: true, isAutoIncrement: true, isGenerated: false },
          { name: 'amount_cents', type: 'integer', pgType: 'integer', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
          { name: 'created_at', type: 'timestamptz', pgType: 'timestamptz', isNullable: false, hasDefault: true, defaultValue: 'now()', isAutoIncrement: false, isGenerated: false },
        ],
      },
    ],
  };

  const buildBlueprint = (rowCount: number): Blueprint => ({
    version: '1.0',
    personaId: 'test',
    domain: 'test',
    generatedAt: '2026-05-07T00:00:00Z',
    generatedBy: 'test',
    checksum: 'test',
    persona: { name: 'test', age: 30, occupation: 'tester', location: 'nowhere', description: 'test persona' },
    data: {
      entities: {
        payments: Array.from({ length: rowCount }, (_, i) => ({
          id: i + 1,
          amount_cents: 1000 + i,
          // Note: deliberately NO created_at — this is the bug condition.
        })),
      },
      patterns: [],
    },
  });

  it('fills missing now()-default timestamps with values inside the configured range', () => {
    const expander = new BlueprintExpander(42);
    const expanded = expander.expand(buildBlueprint(50), SCHEMA, '12 weeks');

    const rows = expanded.tables.payments ?? [];
    expect(rows.length).toBe(50);

    const range = parseVolume('12 weeks');
    const rangeStart = range.start.getTime();
    const rangeEnd = range.end.getTime();

    const timestamps = rows.map((r) => Date.parse(r.created_at as string));
    for (const t of timestamps) {
      expect(Number.isNaN(t)).toBe(false);
      // Within the configured 12-week range, with a small tolerance for
      // clock drift between range computation and assertion.
      expect(t).toBeGreaterThanOrEqual(rangeStart - 60_000);
      expect(t).toBeLessThanOrEqual(rangeEnd + 60_000);
    }

    // The distribution should be spread out, not collapsed to a single instant.
    // Specifically: not every row's created_at should be within seconds of
    // every other row's (which is the symptom of the seeder default fallback).
    const uniqueDays = new Set(rows.map((r) => (r.created_at as string).slice(0, 10)));
    expect(uniqueDays.size).toBeGreaterThan(10);
  });

  it('preserves LLM-supplied values and only fills the gaps', () => {
    const blueprint = buildBlueprint(10);
    // Pre-populate half the rows with a fixed historical timestamp.
    const FIXED = '2026-03-01T00:00:00.000Z';
    for (let i = 0; i < 5; i++) {
      (blueprint.data.entities!.payments![i] as Record<string, unknown>).created_at = FIXED;
    }

    const expander = new BlueprintExpander(42);
    const expanded = expander.expand(blueprint, SCHEMA, '12 weeks');
    const rows = expanded.tables.payments ?? [];

    // After sortChronologically the rows reorder by created_at, so look up by id.
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    for (let i = 0; i < 5; i++) {
      expect(byId.get(i + 1)?.created_at).toBe(FIXED);
    }
    for (let i = 5; i < 10; i++) {
      expect(byId.get(i + 1)?.created_at).not.toBe(FIXED);
      expect(byId.get(i + 1)?.created_at).toBeTruthy();
    }
  });

  it('injects a `{ type: "timestamp" }` vary rule onto archetypes that omit @default(now()) columns', () => {
    const blueprint = buildBlueprint(5);
    // Restructure as an archetype config so the inject path applies. The
    // shape mirrors what the LLM emits today (no created_at in vary/fields).
    blueprint.data.entityArchetypes = {
      payments: {
        count: 5,
        archetypes: [
          {
            label: 'monthly',
            weight: 1,
            fields: { amount_cents: 1000 },
            vary: {},
          },
        ],
      },
    };
    blueprint.data.entities = {};

    const expander = new BlueprintExpander(42);
    expander.expand(blueprint, SCHEMA, '12 weeks');

    const injected = blueprint.data.entityArchetypes.payments.archetypes[0]!.vary.created_at;
    expect(injected).toBeDefined();
    expect(injected!.type).toBe('timestamp');
    expect(typeof injected!.min).toBe('number');
    expect(typeof injected!.max).toBe('number');
    expect(injected!.max!).toBeGreaterThan(injected!.min!);
  });

  it('does not overwrite an LLM-supplied vary rule on a @default(now()) column', () => {
    const blueprint = buildBlueprint(3);
    const llmRule = { type: 'pick' as const, values: ['2026-01-01T00:00:00Z'] };
    blueprint.data.entityArchetypes = {
      payments: {
        count: 3,
        archetypes: [
          {
            label: 'fixed',
            weight: 1,
            fields: { amount_cents: 1000 },
            vary: { created_at: llmRule },
          },
        ],
      },
    };
    blueprint.data.entities = {};

    const expander = new BlueprintExpander(42);
    expander.expand(blueprint, SCHEMA, '12 weeks');

    expect(blueprint.data.entityArchetypes.payments.archetypes[0]!.vary.created_at).toBe(llmRule);
  });

  it('makes anchor-bound archetypes across two tables agree on customer FK and date', () => {
    // Schema: customers (identity) + payments (anchor-bound archetypes target it).
    const SCHEMA: SchemaModel = {
      enums: [],
      insertionOrder: ['customers', 'payments'],
      tables: [
        {
          name: 'customers',
          primaryKey: ['id'],
          foreignKeys: [],
          uniqueConstraints: [],
          checkConstraints: [],
          columns: [
            { name: 'id', type: 'integer', pgType: 'serial', isNullable: false, hasDefault: true, isAutoIncrement: true, isGenerated: false },
            { name: 'name', type: 'text', pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
          ],
        },
        {
          name: 'payments',
          primaryKey: ['id'],
          foreignKeys: [{ columns: ['customer_id'], referencedTable: 'customers', referencedColumns: ['id'] }],
          uniqueConstraints: [],
          checkConstraints: [],
          columns: [
            { name: 'id', type: 'integer', pgType: 'serial', isNullable: false, hasDefault: true, isAutoIncrement: true, isGenerated: false },
            { name: 'customer_id', type: 'integer', pgType: 'integer', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'amount_cents', type: 'integer', pgType: 'integer', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'created_at', type: 'timestamptz', pgType: 'timestamptz', isNullable: false, hasDefault: true, defaultValue: 'now()', isAutoIncrement: false, isGenerated: false },
          ],
        },
      ],
    };

    const blueprint: Blueprint = {
      version: '1.0',
      personaId: 'klein-double-charge',
      domain: 'billing',
      generatedAt: '2026-05-07T00:00:00Z',
      generatedBy: 'test',
      checksum: 'test',
      persona: { name: 'test', age: 30, occupation: 'tester', location: 'nowhere', description: 'test persona' },
      data: {
        entities: {},
        patterns: [],
        anchors: [
          {
            id: 'klein_double_charge',
            customer: { match: 'Klein Records' },
            dates: { event: '2026-04-29T00:00:00.000Z' },
          },
        ],
        entityArchetypes: {
          customers: {
            count: 5,
            archetypes: [
              {
                label: 'klein',
                weight: 0.2,
                fields: { name: 'Klein Records' },
                vary: {},
              },
              {
                label: 'others',
                weight: 0.8,
                fields: {},
                vary: { name: { type: 'companyName' } },
              },
            ],
          },
          payments: {
            count: 0, // no weighted archetypes — only anchor-bound rows
            archetypes: [
              {
                label: 'klein_double_charge',
                weight: 0,
                anchor: 'klein_double_charge',
                count: 2,
                fields: { amount_cents: 9900 },
                vary: {
                  customer_id: { type: 'anchor_field', anchor: 'klein_double_charge', key: 'id' },
                  created_at: { type: 'anchor_date', anchor: 'klein_double_charge', key: 'event' },
                },
              },
            ],
          },
        },
      },
    };

    const expander = new BlueprintExpander(42);
    const expanded = expander.expand(blueprint, SCHEMA, '12 weeks');

    const customers = expanded.tables.customers ?? [];
    const payments = expanded.tables.payments ?? [];
    const klein = customers.find((c) => String(c.name) === 'Klein Records');
    expect(klein).toBeDefined();

    expect(payments.length).toBe(2);
    for (const p of payments) {
      expect(p.customer_id).toBe(klein!.id);
      expect(p.created_at).toBe('2026-04-29T00:00:00.000Z');
      expect(p.amount_cents).toBe(9900);
    }
  });

  it('coordinates an anchor across DB payments and Stripe payment_intent API entities', () => {
    const SCHEMA: SchemaModel = {
      enums: [],
      insertionOrder: ['customers', 'payments'],
      tables: [
        {
          name: 'customers',
          primaryKey: ['id'],
          foreignKeys: [],
          uniqueConstraints: [],
          checkConstraints: [],
          columns: [
            { name: 'id', type: 'integer', pgType: 'serial', isNullable: false, hasDefault: true, isAutoIncrement: true, isGenerated: false },
            { name: 'name', type: 'text', pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'stripe_customer_id', type: 'text', pgType: 'text', isNullable: true, hasDefault: false, isAutoIncrement: false, isGenerated: false },
          ],
        },
        {
          name: 'payments',
          primaryKey: ['id'],
          foreignKeys: [{ columns: ['customer_id'], referencedTable: 'customers', referencedColumns: ['id'] }],
          uniqueConstraints: [],
          checkConstraints: [],
          columns: [
            { name: 'id', type: 'integer', pgType: 'serial', isNullable: false, hasDefault: true, isAutoIncrement: true, isGenerated: false },
            { name: 'customer_id', type: 'integer', pgType: 'integer', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'amount_cents', type: 'integer', pgType: 'integer', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'created_at', type: 'timestamptz', pgType: 'timestamptz', isNullable: false, hasDefault: true, defaultValue: 'now()', isAutoIncrement: false, isGenerated: false },
            { name: 'stripe_payment_intent_id', type: 'text', pgType: 'text', isNullable: true, hasDefault: false, isAutoIncrement: false, isGenerated: false },
          ],
        },
      ],
    };

    const blueprint: Blueprint = {
      version: '1.0',
      personaId: 'klein-cross-surface',
      domain: 'billing',
      generatedAt: '2026-05-08T00:00:00Z',
      generatedBy: 'test',
      checksum: 'test',
      persona: { name: 'test', age: 30, occupation: 'tester', location: 'nowhere', description: 'test persona' },
      data: {
        entities: {},
        patterns: [],
        anchors: [
          {
            id: 'klein_double_charge',
            customer: { match: 'Klein Records' },
            dates: { event: '2026-04-29T00:00:00.000Z' },
          },
        ],
        entityArchetypes: {
          customers: {
            count: 4,
            archetypes: [
              {
                label: 'klein',
                weight: 0.25,
                fields: { name: 'Klein Records' },
                vary: { stripe_customer_id: { type: 'sequence', prefix: 'cus_klein_' } },
              },
              {
                label: 'others',
                weight: 0.75,
                fields: {},
                vary: {
                  name: { type: 'companyName' },
                  stripe_customer_id: { type: 'sequence', prefix: 'cus_p1_' },
                },
              },
            ],
          },
          payments: {
            count: 0,
            archetypes: [
              {
                label: 'klein_dup_charge_db',
                weight: 0,
                anchor: 'klein_double_charge',
                count: 2,
                fields: { amount_cents: 9900 },
                vary: {
                  customer_id: { type: 'anchor_field', anchor: 'klein_double_charge', key: 'id' },
                  created_at: { type: 'anchor_date', anchor: 'klein_double_charge', key: 'event' },
                  stripe_payment_intent_id: { type: 'sequence', prefix: 'pi_klein_dup_' },
                },
              },
            ],
          },
        },
        apiEntityArchetypes: {
          stripe: {
            customer: {
              count: 4,
              archetypes: [
                {
                  label: 'klein',
                  weight: 0.25,
                  fields: { object: 'customer', name: 'Klein Records' },
                  vary: { id: { type: 'sequence', prefix: 'cus_klein_' } },
                },
                {
                  label: 'others',
                  weight: 0.75,
                  fields: { object: 'customer' },
                  vary: {
                    id: { type: 'sequence', prefix: 'cus_p1_' },
                    name: { type: 'companyName' },
                  },
                },
              ],
            },
            payment_intent: {
              count: 0,
              archetypes: [
                {
                  label: 'klein_dup_charge_api',
                  weight: 0,
                  anchor: 'klein_double_charge',
                  count: 2,
                  fields: { object: 'payment_intent', amount: 9900, status: 'succeeded' },
                  vary: {
                    id: { type: 'sequence', prefix: 'pi_klein_dup_' },
                    customer: { type: 'anchor_field', anchor: 'klein_double_charge', key: 'id' },
                    created: { type: 'anchor_date', anchor: 'klein_double_charge', key: 'event', format: 'epoch_seconds' },
                  },
                },
              ],
            },
          },
        },
      },
    };

    const expander = new BlueprintExpander(42);
    // Force the legacy (non-3-role) flow by passing empty classifications;
    // otherwise the heuristic classifier marks `customers` as an identity
    // table and derives DB rows from API entities, which would conflict with
    // this test's intent of coordinating two independently-owned surfaces.
    const expanded = expander.expand(
      blueprint,
      SCHEMA,
      '12 weeks',
      undefined,
      undefined,
      [],
    );

    // DB side
    const customers = expanded.tables.customers ?? [];
    const klein = customers.find((c) => String(c.name) === 'Klein Records');
    expect(klein).toBeDefined();

    const payments = expanded.tables.payments ?? [];
    expect(payments.length).toBe(2);
    for (const p of payments) {
      expect(p.customer_id).toBe(klein!.id);
      expect(p.created_at).toBe('2026-04-29T00:00:00.000Z');
    }

    // API side
    const apiCustomers = expanded.apiResponses.stripe?.responses.customer ?? [];
    const apiKlein = apiCustomers
      .map((r) => r.body as Record<string, unknown>)
      .find((b) => String(b.name) === 'Klein Records');
    expect(apiKlein).toBeDefined();

    const apiPaymentIntents = expanded.apiResponses.stripe?.responses.payment_intent ?? [];
    expect(apiPaymentIntents.length).toBe(2);
    for (const r of apiPaymentIntents) {
      const body = r.body as Record<string, unknown>;
      expect(body.customer).toBe(apiKlein!.id);
      expect(body.created).toBe(Math.floor(Date.parse('2026-04-29T00:00:00.000Z') / 1000));
      expect(String(body.id)).toMatch(/^pi_klein_dup_/);
    }

    // Cross-surface coherence — what the anchor mechanism actually owns:
    // the DB and API rows agree on customer and date. The strict ID-equality
    // (DB.stripe_payment_intent_id === API.payment_intent.id) is a separate
    // concern handled by the 3-role derive flow when properly configured;
    // here we just assert the prefix domain matches, proving the LLM's
    // intent of "use shared prefix" has at least taken effect.
    for (const p of payments) {
      expect(String(p.stripe_payment_intent_id)).toMatch(/^pi_klein_dup_/);
    }
  });

  it('backfills a missing API entity when a DB row carries a cross-surface FK with no API counterpart', () => {
    // Scenario: LLM put Klein's double-charge in static `data.entities[]`
    // (bypassing the mirror-derive flow). DB references a Stripe
    // payment_intent that doesn't exist on the API side. The reverse-mirror
    // pass should synthesize a matching API entity from the DB row.
    const SCHEMA: SchemaModel = {
      enums: [],
      insertionOrder: ['customers', 'payments'],
      tables: [
        {
          name: 'customers',
          primaryKey: ['id'],
          foreignKeys: [],
          uniqueConstraints: [],
          checkConstraints: [],
          columns: [
            { name: 'id', type: 'integer', pgType: 'serial', isNullable: false, hasDefault: true, isAutoIncrement: true, isGenerated: false },
            { name: 'name', type: 'text', pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'stripe_customer_id', type: 'text', pgType: 'text', isNullable: true, hasDefault: false, isAutoIncrement: false, isGenerated: false },
          ],
        },
        {
          name: 'payments',
          primaryKey: ['id'],
          foreignKeys: [{ columns: ['customer_id'], referencedTable: 'customers', referencedColumns: ['id'] }],
          uniqueConstraints: [],
          checkConstraints: [],
          columns: [
            { name: 'id', type: 'integer', pgType: 'serial', isNullable: false, hasDefault: true, isAutoIncrement: true, isGenerated: false },
            { name: 'customer_id', type: 'integer', pgType: 'integer', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'amount_cents', type: 'integer', pgType: 'integer', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'status', type: 'text', pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'created_at', type: 'timestamptz', pgType: 'timestamptz', isNullable: false, hasDefault: true, defaultValue: 'now()', isAutoIncrement: false, isGenerated: false },
            { name: 'stripe_payment_intent_id', type: 'text', pgType: 'text', isNullable: true, hasDefault: false, isAutoIncrement: false, isGenerated: false },
          ],
        },
      ],
    };

    const SCHEMA_MAPPING: SchemaMapping = {
      bridgeTables: [],
      mappings: [
        { dbTable: 'customers', dbColumn: 'stripe_customer_id', adapterId: 'stripe', apiResource: 'customer', apiField: 'id', isBridgeTable: false, direction: 'mirror' },
        { dbTable: 'payments', dbColumn: 'stripe_payment_intent_id', adapterId: 'stripe', apiResource: 'payment_intent', apiField: 'id', isBridgeTable: false, direction: 'mirror' },
      ],
    };

    const blueprint: Blueprint = {
      version: '1.0',
      personaId: 'klein-static-entities',
      domain: 'billing',
      generatedAt: '2026-05-08T00:00:00Z',
      generatedBy: 'test',
      checksum: 'test',
      persona: { name: 'test', age: 30, occupation: 'tester', location: 'nowhere', description: 'test persona' },
      data: {
        entities: {
          customers: [
            { id: 1, name: 'Klein Records', stripe_customer_id: 'cus_klein_001' },
          ],
          // Klein's double-charge as static entities — the symptom the
          // backfill pass is meant to repair.
          payments: [
            {
              id: 101,
              customer_id: 1,
              amount_cents: 9900,
              status: 'succeeded',
              created_at: '2026-04-29T09:15:00Z',
              stripe_payment_intent_id: 'pi_klein_static_001',
            },
            {
              id: 102,
              customer_id: 1,
              amount_cents: 9900,
              status: 'succeeded',
              created_at: '2026-04-29T09:17:00Z',
              stripe_payment_intent_id: 'pi_klein_static_002',
            },
          ],
        },
        patterns: [],
        // No apiEntityArchetypes — so the API side starts empty for
        // payment_intent. Backfill must populate it.
        apiEntityArchetypes: { stripe: { customer: { count: 0, archetypes: [] } } },
      },
    };

    const expander = new BlueprintExpander(42);
    const expanded = expander.expand(
      blueprint,
      SCHEMA,
      '12 weeks',
      undefined,
      SCHEMA_MAPPING,
      [], // force legacy flow so static entities land verbatim
    );

    const intents = expanded.apiResponses.stripe?.responses.payment_intent ?? [];
    const byId = new Map(intents.map((r) => [(r.body as Record<string, unknown>).id as string, r.body as Record<string, unknown>]));

    expect(byId.has('pi_klein_static_001')).toBe(true);
    expect(byId.has('pi_klein_static_002')).toBe(true);

    const intent1 = byId.get('pi_klein_static_001')!;
    expect(intent1.amount).toBe(9900);
    expect(intent1.status).toBe('succeeded');
    expect(intent1.customer).toBe('cus_klein_001');
    expect(intent1.created).toBe(Math.floor(Date.parse('2026-04-29T09:15:00Z') / 1000));
    expect(intent1.object).toBe('payment_intent');
  });

  it('does not duplicate API entities that already match a DB cross-surface FK', () => {
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
            { name: 'name', type: 'text', pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'stripe_customer_id', type: 'text', pgType: 'text', isNullable: true, hasDefault: false, isAutoIncrement: false, isGenerated: false },
          ],
        },
      ],
    };

    const SCHEMA_MAPPING: SchemaMapping = {
      bridgeTables: [],
      mappings: [
        { dbTable: 'customers', dbColumn: 'stripe_customer_id', adapterId: 'stripe', apiResource: 'customer', apiField: 'id', isBridgeTable: false, direction: 'mirror' },
      ],
    };

    const blueprint: Blueprint = {
      version: '1.0',
      personaId: 'no-dups',
      domain: 'billing',
      generatedAt: '2026-05-08T00:00:00Z',
      generatedBy: 'test',
      checksum: 'test',
      persona: { name: 'test', age: 30, occupation: 'tester', location: 'nowhere', description: 'test persona' },
      data: {
        entities: {
          customers: [
            { id: 1, name: 'Klein Records', stripe_customer_id: 'cus_klein_001' },
          ],
        },
        patterns: [],
        apiEntities: {
          stripe: {
            customer: [{ id: 'cus_klein_001', object: 'customer', name: 'Klein Records' }],
          },
        },
      },
    };

    const expander = new BlueprintExpander(42);
    const expanded = expander.expand(
      blueprint,
      SCHEMA,
      '12 weeks',
      undefined,
      SCHEMA_MAPPING,
      [],
    );

    const customers = expanded.apiResponses.stripe?.responses.customer ?? [];
    const kleinEntries = customers.filter((r) => (r.body as Record<string, unknown>).id === 'cus_klein_001');
    expect(kleinEntries.length).toBe(1);
  });

  it('enriches mirrored rows with DB-archetype fields the schema mapping did not cover', () => {
    // Reproduces the revenue-recovery bug: payments table is external-mirrored
    // from stripe.charge. The LLM emits failed-charge API archetypes with
    // `failure_code: null`, AND the schema mapping does not connect
    // failure_reason ↔ failure_code. Without enrichment, the DB column ends up
    // NULL on every mirrored failed payment.
    //
    // The DB archetype `historical-failed` carries a `vary.failure_reason: pick`
    // rule. Previously the mirror flow ignored it. Now it should apply that
    // rule to mirrored rows whose `status` matches the archetype's constant.
    const SCHEMA: SchemaModel = {
      enums: [],
      insertionOrder: ['customers', 'payments'],
      tables: [
        {
          name: 'customers',
          primaryKey: ['id'],
          foreignKeys: [],
          uniqueConstraints: [],
          checkConstraints: [],
          columns: [
            { name: 'id', type: 'integer', pgType: 'serial', isNullable: false, hasDefault: true, isAutoIncrement: true, isGenerated: false },
            { name: 'name', type: 'text', pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'stripe_customer_id', type: 'text', pgType: 'text', isNullable: true, hasDefault: false, isAutoIncrement: false, isGenerated: false },
          ],
        },
        {
          name: 'payments',
          primaryKey: ['id'],
          foreignKeys: [{ columns: ['customer_id'], referencedTable: 'customers', referencedColumns: ['id'] }],
          uniqueConstraints: [],
          checkConstraints: [],
          columns: [
            { name: 'id', type: 'integer', pgType: 'serial', isNullable: false, hasDefault: true, isAutoIncrement: true, isGenerated: false },
            { name: 'customer_id', type: 'integer', pgType: 'integer', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'stripe_payment_id', type: 'text', pgType: 'text', isNullable: true, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'amount_cents', type: 'integer', pgType: 'integer', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'status', type: 'text', pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'failure_reason', type: 'text', pgType: 'text', isNullable: true, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'created_at', type: 'timestamptz', pgType: 'timestamptz', isNullable: false, hasDefault: true, defaultValue: 'now()', isAutoIncrement: false, isGenerated: false },
          ],
        },
      ],
    };

    // Schema mapping covers IDs only — the bug. failure_reason ↔ failure_code
    // is missing, so without archetype enrichment the column stays NULL.
    const SCHEMA_MAPPING: SchemaMapping = {
      bridgeTables: [],
      mappings: [
        { dbTable: 'customers', dbColumn: 'stripe_customer_id', adapterId: 'stripe', apiResource: 'customer', apiField: 'id', isBridgeTable: false, direction: 'mirror' },
        { dbTable: 'payments', dbColumn: 'stripe_payment_id', adapterId: 'stripe', apiResource: 'charge', apiField: 'id', isBridgeTable: false, direction: 'mirror' },
      ],
    };

    const blueprint: Blueprint = {
      version: '1.0',
      personaId: 'mirror-archetype-enrichment',
      domain: 'billing',
      generatedAt: '2026-05-08T00:00:00Z',
      generatedBy: 'test',
      checksum: 'test',
      persona: { name: 'test', age: 30, occupation: 'tester', location: 'nowhere', description: 'test persona' },
      data: {
        entities: {},
        patterns: [],
        entityArchetypes: {
          customers: {
            count: 4,
            archetypes: [
              {
                label: 'co',
                weight: 1.0,
                fields: {},
                vary: {
                  name: { type: 'companyName' },
                  stripe_customer_id: { type: 'sequence', prefix: 'cus_p1_' },
                },
              },
            ],
          },
          payments: {
            count: 10,
            archetypes: [
              {
                label: 'succeeded',
                weight: 0.8,
                // status=succeeded matches succeeded mirrored rows; this
                // archetype must NOT be applied to failed rows.
                fields: { status: 'succeeded', failure_reason: null },
                vary: {},
              },
              {
                label: 'historical-failed',
                weight: 0.2,
                // status=failed matches failed mirrored rows. The pick on
                // failure_reason is the value the bug left as NULL.
                fields: { status: 'failed' },
                vary: {
                  failure_reason: {
                    type: 'pick',
                    values: ['card_expired', 'insufficient_funds', 'lost_card'],
                  },
                },
              },
            ],
          },
        },
        apiEntityArchetypes: {
          stripe: {
            customer: {
              count: 4,
              archetypes: [
                {
                  label: 'co',
                  weight: 1.0,
                  fields: { object: 'customer' },
                  vary: {
                    id: { type: 'sequence', prefix: 'cus_p1_' },
                    name: { type: 'companyName' },
                  },
                },
              ],
            },
            charge: {
              count: 10,
              archetypes: [
                {
                  label: 'succeeded',
                  weight: 0.6,
                  fields: { object: 'charge', status: 'succeeded', failure_code: null, failure_message: null },
                  vary: {
                    id: { type: 'sequence', prefix: 'ch_p1_' },
                    customer: { type: 'sequence', prefix: 'cus_p1_' },
                  },
                },
                {
                  // The bug shape: status="failed" but failure_code stays null.
                  // Even after the prompt fix, we want enrichment to be a
                  // safety net when source body has no reason data.
                  label: 'failed-something',
                  weight: 0.4,
                  fields: { object: 'charge', status: 'failed', failure_code: null, failure_message: null },
                  vary: {
                    id: { type: 'sequence', prefix: 'ch_p1_' },
                    customer: { type: 'sequence', prefix: 'cus_p1_' },
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
      blueprint,
      SCHEMA,
      '12 weeks',
      undefined,
      SCHEMA_MAPPING,
    );

    const payments = expanded.tables.payments ?? [];
    expect(payments.length).toBeGreaterThan(0);

    const failed = payments.filter((p) => p.status === 'failed');
    const succeeded = payments.filter((p) => p.status === 'succeeded');

    // Every failed mirrored row gets a non-null failure_reason from the
    // matching DB archetype's vary rule.
    expect(failed.length).toBeGreaterThan(0);
    for (const p of failed) {
      expect(p.failure_reason).not.toBeNull();
      expect(p.failure_reason).not.toBeUndefined();
      expect(['card_expired', 'insufficient_funds', 'lost_card']).toContain(
        p.failure_reason as string,
      );
    }

    // The succeeded archetype's `fields.failure_reason: null` must not flip
    // succeeded rows to a fake reason — null is the right value there.
    for (const p of succeeded) {
      expect(p.failure_reason ?? null).toBeNull();
    }
  });

  it('expands DB anchor-bound archetypes for mirrored tables and claims their cross-surface ids so mirror skips API duplicates (DRIFT pattern)', () => {
    // Larkspur drift: DB has status=active, API has status=canceled, both
    // share the same stripe_subscription_id. The DB anchor archetype emits
    // the active row first, claims the id, mirror skips the matching API
    // entity. Net result: one DB row (active), one API row (canceled), ids
    // match — drift is observable.
    const SCHEMA: SchemaModel = {
      enums: [],
      insertionOrder: ['customers', 'subscriptions'],
      tables: [
        {
          name: 'customers',
          primaryKey: ['id'],
          foreignKeys: [],
          uniqueConstraints: [],
          checkConstraints: [],
          columns: [
            { name: 'id', type: 'integer', pgType: 'serial', isNullable: false, hasDefault: true, isAutoIncrement: true, isGenerated: false },
            { name: 'name', type: 'text', pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'stripe_customer_id', type: 'text', pgType: 'text', isNullable: true, hasDefault: false, isAutoIncrement: false, isGenerated: false },
          ],
        },
        {
          name: 'subscriptions',
          primaryKey: ['id'],
          foreignKeys: [{ columns: ['customer_id'], referencedTable: 'customers', referencedColumns: ['id'] }],
          uniqueConstraints: [],
          checkConstraints: [],
          columns: [
            { name: 'id', type: 'integer', pgType: 'serial', isNullable: false, hasDefault: true, isAutoIncrement: true, isGenerated: false },
            { name: 'customer_id', type: 'integer', pgType: 'integer', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'stripe_subscription_id', type: 'text', pgType: 'text', isNullable: true, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'plan', type: 'text', pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'status', type: 'text', pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'amount_cents', type: 'integer', pgType: 'integer', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'cancellation_reason', type: 'text', pgType: 'text', isNullable: true, hasDefault: false, isAutoIncrement: false, isGenerated: false },
          ],
        },
      ],
    };

    const SCHEMA_MAPPING: SchemaMapping = {
      bridgeTables: [],
      mappings: [
        { dbTable: 'customers', dbColumn: 'stripe_customer_id', adapterId: 'stripe', apiResource: 'customer', apiField: 'id', isBridgeTable: false, direction: 'mirror' },
        { dbTable: 'subscriptions', dbColumn: 'stripe_subscription_id', adapterId: 'stripe', apiResource: 'subscription', apiField: 'id', isBridgeTable: false, direction: 'mirror' },
        // Larkspur drift: subscription status diverges intentionally between
        // DB and Stripe. Anchor-pair reconciler must leave this alone.
        { dbTable: 'subscriptions', dbColumn: 'status', adapterId: 'stripe', apiResource: 'subscription', apiField: 'status', isBridgeTable: false, direction: 'drift_capable' },
      ],
    };

    const blueprint: Blueprint = {
      version: '1.0',
      personaId: 'larkspur-drift',
      domain: 'billing',
      generatedAt: '2026-05-08T00:00:00Z',
      generatedBy: 'test',
      checksum: 'test',
      persona: { name: 'test', age: 30, occupation: 'tester', location: 'nowhere', description: 'test persona' },
      data: {
        entities: {},
        patterns: [],
        anchors: [
          {
            id: 'larkspur_drift',
            customer: { match: 'Larkspur Inc' },
            dates: { event: '2026-04-30T00:00:00Z' },
          },
        ],
        entityArchetypes: {
          customers: {
            count: 2,
            archetypes: [
              { label: 'lark', weight: 0.5, fields: { name: 'Larkspur Inc' }, vary: { stripe_customer_id: { type: 'sequence', prefix: 'cus_p1_' } } },
              { label: 'others', weight: 0.5, fields: {}, vary: { name: { type: 'companyName' }, stripe_customer_id: { type: 'sequence', prefix: 'cus_p1_' } } },
            ],
          },
          subscriptions: {
            count: 0,
            archetypes: [
              {
                // DB-side drift override: hardcoded stripe_subscription_id
                // claims the id, mirror loop will skip the matching API
                // entity. Status stays active even though API says canceled.
                label: 'larkspur-drift-active',
                weight: 0,
                count: 1,
                anchor: 'larkspur_drift',
                fields: { plan: 'pro', status: 'active', amount_cents: 9900, stripe_subscription_id: 'sub_lark_drift_001' },
                vary: {
                  customer_id: { type: 'anchor_field', anchor: 'larkspur_drift', key: 'id' },
                },
              },
            ],
          },
        },
        apiEntityArchetypes: {
          stripe: {
            customer: {
              count: 2,
              archetypes: [
                { label: 'lark', weight: 0.5, fields: { object: 'customer', name: 'Larkspur Inc' }, vary: { id: { type: 'sequence', prefix: 'cus_p1_' } } },
                { label: 'others', weight: 0.5, fields: { object: 'customer' }, vary: { id: { type: 'sequence', prefix: 'cus_p1_' }, name: { type: 'companyName' } } },
              ],
            },
            subscription: {
              count: 0,
              archetypes: [
                {
                  // API-side drift: same hardcoded id, but status=canceled.
                  // Mirror sees this id is already DB-claimed and skips →
                  // DB keeps its active row.
                  label: 'larkspur-drift-canceled',
                  weight: 0,
                  count: 1,
                  anchor: 'larkspur_drift',
                  fields: { object: 'subscription', id: 'sub_lark_drift_001', status: 'canceled' },
                  vary: {
                    customer: { type: 'anchor_field', anchor: 'larkspur_drift', key: 'stripe_customer_id' },
                    canceled_at: { type: 'anchor_date', anchor: 'larkspur_drift', key: 'event', format: 'epoch_seconds' },
                  },
                },
              ],
            },
          },
        },
      },
    };

    const expander = new BlueprintExpander(42);
    const expanded = expander.expand(blueprint, SCHEMA, '12 weeks', undefined, SCHEMA_MAPPING);

    const dbSubs = expanded.tables.subscriptions ?? [];
    const lark = expanded.tables.customers?.find((c) => c.name === 'Larkspur Inc');
    expect(lark).toBeDefined();

    const larkSubs = dbSubs.filter((s) => s.customer_id === lark!.id);
    expect(larkSubs.length).toBe(1);
    const larkSub = larkSubs[0]!;
    expect(larkSub.status).toBe('active');
    expect(larkSub.plan).toBe('pro');
    expect(larkSub.amount_cents).toBe(9900);
    expect(larkSub.stripe_subscription_id).toBe('sub_lark_drift_001');

    const apiSubs = expanded.apiResponses.stripe?.responses.subscription ?? [];
    const apiLark = apiSubs.map((r) => r.body as Record<string, unknown>)
      .find((b) => b.id === 'sub_lark_drift_001');
    expect(apiLark).toBeDefined();
    expect(apiLark!.status).toBe('canceled');
  });

  it('honors explicit count on plain archetypes and distributes the remainder by weight', () => {
    // RULE F2 / EXPLICIT COUNTS: per-reason archetypes with `count: 4`/`2`/`2`
    // must emit exactly that many rows, regardless of weight. Weight-only
    // archetypes share the remaining budget.
    const SCHEMA: SchemaModel = {
      enums: [],
      insertionOrder: ['payments'],
      tables: [
        {
          name: 'payments',
          primaryKey: ['id'],
          foreignKeys: [],
          uniqueConstraints: [],
          checkConstraints: [],
          columns: [
            { name: 'id', type: 'integer', pgType: 'serial', isNullable: false, hasDefault: true, isAutoIncrement: true, isGenerated: false },
            { name: 'amount_cents', type: 'integer', pgType: 'integer', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'status', type: 'text', pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
            { name: 'failure_reason', type: 'text', pgType: 'text', isNullable: true, hasDefault: false, isAutoIncrement: false, isGenerated: false },
          ],
        },
      ],
    };

    const blueprint: Blueprint = {
      version: '1.0',
      personaId: 'explicit-count',
      domain: 'billing',
      generatedAt: '2026-05-08T00:00:00Z',
      generatedBy: 'test',
      checksum: 'test',
      persona: { name: 'test', age: 30, occupation: 'tester', location: 'nowhere', description: 'test persona' },
      data: {
        entities: {},
        patterns: [],
        entityArchetypes: {
          payments: {
            count: 100,
            archetypes: [
              { label: 'succeeded', weight: 1.0, fields: { amount_cents: 9900, status: 'succeeded' }, vary: {} },
              { label: 'failed-expired-card', weight: 0, count: 4, fields: { amount_cents: 2900, status: 'failed', failure_reason: 'card_expired' }, vary: {} },
              { label: 'failed-insufficient-funds', weight: 0, count: 2, fields: { amount_cents: 9900, status: 'failed', failure_reason: 'insufficient_funds' }, vary: {} },
              { label: 'failed-lost-card', weight: 0, count: 2, fields: { amount_cents: 9900, status: 'failed', failure_reason: 'lost_card' }, vary: {} },
            ],
          },
        },
      },
    };

    const expander = new BlueprintExpander(42);
    const expanded = expander.expand(blueprint, SCHEMA, '12 weeks');
    const rows = expanded.tables.payments ?? [];

    const byReason: Record<string, number> = {};
    let succeeded = 0;
    for (const r of rows) {
      if (r.status === 'failed') {
        const reason = (r.failure_reason as string) ?? 'null';
        byReason[reason] = (byReason[reason] ?? 0) + 1;
      } else if (r.status === 'succeeded') {
        succeeded++;
      }
    }

    expect(byReason.card_expired).toBe(4);
    expect(byReason.insufficient_funds).toBe(2);
    expect(byReason.lost_card).toBe(2);
    // 100 - (4+2+2) = 92 weighted-only rows for the 'succeeded' archetype.
    expect(succeeded).toBe(92);
    expect(rows.length).toBe(100);
  });

  it('anchors created_at ≤ sibling timestamps on the same row', () => {
    const SCHEMA_WITH_SIBLING: SchemaModel = {
      enums: [],
      insertionOrder: ['subscriptions'],
      tables: [
        {
          name: 'subscriptions',
          primaryKey: ['id'],
          foreignKeys: [],
          uniqueConstraints: [],
          checkConstraints: [],
          columns: [
            { name: 'id', type: 'integer', pgType: 'serial', isNullable: false, hasDefault: true, isAutoIncrement: true, isGenerated: false },
            { name: 'created_at', type: 'timestamptz', pgType: 'timestamptz', isNullable: false, hasDefault: true, defaultValue: 'now()', isAutoIncrement: false, isGenerated: false },
            { name: 'current_period_start', type: 'timestamptz', pgType: 'timestamptz', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
          ],
        },
      ],
    };

    const PERIOD_START = '2026-04-15T00:00:00.000Z';
    const blueprint: Blueprint = {
      version: '1.0',
      personaId: 'test',
      domain: 'test',
      generatedAt: '2026-05-07T00:00:00Z',
      generatedBy: 'test',
      checksum: 'test',
      persona: { name: 'test', age: 30, occupation: 'tester', location: 'nowhere', description: 'test persona' },
      data: {
        entities: {
          subscriptions: Array.from({ length: 20 }, (_, i) => ({
            id: i + 1,
            current_period_start: PERIOD_START,
          })),
        },
        patterns: [],
      },
    };

    const expander = new BlueprintExpander(42);
    const expanded = expander.expand(blueprint, SCHEMA_WITH_SIBLING, '12 weeks');
    const rows = expanded.tables.subscriptions ?? [];

    const periodStartMs = Date.parse(PERIOD_START);
    for (const row of rows) {
      const createdMs = Date.parse(row.created_at as string);
      expect(createdMs).toBeLessThanOrEqual(periodStartMs);
    }
  });
});
