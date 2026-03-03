import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SQLiteSeeder } from '../sqlite-seeder.js';
import type { BetterSQLite3Database } from '../sqlite-seeder.js';
import type { SchemaModel, ExpandedData, AdapterContext, MimicConfig } from '@mimicai/core';

// ---------------------------------------------------------------------------
// In-memory SQLite mock
// ---------------------------------------------------------------------------

function createMockDb(): BetterSQLite3Database {
  const tables = new Map<string, Array<Record<string, unknown>>>();
  const stmtStore = new Map<string, string>();

  const db: BetterSQLite3Database = {
    prepare(sql: string) {
      return {
        run(...params: unknown[]) {
          // Handle DELETE FROM
          const deleteMatch = sql.match(/^DELETE FROM "(\w+)"$/);
          if (deleteMatch) {
            tables.set(deleteMatch[1]!, []);
            return { changes: 0, lastInsertRowid: 0 };
          }

          // Handle INSERT INTO
          const insertMatch = sql.match(/^INSERT INTO "(\w+)"/);
          if (insertMatch) {
            const tableName = insertMatch[1]!;
            if (!tables.has(tableName)) tables.set(tableName, []);
            tables.get(tableName)!.push({ _params: params });
            return { changes: 1, lastInsertRowid: tables.get(tableName)!.length };
          }

          return { changes: 0, lastInsertRowid: 0 };
        },
        get(..._params: unknown[]) {
          // Handle COUNT(*)
          const countMatch = sql.match(/SELECT COUNT\(\*\) as cnt FROM "(\w+)"/);
          if (countMatch) {
            return { cnt: tables.get(countMatch[1]!)?.length ?? 0 };
          }
          return undefined;
        },
        all(..._params: unknown[]) {
          // Handle table list
          if (sql.includes('sqlite_master')) {
            return [...tables.keys()].map((name) => ({ name }));
          }
          return [];
        },
      };
    },
    pragma(pragmaStr: string) {
      if (pragmaStr === 'foreign_keys = OFF' || pragmaStr === 'foreign_keys = ON') {
        return undefined;
      }
      if (pragmaStr === 'journal_mode = WAL') {
        return undefined;
      }
      if (pragmaStr === 'integrity_check') {
        return [{ integrity_check: 'ok' }];
      }
      if (pragmaStr.startsWith('table_info')) {
        const match = pragmaStr.match(/table_info\("(\w+)"\)/);
        if (match) {
          const tableName = match[1]!;
          if (tableName === 'users') {
            return [
              { cid: 0, name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 },
              { cid: 1, name: 'name', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
              { cid: 2, name: 'email', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
            ];
          }
          if (tableName === 'posts') {
            return [
              { cid: 0, name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 },
              { cid: 1, name: 'user_id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
              { cid: 2, name: 'title', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
            ];
          }
        }
        return [];
      }
      if (pragmaStr.startsWith('foreign_key_list')) {
        const match = pragmaStr.match(/foreign_key_list\("(\w+)"\)/);
        if (match?.[1] === 'posts') {
          return [{ id: 0, seq: 0, table: 'users', from: 'user_id', to: 'id', on_update: 'NO ACTION', on_delete: 'CASCADE', match: 'NONE' }];
        }
        return [];
      }
      if (pragmaStr.startsWith('index_list')) {
        return [];
      }
      return [];
    },
    transaction<T>(fn: () => T) {
      return () => fn();
    },
    close() {},
    exec(_sql: string) {},
  };

  // Pre-populate table names for the mock
  tables.set('users', []);
  tables.set('posts', []);

  return db;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSchema(): SchemaModel {
  return {
    tables: [
      {
        name: 'users',
        columns: [
          { name: 'id', type: 'integer', pgType: 'INTEGER', isNullable: false, hasDefault: false, isAutoIncrement: true, isGenerated: false },
          { name: 'name', type: 'text', pgType: 'TEXT', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
          { name: 'email', type: 'text', pgType: 'TEXT', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
        ],
        primaryKey: ['id'],
        foreignKeys: [],
        uniqueConstraints: [],
        checkConstraints: [],
      },
      {
        name: 'posts',
        columns: [
          { name: 'id', type: 'integer', pgType: 'INTEGER', isNullable: false, hasDefault: false, isAutoIncrement: true, isGenerated: false },
          { name: 'user_id', type: 'integer', pgType: 'INTEGER', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
          { name: 'title', type: 'text', pgType: 'TEXT', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
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
        { id: 1, user_id: 1, title: 'Hello World' },
        { id: 2, user_id: 2, title: 'Second Post' },
      ],
    },
    documents: {},
    apiResponses: {},
    files: [],
    events: [],
  };
}

function makeContext(schema?: SchemaModel): AdapterContext {
  return {
    config: {
      domain: 'test',
      personas: [{ name: 'test', description: 'test' }],
    } as MimicConfig,
    blueprints: new Map(),
    logger: {},
    schema,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SQLiteSeeder', () => {
  let seeder: SQLiteSeeder;
  let mockDb: BetterSQLite3Database;

  beforeEach(() => {
    seeder = new SQLiteSeeder();
    mockDb = createMockDb();
  });

  describe('init()', () => {
    it('should initialize with config', async () => {
      await seeder.init({ path: ':memory:' }, makeContext());
      expect(seeder.id).toBe('sqlite');
      expect(seeder.name).toBe('SQLite');
      expect(seeder.type).toBe('database');
    });
  });

  describe('healthcheck()', () => {
    it('should return true for healthy database', async () => {
      await seeder.init({ path: ':memory:' }, makeContext());
      seeder.setDb(mockDb);
      const healthy = await seeder.healthcheck();
      expect(healthy).toBe(true);
    });
  });

  describe('seedBatch()', () => {
    it('should seed data into tables via transaction', async () => {
      await seeder.init({ path: ':memory:' }, makeContext());
      seeder.setDb(mockDb);

      const schema = makeSchema();
      const dataMap = new Map([['test-persona', makeExpandedData('test-persona')]]);

      // Should not throw
      await seeder.seedBatch(schema, dataMap, { strategy: 'truncate-and-insert' });
    });

    it('should skip tables with no rows', async () => {
      await seeder.init({ path: ':memory:' }, makeContext());
      seeder.setDb(mockDb);

      const schema = makeSchema();
      const emptyData: ExpandedData = {
        ...makeExpandedData('test'),
        tables: { users: [], posts: [] },
      };

      await seeder.seedBatch(schema, new Map([['test', emptyData]]), { strategy: 'truncate-and-insert' });
    });

    it('should handle append strategy (no truncation)', async () => {
      await seeder.init({ path: ':memory:' }, makeContext());
      seeder.setDb(mockDb);

      const schema = makeSchema();
      const dataMap = new Map([['test', makeExpandedData('test')]]);

      await seeder.seedBatch(schema, dataMap, { strategy: 'append' });
    });

    it('should merge multiple personas', async () => {
      await seeder.init({ path: ':memory:' }, makeContext());
      seeder.setDb(mockDb);

      const schema = makeSchema();
      const dataMap = new Map([
        ['persona-a', makeExpandedData('persona-a')],
        ['persona-b', makeExpandedData('persona-b')],
      ]);

      await seeder.seedBatch(schema, dataMap, { strategy: 'truncate-and-insert' });
    });
  });

  describe('clean()', () => {
    it('should delete from all tables', async () => {
      await seeder.init({ path: ':memory:' }, makeContext());
      seeder.setDb(mockDb);

      const schema = makeSchema();
      await seeder.clean(makeContext(schema));
    });
  });

  describe('inspect()', () => {
    it('should return row counts for all tables', async () => {
      await seeder.init({ path: ':memory:' }, makeContext());
      seeder.setDb(mockDb);

      const result = await seeder.inspect(makeContext());
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(typeof result.totalRows).toBe('number');
    });
  });

  describe('dispose()', () => {
    it('should close the database', async () => {
      await seeder.init({ path: ':memory:' }, makeContext());
      seeder.setDb(mockDb);
      await seeder.dispose();
    });
  });

  describe('value serialization', () => {
    it('should handle Date objects', async () => {
      await seeder.init({ path: ':memory:' }, makeContext());
      seeder.setDb(mockDb);

      const schema: SchemaModel = {
        tables: [{
          name: 'events',
          columns: [
            { name: 'id', type: 'integer', pgType: 'INTEGER', isNullable: false, hasDefault: false, isAutoIncrement: true, isGenerated: false },
            { name: 'created_at', type: 'timestamp', pgType: 'DATETIME', isNullable: true, hasDefault: false, isAutoIncrement: false, isGenerated: false },
          ],
          primaryKey: ['id'],
          foreignKeys: [],
          uniqueConstraints: [],
          checkConstraints: [],
        }],
        enums: [],
        insertionOrder: ['events'],
      };

      const data: ExpandedData = {
        personaId: 'test',
        blueprint: {} as ExpandedData['blueprint'],
        tables: {
          events: [{ id: 1, created_at: new Date('2024-01-01T00:00:00Z') }],
        },
        documents: {},
        apiResponses: {},
        files: [],
        events: [],
      };

      await seeder.seedBatch(schema, new Map([['test', data]]), { strategy: 'truncate-and-insert' });
    });

    it('should handle boolean values (convert to 0/1)', async () => {
      await seeder.init({ path: ':memory:' }, makeContext());
      seeder.setDb(mockDb);

      const schema: SchemaModel = {
        tables: [{
          name: 'flags',
          columns: [
            { name: 'id', type: 'integer', pgType: 'INTEGER', isNullable: false, hasDefault: false, isAutoIncrement: true, isGenerated: false },
            { name: 'active', type: 'boolean', pgType: 'BOOLEAN', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
          ],
          primaryKey: ['id'],
          foreignKeys: [],
          uniqueConstraints: [],
          checkConstraints: [],
        }],
        enums: [],
        insertionOrder: ['flags'],
      };

      const data: ExpandedData = {
        personaId: 'test',
        blueprint: {} as ExpandedData['blueprint'],
        tables: {
          flags: [{ id: 1, active: true }, { id: 2, active: false }],
        },
        documents: {},
        apiResponses: {},
        files: [],
        events: [],
      };

      await seeder.seedBatch(schema, new Map([['test', data]]), { strategy: 'truncate-and-insert' });
    });

    it('should handle JSON objects', async () => {
      await seeder.init({ path: ':memory:' }, makeContext());
      seeder.setDb(mockDb);

      const schema: SchemaModel = {
        tables: [{
          name: 'metadata',
          columns: [
            { name: 'id', type: 'integer', pgType: 'INTEGER', isNullable: false, hasDefault: false, isAutoIncrement: true, isGenerated: false },
            { name: 'data', type: 'jsonb', pgType: 'JSON', isNullable: true, hasDefault: false, isAutoIncrement: false, isGenerated: false },
          ],
          primaryKey: ['id'],
          foreignKeys: [],
          uniqueConstraints: [],
          checkConstraints: [],
        }],
        enums: [],
        insertionOrder: ['metadata'],
      };

      const data: ExpandedData = {
        personaId: 'test',
        blueprint: {} as ExpandedData['blueprint'],
        tables: {
          metadata: [{ id: 1, data: { key: 'value', nested: [1, 2, 3] } }],
        },
        documents: {},
        apiResponses: {},
        files: [],
        events: [],
      };

      await seeder.seedBatch(schema, new Map([['test', data]]), { strategy: 'truncate-and-insert' });
    });
  });
});
