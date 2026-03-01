import { describe, it, expect } from 'vitest';
import { topologicalSort } from '../../schema/topo-sort.js';
import type { TableInfo } from '../../types/schema.js';

function makeTable(name: string, fks: Array<{ col: string; ref: string; refCol: string }> = []): TableInfo {
  return {
    name,
    columns: [],
    primaryKey: ['id'],
    foreignKeys: fks.map((fk) => ({
      columns: [fk.col],
      referencedTable: fk.ref,
      referencedColumns: [fk.refCol],
    })),
    uniqueConstraints: [],
    checkConstraints: [],
  };
}

describe('topologicalSort', () => {
  it('should sort independent tables in stable order', () => {
    const tables = [makeTable('users'), makeTable('products'), makeTable('settings')];
    const result = topologicalSort(tables);
    expect(result).toHaveLength(3);
    expect(result).toContain('users');
    expect(result).toContain('products');
    expect(result).toContain('settings');
  });

  it('should sort dependent tables after their dependencies', () => {
    const tables = [
      makeTable('orders', [{ col: 'user_id', ref: 'users', refCol: 'id' }]),
      makeTable('users'),
    ];
    const result = topologicalSort(tables);
    expect(result.indexOf('users')).toBeLessThan(result.indexOf('orders'));
  });

  it('should handle diamond dependencies', () => {
    const tables = [
      makeTable('users'),
      makeTable('products'),
      makeTable('orders', [
        { col: 'user_id', ref: 'users', refCol: 'id' },
        { col: 'product_id', ref: 'products', refCol: 'id' },
      ]),
      makeTable('order_items', [
        { col: 'order_id', ref: 'orders', refCol: 'id' },
      ]),
    ];
    const result = topologicalSort(tables);
    expect(result.indexOf('users')).toBeLessThan(result.indexOf('orders'));
    expect(result.indexOf('products')).toBeLessThan(result.indexOf('orders'));
    expect(result.indexOf('orders')).toBeLessThan(result.indexOf('order_items'));
  });

  it('should skip self-referencing foreign keys', () => {
    const tables = [
      makeTable('categories', [{ col: 'parent_id', ref: 'categories', refCol: 'id' }]),
    ];
    const result = topologicalSort(tables);
    expect(result).toEqual(['categories']);
  });

  it('should handle circular dependencies by appending cyclic tables', () => {
    const tables = [
      makeTable('a', [{ col: 'b_id', ref: 'b', refCol: 'id' }]),
      makeTable('b', [{ col: 'a_id', ref: 'a', refCol: 'id' }]),
    ];
    const result = topologicalSort(tables);
    expect(result).toHaveLength(2);
    expect(result).toContain('a');
    expect(result).toContain('b');
  });

  it('should handle a chain of 3 tables', () => {
    const tables = [
      makeTable('c', [{ col: 'b_id', ref: 'b', refCol: 'id' }]),
      makeTable('a'),
      makeTable('b', [{ col: 'a_id', ref: 'a', refCol: 'id' }]),
    ];
    const result = topologicalSort(tables);
    expect(result.indexOf('a')).toBeLessThan(result.indexOf('b'));
    expect(result.indexOf('b')).toBeLessThan(result.indexOf('c'));
  });

  it('should handle empty input', () => {
    expect(topologicalSort([])).toEqual([]);
  });
});
