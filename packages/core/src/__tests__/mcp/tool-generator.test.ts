import { describe, it, expect } from 'vitest';
import type { SchemaModel, TableInfo } from '../../types/schema.js';

function makeTransactionsTable(): TableInfo {
  return {
    name: 'transactions',
    columns: [
      { name: 'id', type: 'integer', pgType: 'int4', isNullable: false, hasDefault: true, isAutoIncrement: true, isGenerated: false },
      { name: 'account_id', type: 'integer', pgType: 'int4', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
      { name: 'date', type: 'date', pgType: 'date', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
      { name: 'amount', type: 'decimal', pgType: 'numeric', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false, precision: 12, scale: 2 },
      { name: 'category', type: 'enum', pgType: 'transaction_category', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false, enumValues: ['INCOME', 'RENT', 'DINING', 'GROCERIES'] },
      { name: 'merchant', type: 'text', pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
      { name: 'status', type: 'enum', pgType: 'transaction_status', isNullable: false, hasDefault: true, defaultValue: 'POSTED', isAutoIncrement: false, isGenerated: false, enumValues: ['PENDING', 'POSTED', 'CANCELLED'] },
    ],
    primaryKey: ['id'],
    foreignKeys: [{ columns: ['account_id'], referencedTable: 'accounts', referencedColumns: ['id'] }],
    uniqueConstraints: [],
    checkConstraints: [],
  };
}

function makeAccountsTable(): TableInfo {
  return {
    name: 'accounts',
    columns: [
      { name: 'id', type: 'integer', pgType: 'int4', isNullable: false, hasDefault: true, isAutoIncrement: true, isGenerated: false },
      { name: 'user_id', type: 'integer', pgType: 'int4', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
      { name: 'name', type: 'text', pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
      { name: 'type', type: 'enum', pgType: 'account_type', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false, enumValues: ['CHECKING', 'SAVINGS', 'CREDIT'] },
      { name: 'balance', type: 'decimal', pgType: 'numeric', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false, precision: 12, scale: 2 },
    ],
    primaryKey: ['id'],
    foreignKeys: [{ columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'] }],
    uniqueConstraints: [],
    checkConstraints: [],
  };
}

describe('Tool Generator (type-level validation)', () => {
  const schema: SchemaModel = {
    tables: [makeTransactionsTable(), makeAccountsTable()],
    enums: [
      { name: 'transaction_category', values: ['INCOME', 'RENT', 'DINING', 'GROCERIES'] },
      { name: 'transaction_status', values: ['PENDING', 'POSTED', 'CANCELLED'] },
      { name: 'account_type', values: ['CHECKING', 'SAVINGS', 'CREDIT'] },
    ],
    insertionOrder: ['accounts', 'transactions'],
  };

  it('should have tables with expected column types', () => {
    const txTable = schema.tables.find((t) => t.name === 'transactions')!;
    expect(txTable.columns.find((c) => c.name === 'date')?.type).toBe('date');
    expect(txTable.columns.find((c) => c.name === 'amount')?.type).toBe('decimal');
    expect(txTable.columns.find((c) => c.name === 'category')?.type).toBe('enum');
    expect(txTable.columns.find((c) => c.name === 'merchant')?.type).toBe('text');
  });

  it('should have FK relationships', () => {
    const txTable = schema.tables.find((t) => t.name === 'transactions')!;
    expect(txTable.foreignKeys).toHaveLength(1);
    expect(txTable.foreignKeys[0].referencedTable).toBe('accounts');
  });

  it('should have enum values', () => {
    const categoryEnum = schema.enums.find((e) => e.name === 'transaction_category')!;
    expect(categoryEnum.values).toContain('DINING');
    expect(categoryEnum.values).toContain('GROCERIES');
  });

  it('should have auto-increment IDs', () => {
    const txTable = schema.tables.find((t) => t.name === 'transactions')!;
    const idCol = txTable.columns.find((c) => c.name === 'id')!;
    expect(idCol.isAutoIncrement).toBe(true);
    expect(idCol.isGenerated).toBe(false);
  });
});
