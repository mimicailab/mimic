import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MySQLSeeder } from '../mysql-seeder.js';
import type { SchemaModel, ExpandedData, AdapterContext, MimicConfig } from '@mimicai/core';

// ---------------------------------------------------------------------------
// Mock mysql2/promise — we test the seeder logic, not the mysql driver
// ---------------------------------------------------------------------------

const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockBeginTransaction = vi.fn();
const mockCommit = vi.fn();
const mockRollback = vi.fn();

const mockConnection = {
  query: mockQuery,
  release: mockRelease,
  beginTransaction: mockBeginTransaction,
  commit: mockCommit,
  rollback: mockRollback,
};

const mockPoolQuery = vi.fn();
const mockGetConnection = vi.fn().mockResolvedValue(mockConnection);
const mockEnd = vi.fn();

vi.mock('mysql2/promise', () => ({
  default: {
    createPool: () => ({
      query: mockPoolQuery,
      getConnection: mockGetConnection,
      end: mockEnd,
    }),
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSchema(): SchemaModel {
  return {
    tables: [
      {
        name: 'users',
        columns: [
          { name: 'id', type: 'integer', pgType: 'int', isNullable: false, hasDefault: false, isAutoIncrement: true, isGenerated: false },
          { name: 'name', type: 'varchar', pgType: 'varchar', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false, maxLength: 255 },
          { name: 'email', type: 'varchar', pgType: 'varchar', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false, maxLength: 255 },
        ],
        primaryKey: ['id'],
        foreignKeys: [],
        uniqueConstraints: [['email']],
        checkConstraints: [],
      },
      {
        name: 'posts',
        columns: [
          { name: 'id', type: 'integer', pgType: 'int', isNullable: false, hasDefault: false, isAutoIncrement: true, isGenerated: false },
          { name: 'user_id', type: 'integer', pgType: 'int', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
          { name: 'title', type: 'varchar', pgType: 'varchar', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
          { name: 'body', type: 'text', pgType: 'text', isNullable: true, hasDefault: false, isAutoIncrement: false, isGenerated: false },
        ],
        primaryKey: ['id'],
        foreignKeys: [
          { columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'] },
        ],
        uniqueConstraints: [],
        checkConstraints: [],
      },
    ],
    enums: [],
    insertionOrder: ['users', 'posts'],
  };
}

function makeExpandedData(personaId: string): ExpandedData {
  return {
    personaId,
    blueprint: {} as ExpandedData['blueprint'],
    tables: {
      users: [
        { id: 1, name: 'Alice', email: 'alice@test.com' },
        { id: 2, name: 'Bob', email: 'bob@test.com' },
      ],
      posts: [
        { id: 1, user_id: 1, title: 'Hello World', body: 'First post!' },
        { id: 2, user_id: 2, title: 'Second Post', body: null },
      ],
    },
    documents: {},
    apiResponses: {},
    files: [],
    events: [],
      facts: [],
  };
}

function makeContext(): AdapterContext {
  return {
    config: {
      domain: 'test',
      personas: [{ name: 'test', description: 'test' }],
    } as MimicConfig,
    blueprints: new Map(),
    logger: {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MySQLSeeder', () => {
  let seeder: MySQLSeeder;

  beforeEach(() => {
    vi.clearAllMocks();
    seeder = new MySQLSeeder();
    mockQuery.mockResolvedValue([[]]);
    mockBeginTransaction.mockResolvedValue(undefined);
    mockCommit.mockResolvedValue(undefined);
    mockRollback.mockResolvedValue(undefined);
  });

  describe('init()', () => {
    it('should initialize with default config', async () => {
      await seeder.init(
        { url: 'mysql://localhost/test' },
        makeContext(),
      );
      expect(seeder.id).toBe('mysql');
      expect(seeder.name).toBe('MySQL');
      expect(seeder.type).toBe('database');
    });
  });

  describe('healthcheck()', () => {
    it('should return true when connected', async () => {
      await seeder.init({ url: 'mysql://localhost/test' }, makeContext());
      mockPoolQuery.mockResolvedValueOnce([[]]);
      const healthy = await seeder.healthcheck();
      expect(healthy).toBe(true);
    });

    it('should return false when connection fails', async () => {
      await seeder.init({ url: 'mysql://invalid' }, makeContext());
      mockPoolQuery.mockRejectedValueOnce(new Error('Connection failed'));
      // Need to also mock getConnection to fail for the initial pool creation
      mockGetConnection.mockRejectedValueOnce(new Error('Connection failed'));
      const healthy = await seeder.healthcheck();
      expect(healthy).toBe(false);
    });
  });

  describe('seedBatch()', () => {
    it('should truncate and insert rows in correct order', async () => {
      await seeder.init({ url: 'mysql://localhost/test' }, makeContext());

      const schema = makeSchema();
      const dataMap = new Map([['test-persona', makeExpandedData('test-persona')]]);

      await seeder.seedBatch(schema, dataMap, { strategy: 'truncate-and-insert' });

      // Should have been called with SET FOREIGN_KEY_CHECKS = 0
      expect(mockQuery.mock.calls[0]?.[0]).toBe('SET FOREIGN_KEY_CHECKS = 0');

      // Should have called beginTransaction
      expect(mockBeginTransaction).toHaveBeenCalled();

      // Should have truncated tables in reverse order
      const truncateCalls = mockQuery.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('TRUNCATE'),
      );
      expect(truncateCalls).toHaveLength(2);
      expect(truncateCalls[0]?.[0]).toContain('posts');
      expect(truncateCalls[1]?.[0]).toContain('users');

      // Should have committed
      expect(mockCommit).toHaveBeenCalled();
    });

    it('should insert rows with correct data', async () => {
      await seeder.init({ url: 'mysql://localhost/test' }, makeContext());

      const schema = makeSchema();
      const dataMap = new Map([['test-persona', makeExpandedData('test-persona')]]);

      await seeder.seedBatch(schema, dataMap, { strategy: 'truncate-and-insert' });

      // Find INSERT calls
      const insertCalls = mockQuery.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO'),
      );
      expect(insertCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('should skip empty tables', async () => {
      await seeder.init({ url: 'mysql://localhost/test' }, makeContext());

      const schema = makeSchema();
      const data: ExpandedData = {
        ...makeExpandedData('test'),
        tables: { users: [], posts: [] },
      };

      await seeder.seedBatch(schema, new Map([['test', data]]), { strategy: 'truncate-and-insert' });

      const insertCalls = mockQuery.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO'),
      );
      expect(insertCalls).toHaveLength(0);
    });

    it('should use ON DUPLICATE KEY UPDATE for upsert strategy', async () => {
      await seeder.init(
        { url: 'mysql://localhost/test', seedStrategy: 'upsert' },
        makeContext(),
      );

      const schema = makeSchema();
      const dataMap = new Map([['test', makeExpandedData('test')]]);

      await seeder.seedBatch(schema, dataMap, { strategy: 'upsert' });

      const upsertCalls = mockQuery.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('ON DUPLICATE KEY UPDATE'),
      );
      expect(upsertCalls.length).toBeGreaterThan(0);
    });

    it('should not truncate with append strategy', async () => {
      await seeder.init({ url: 'mysql://localhost/test' }, makeContext());

      const schema = makeSchema();
      const dataMap = new Map([['test', makeExpandedData('test')]]);

      await seeder.seedBatch(schema, dataMap, { strategy: 'append' });

      const truncateCalls = mockQuery.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('TRUNCATE'),
      );
      expect(truncateCalls).toHaveLength(0);
    });

    it('should rollback on error', async () => {
      await seeder.init({ url: 'mysql://localhost/test' }, makeContext());

      // Make INSERT fail
      let callCount = 0;
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO')) {
          throw new Error('Insert failed');
        }
        callCount++;
        return [[]];
      });

      const schema = makeSchema();
      const dataMap = new Map([['test', makeExpandedData('test')]]);

      await expect(
        seeder.seedBatch(schema, dataMap, { strategy: 'truncate-and-insert' }),
      ).rejects.toThrow('MySQL seeding failed');

      expect(mockRollback).toHaveBeenCalled();
    });
  });

  describe('clean()', () => {
    it('should truncate all tables with FK checks disabled', async () => {
      await seeder.init({ url: 'mysql://localhost/test' }, makeContext());

      const schema = makeSchema();
      await seeder.clean({ ...makeContext(), schema });

      // FK checks disabled
      expect(mockQuery.mock.calls[0]?.[0]).toBe('SET FOREIGN_KEY_CHECKS = 0');

      // Tables truncated
      const truncateCalls = mockQuery.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('TRUNCATE'),
      );
      expect(truncateCalls).toHaveLength(2);

      // FK checks re-enabled
      const fkEnableCalls = mockQuery.mock.calls.filter(
        (call: unknown[]) => call[0] === 'SET FOREIGN_KEY_CHECKS = 1',
      );
      expect(fkEnableCalls).toHaveLength(1);
    });
  });

  describe('dispose()', () => {
    it('should close the pool', async () => {
      await seeder.init({ url: 'mysql://localhost/test' }, makeContext());
      // Force pool creation by calling healthcheck
      mockPoolQuery.mockResolvedValueOnce([[]]);
      await seeder.healthcheck();
      await seeder.dispose();
      expect(mockEnd).toHaveBeenCalled();
    });
  });
});
