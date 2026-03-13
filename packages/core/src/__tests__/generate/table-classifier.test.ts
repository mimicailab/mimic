import { describe, it, expect } from 'vitest';
import { classifyTables } from '../../generate/table-classifier.js';
import type { SchemaModel, SchemaMapping } from '../../types/index.js';

function makeSchema(tables: { name: string; columns: { name: string; type?: string; isNullable?: boolean }[]; foreignKeys?: { columns: string[]; referencedTable: string; referencedColumns: string[] }[] }[]): SchemaModel {
  return {
    tables: tables.map(t => ({
      name: t.name,
      columns: t.columns.map(c => ({
        name: c.name,
        type: c.type ?? 'text',
        pgType: c.type ?? 'text',
        isNullable: c.isNullable ?? true,
        hasDefault: false,
        isAutoIncrement: false,
        isGenerated: false,
      })),
      primaryKey: ['id'],
      foreignKeys: (t.foreignKeys ?? []).map(fk => ({
        ...fk,
        constraintName: `fk_${t.name}`,
      })),
      uniqueConstraints: [],
    })),
    enums: [],
    insertionOrder: tables.map(t => t.name),
  } as unknown as SchemaModel;
}

describe('classifyTables', () => {
  it('should classify a table with many incoming FKs and platform columns as identity', () => {
    const schema = makeSchema([
      {
        name: 'customers',
        columns: [
          { name: 'id' },
          { name: 'name' },
          { name: 'billing_platform' },
          { name: 'external_id' },
        ],
      },
      {
        name: 'subscriptions',
        columns: [{ name: 'id' }, { name: 'customer_id' }],
        foreignKeys: [{ columns: ['customer_id'], referencedTable: 'customers', referencedColumns: ['id'] }],
      },
      {
        name: 'invoices',
        columns: [{ name: 'id' }, { name: 'customer_id' }],
        foreignKeys: [{ columns: ['customer_id'], referencedTable: 'customers', referencedColumns: ['id'] }],
      },
    ]);

    const result = classifyTables({
      schema,
      adapterIds: ['stripe'],
    });

    const customerClass = result.find(c => c.table === 'customers');
    expect(customerClass?.role).toBe('identity');
  });

  it('should classify known identity table names (customers, users) as identity', () => {
    const schema = makeSchema([
      { name: 'users', columns: [{ name: 'id' }, { name: 'email' }] },
    ]);

    const result = classifyTables({ schema, adapterIds: ['stripe'] });
    expect(result.find(c => c.table === 'users')?.role).toBe('identity');
  });

  it('should classify bridge tables from schema mapping as external-mirrored', () => {
    const schema = makeSchema([
      {
        name: 'customers',
        columns: [{ name: 'id' }, { name: 'billing_platform' }, { name: 'external_id' }],
      },
      {
        name: 'payments',
        columns: [{ name: 'id' }, { name: 'billing_platform' }, { name: 'external_id' }, { name: 'amount' }],
      },
    ]);

    const schemaMapping: SchemaMapping = {
      mappings: [
        { dbTable: 'payments', dbColumn: 'external_id', adapterId: 'stripe', apiResource: 'charges', apiField: 'id', isBridgeTable: true },
      ],
      bridgeTables: ['payments'],
    };

    const result = classifyTables({
      schema,
      schemaMapping,
      adapterIds: ['stripe'],
    });

    const paymentsClass = result.find(c => c.table === 'payments');
    expect(paymentsClass?.role).toBe('external-mirrored');
    expect(paymentsClass?.sources).toBeDefined();
    expect(paymentsClass!.sources!.length).toBeGreaterThan(0);
    expect(paymentsClass!.sources![0]!.adapter).toBe('stripe');
  });

  it('should classify tables with no FKs and no platform columns as internal-only', () => {
    const schema = makeSchema([
      { name: 'settings', columns: [{ name: 'key' }, { name: 'value' }] },
    ]);

    const result = classifyTables({ schema, adapterIds: ['stripe'] });
    expect(result.find(c => c.table === 'settings')?.role).toBe('internal-only');
  });

  it('should apply explicit overrides from modeling config', () => {
    const schema = makeSchema([
      { name: 'orders', columns: [{ name: 'id' }, { name: 'status' }] },
    ]);

    const result = classifyTables({
      schema,
      adapterIds: ['stripe'],
      modelingOverrides: {
        orders: { role: 'external-mirrored', sources: [{ adapter: 'stripe', resource: 'charges' }] },
      },
    });

    expect(result.find(c => c.table === 'orders')?.role).toBe('external-mirrored');
  });

  it('should throw on modeling override referencing non-existent table', () => {
    const schema = makeSchema([
      { name: 'orders', columns: [{ name: 'id' }] },
    ]);

    expect(() => classifyTables({
      schema,
      adapterIds: ['stripe'],
      modelingOverrides: {
        nonexistent: { role: 'identity' },
      },
    })).toThrow(/nonexistent/);
  });

  it('should return empty for empty schema', () => {
    const schema = makeSchema([]);
    const result = classifyTables({ schema, adapterIds: ['stripe'] });
    expect(result).toEqual([]);
  });

  it('should classify every table in schema', () => {
    const schema = makeSchema([
      { name: 'users', columns: [{ name: 'id' }] },
      { name: 'orders', columns: [{ name: 'id' }] },
      { name: 'settings', columns: [{ name: 'id' }] },
    ]);

    const result = classifyTables({ schema, adapterIds: [] });
    expect(result.length).toBe(3);
  });
});
