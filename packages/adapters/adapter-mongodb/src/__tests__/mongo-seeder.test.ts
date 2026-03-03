import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MongoSeeder } from '../mongo-seeder.js';
import type { ExpandedData, AdapterContext, MimicConfig } from '@mimicai/core';

// ---------------------------------------------------------------------------
// Mock mongodb driver
// ---------------------------------------------------------------------------

const mockInsertMany = vi.fn().mockResolvedValue({});
const mockUpdateOne = vi.fn().mockResolvedValue({});
const mockDeleteMany = vi.fn().mockResolvedValue({});
const mockDrop = vi.fn().mockResolvedValue(undefined);
const mockCountDocuments = vi.fn().mockResolvedValue(0);
const mockEstimatedDocumentCount = vi.fn().mockResolvedValue(0);
const mockAggregate = vi.fn().mockReturnValue({ toArray: () => Promise.resolve([]) });
const mockIndexes = vi.fn().mockResolvedValue([]);
const mockCreateIndex = vi.fn().mockResolvedValue('index_name');

const mockCollection = vi.fn().mockReturnValue({
  insertMany: mockInsertMany,
  updateOne: mockUpdateOne,
  deleteMany: mockDeleteMany,
  drop: mockDrop,
  countDocuments: mockCountDocuments,
  estimatedDocumentCount: mockEstimatedDocumentCount,
  aggregate: mockAggregate,
  indexes: mockIndexes,
  createIndex: mockCreateIndex,
});

const mockListCollections = vi.fn().mockReturnValue({
  toArray: () =>
    Promise.resolve([
      { name: 'users', type: 'collection' },
      { name: 'orders', type: 'collection' },
    ]),
});

const mockCommand = vi.fn().mockResolvedValue({ ok: 1 });

const mockDb = vi.fn().mockReturnValue({
  collection: mockCollection,
  listCollections: mockListCollections,
  command: mockCommand,
});

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockClose = vi.fn().mockResolvedValue(undefined);

vi.mock('mongodb', () => ({
  default: {
    MongoClient: vi.fn().mockImplementation(() => ({
      connect: mockConnect,
      db: mockDb,
      close: mockClose,
    })),
  },
  MongoClient: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    db: mockDb,
    close: mockClose,
  })),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeExpandedData(personaId: string): ExpandedData {
  return {
    personaId,
    blueprint: {} as ExpandedData['blueprint'],
    tables: {
      users: [
        { id: 1, name: 'Alice', email: 'alice@test.com' },
        { id: 2, name: 'Bob', email: 'bob@test.com' },
      ],
    },
    documents: {
      orders: [
        { _id: 'ord_1', userId: 1, total: 99.99, status: 'completed' },
        { _id: 'ord_2', userId: 2, total: 149.00, status: 'pending' },
      ],
    },
    apiResponses: {},
    files: [],
    events: [],
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

describe('MongoSeeder', () => {
  let seeder: MongoSeeder;

  beforeEach(() => {
    vi.clearAllMocks();
    seeder = new MongoSeeder();
    mockInsertMany.mockResolvedValue({});
    mockDeleteMany.mockResolvedValue({});
    mockDrop.mockResolvedValue(undefined);
  });

  describe('init()', () => {
    it('should initialize with default config', async () => {
      await seeder.init(
        { url: 'mongodb://localhost:27017/test' },
        makeContext(),
      );
      expect(seeder.id).toBe('mongodb');
      expect(seeder.name).toBe('MongoDB');
      expect(seeder.type).toBe('database');
    });

    it('should accept custom database name', async () => {
      await seeder.init(
        { url: 'mongodb://localhost:27017', database: 'mydb' },
        makeContext(),
      );
    });

    it('should accept seed strategy', async () => {
      await seeder.init(
        { url: 'mongodb://localhost:27017/test', seedStrategy: 'drop-and-insert' },
        makeContext(),
      );
    });
  });

  describe('healthcheck()', () => {
    it('should return true when ping succeeds', async () => {
      await seeder.init({ url: 'mongodb://localhost:27017/test' }, makeContext());
      const healthy = await seeder.healthcheck();
      expect(healthy).toBe(true);
      expect(mockCommand).toHaveBeenCalledWith({ ping: 1 });
    });

    it('should return false when ping fails', async () => {
      mockCommand.mockRejectedValueOnce(new Error('Connection refused'));
      await seeder.init({ url: 'mongodb://localhost:27017/test' }, makeContext());
      // Force fresh connection
      await seeder.disconnect();
      mockConnect.mockRejectedValueOnce(new Error('Connection refused'));
      const healthy = await seeder.healthcheck();
      expect(healthy).toBe(false);
    });
  });

  describe('seedBatch()', () => {
    it('should seed documents and tables with delete-and-insert strategy', async () => {
      await seeder.init(
        { url: 'mongodb://localhost:27017/test', seedStrategy: 'delete-and-insert' },
        makeContext(),
      );

      const dataMap = new Map([['test-persona', makeExpandedData('test-persona')]]);
      await seeder.seedBatch(dataMap);

      expect(mockDeleteMany).toHaveBeenCalledWith({});
      expect(mockInsertMany).toHaveBeenCalled();
    });

    it('should use drop-and-insert strategy when configured', async () => {
      await seeder.init(
        { url: 'mongodb://localhost:27017/test', seedStrategy: 'drop-and-insert' },
        makeContext(),
      );

      const dataMap = new Map([['test', makeExpandedData('test')]]);
      await seeder.seedBatch(dataMap);

      expect(mockDrop).toHaveBeenCalled();
      expect(mockInsertMany).toHaveBeenCalled();
    });

    it('should use append strategy (no delete/drop)', async () => {
      await seeder.init(
        { url: 'mongodb://localhost:27017/test', seedStrategy: 'append' },
        makeContext(),
      );

      const dataMap = new Map([['test', makeExpandedData('test')]]);
      await seeder.seedBatch(dataMap);

      expect(mockDeleteMany).not.toHaveBeenCalled();
      expect(mockDrop).not.toHaveBeenCalled();
      expect(mockInsertMany).toHaveBeenCalled();
    });

    it('should use upsert strategy', async () => {
      await seeder.init(
        { url: 'mongodb://localhost:27017/test', seedStrategy: 'upsert' },
        makeContext(),
      );

      const dataMap = new Map([['test', makeExpandedData('test')]]);
      await seeder.seedBatch(dataMap);

      expect(mockUpdateOne).toHaveBeenCalled();
    });

    it('should merge multiple personas', async () => {
      await seeder.init(
        { url: 'mongodb://localhost:27017/test', seedStrategy: 'delete-and-insert' },
        makeContext(),
      );

      const dataMap = new Map([
        ['persona-a', makeExpandedData('persona-a')],
        ['persona-b', makeExpandedData('persona-b')],
      ]);
      await seeder.seedBatch(dataMap);

      // Should have inserted docs from both personas
      expect(mockInsertMany).toHaveBeenCalled();
    });

    it('should filter collections when configured', async () => {
      await seeder.init(
        { url: 'mongodb://localhost:27017/test', collections: ['orders'] },
        makeContext(),
      );

      const dataMap = new Map([['test', makeExpandedData('test')]]);
      await seeder.seedBatch(dataMap);

      // Should only seed "orders", not "users"
      const collectionCalls = mockCollection.mock.calls.map((c: unknown[]) => c[0]);
      expect(collectionCalls).toContain('orders');
      expect(collectionCalls).not.toContain('users');
    });

    it('should create auto-indexes when enabled', async () => {
      await seeder.init(
        { url: 'mongodb://localhost:27017/test', autoCreateIndexes: true },
        makeContext(),
      );

      const dataMap = new Map([['test', makeExpandedData('test')]]);
      await seeder.seedBatch(dataMap);

      // Should have attempted to create indexes on userId field in orders
      expect(mockCreateIndex).toHaveBeenCalled();
    });

    it('should handle empty documents gracefully', async () => {
      await seeder.init(
        { url: 'mongodb://localhost:27017/test' },
        makeContext(),
      );

      const emptyData: ExpandedData = {
        personaId: 'test',
        blueprint: {} as ExpandedData['blueprint'],
        tables: {},
        documents: {},
        apiResponses: {},
        files: [],
        events: [],
      };

      await seeder.seedBatch(new Map([['test', emptyData]]));
      expect(mockInsertMany).not.toHaveBeenCalled();
    });
  });

  describe('clean()', () => {
    it('should delete all documents from all collections', async () => {
      await seeder.init(
        { url: 'mongodb://localhost:27017/test' },
        makeContext(),
      );

      await seeder.clean(makeContext());

      // Should have called deleteMany({}) for each collection
      expect(mockDeleteMany).toHaveBeenCalledWith({});
    });

    it('should filter collections when configured', async () => {
      await seeder.init(
        { url: 'mongodb://localhost:27017/test', collections: ['orders'] },
        makeContext(),
      );

      await seeder.clean(makeContext());

      // Should only clean the "orders" collection
      const collectionCalls = mockCollection.mock.calls.map((c: unknown[]) => c[0]);
      const relevantCalls = collectionCalls.filter((c: unknown) => c === 'orders' || c === 'users');
      expect(relevantCalls).toContain('orders');
    });
  });

  describe('inspect()', () => {
    it('should return document counts per collection', async () => {
      mockCountDocuments.mockResolvedValueOnce(42).mockResolvedValueOnce(17);

      await seeder.init(
        { url: 'mongodb://localhost:27017/test' },
        makeContext(),
      );

      const result = await seeder.inspect(makeContext());

      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.totalRows).toBe(59);
      expect(Object.keys(result.tables)).toHaveLength(2);
    });
  });

  describe('dispose()', () => {
    it('should close the client', async () => {
      await seeder.init(
        { url: 'mongodb://localhost:27017/test' },
        makeContext(),
      );
      // Force connection
      await seeder.healthcheck();
      await seeder.dispose();
      expect(mockClose).toHaveBeenCalled();
    });
  });
});
