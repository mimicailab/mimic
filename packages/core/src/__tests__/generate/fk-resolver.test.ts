import { describe, it, expect } from 'vitest';
import { resolveMirroredFks, FkResolutionError } from '../../generate/fk-resolver.js';
import type { TableClassification, SchemaModel, Row, ApiResponseSet } from '../../types/index.js';

function makeSchema(tables: { name: string; primaryKey?: string[]; columns?: { name: string; type?: string }[] }[]): SchemaModel {
  return {
    tables: tables.map(t => ({
      name: t.name,
      columns: (t.columns ?? [{ name: 'id', type: 'integer' }]).map(c => ({
        name: c.name,
        type: c.type ?? 'integer',
        pgType: c.type ?? 'integer',
        isNullable: true,
        hasDefault: false,
        isAutoIncrement: false,
        isGenerated: false,
      })),
      primaryKey: t.primaryKey ?? ['id'],
      foreignKeys: [],
      uniqueConstraints: [],
    })),
    enums: [],
    insertionOrder: tables.map(t => t.name),
  } as unknown as SchemaModel;
}

describe('resolveMirroredFks', () => {
  it('should resolve FKs from mirrored rows to identity rows', () => {
    const classification: TableClassification = {
      table: 'invoices',
      role: 'external-mirrored',
      identityFks: [{
        column: 'customer_id',
        identityTable: 'customers',
        matchOn: { platformColumn: 'billing_platform', externalIdColumn: 'external_id' },
        apiField: 'customer',
      }],
    };

    const mirroredRows: Row[] = [
      { id: 1, customer: 'cus_p1_001', amount: 2999 },
    ];

    const identityTables: Record<string, Row[]> = {
      customers: [
        { id: 42, external_id: 'cus_p1_001', billing_platform: 'stripe' },
        { id: 43, external_id: 'cus_p1_002', billing_platform: 'stripe' },
      ],
    };

    const schema = makeSchema([
      { name: 'customers', primaryKey: ['id'] },
      { name: 'invoices', primaryKey: ['id'] },
    ]);

    const result = resolveMirroredFks(mirroredRows, classification, 'stripe.invoices', {
      identityTables,
      apiResponses: {},
      classifications: [],
      schema,
    });

    expect(result.errors.length).toBe(0);
    expect(mirroredRows[0]!.customer_id).toBe(42);
  });

  it('should produce FkResolutionError for unresolved references', () => {
    const classification: TableClassification = {
      table: 'invoices',
      role: 'external-mirrored',
      identityFks: [{
        column: 'customer_id',
        identityTable: 'customers',
        matchOn: { platformColumn: 'billing_platform', externalIdColumn: 'external_id' },
        apiField: 'customer',
      }],
    };

    const mirroredRows: Row[] = [
      { id: 1, customer: 'cus_nonexistent', amount: 2999 },
    ];

    const schema = makeSchema([
      { name: 'customers', primaryKey: ['id'] },
      { name: 'invoices', primaryKey: ['id'] },
    ]);

    const result = resolveMirroredFks(mirroredRows, classification, 'stripe.invoices', {
      identityTables: {
        customers: [
          { id: 42, external_id: 'cus_p1_001', billing_platform: 'stripe' },
        ],
      },
      apiResponses: {},
      classifications: [],
      schema,
    });

    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toBeInstanceOf(FkResolutionError);
    expect(result.errors[0]!.table).toBe('invoices');
    expect(result.errors[0]!.column).toBe('customer_id');
  });

  it('should return rows unchanged when no FK rules exist', () => {
    const classification: TableClassification = {
      table: 'settings',
      role: 'external-mirrored',
    };

    const mirroredRows: Row[] = [{ id: 1, key: 'theme', value: 'dark' }];

    const schema = makeSchema([{ name: 'settings' }]);

    const result = resolveMirroredFks(mirroredRows, classification, 'stripe.settings', {
      identityTables: {},
      apiResponses: {},
      classifications: [],
      schema,
    });

    expect(result.errors.length).toBe(0);
    expect(result.rows).toBe(mirroredRows);
  });

  it('should resolve using platform+external_id composite key to prevent cross-platform collisions', () => {
    const classification: TableClassification = {
      table: 'invoices',
      role: 'external-mirrored',
      identityFks: [{
        column: 'customer_id',
        identityTable: 'customers',
        matchOn: { platformColumn: 'billing_platform', externalIdColumn: 'external_id' },
        apiField: 'customer',
      }],
    };

    // Both platforms have external_id 'cus_001' — without platform keying they'd collide
    const identityTables: Record<string, Row[]> = {
      customers: [
        { id: 10, external_id: 'cus_001', billing_platform: 'stripe' },
        { id: 20, external_id: 'cus_001', billing_platform: 'chargebee' },
      ],
    };

    // Stripe invoice should resolve to customer 10 (stripe), not customer 20 (chargebee)
    const stripeRows: Row[] = [
      { id: 1, customer: 'cus_001', billing_platform: 'stripe', amount: 2999 },
    ];

    const schema = makeSchema([
      { name: 'customers', primaryKey: ['id'] },
      { name: 'invoices', primaryKey: ['id'] },
    ]);

    const stripeResult = resolveMirroredFks(stripeRows, classification, 'stripe.invoices', {
      identityTables,
      apiResponses: {},
      classifications: [],
      schema,
    });
    expect(stripeResult.errors.length).toBe(0);
    expect(stripeRows[0]!.customer_id).toBe(10);

    // Chargebee invoice should resolve to customer 20 (chargebee)
    const chargebeeRows: Row[] = [
      { id: 2, customer: 'cus_001', billing_platform: 'chargebee', amount: 4500 },
    ];
    const chargebeeResult = resolveMirroredFks(chargebeeRows, classification, 'chargebee.invoices', {
      identityTables,
      apiResponses: {},
      classifications: [],
      schema,
    });
    expect(chargebeeResult.errors.length).toBe(0);
    expect(chargebeeRows[0]!.customer_id).toBe(20);
  });

  it('should resolve using _apiRef_ fields stored during derivation', () => {
    const classification: TableClassification = {
      table: 'invoices',
      role: 'external-mirrored',
      identityFks: [{
        column: 'customer_id',
        identityTable: 'customers',
        matchOn: { platformColumn: 'billing_platform', externalIdColumn: 'external_id' },
        apiField: 'customer',
      }],
    };

    const mirroredRows: Row[] = [
      { id: 1, _apiRef_customer: 'cus_p1_001', amount: 5000 },
    ];

    const schema = makeSchema([
      { name: 'customers', primaryKey: ['id'] },
      { name: 'invoices', primaryKey: ['id'] },
    ]);

    const result = resolveMirroredFks(mirroredRows, classification, 'stripe.invoices', {
      identityTables: {
        customers: [
          { id: 99, external_id: 'cus_p1_001', billing_platform: 'stripe' },
        ],
      },
      apiResponses: {},
      classifications: [],
      schema,
    });

    expect(result.errors.length).toBe(0);
    expect(mirroredRows[0]!.customer_id).toBe(99);
  });
});
