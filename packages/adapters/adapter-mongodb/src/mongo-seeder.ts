import type {
  DatabaseAdapter,
  AdapterContext,
  AdapterResult,
  InspectResult,
  CollectionModel,
  CollectionInfo,
  FieldType,
  IndexInfo,
  SchemaModel,
  ColumnType,
  ExpandedData,
  DocumentRecord,
} from '@mimicailab/core';
import { DatabaseConnectionError, SeedingError, logger } from '@mimicailab/core';
const { debug, success } = logger;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MongoConfig {
  url: string;
  database?: string;
  collections?: string[];
  seedStrategy?: 'drop-and-insert' | 'delete-and-insert' | 'append' | 'upsert';
  autoCreateIndexes?: boolean;
  tls?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BATCH_SIZE = 1000;
const SAMPLE_SIZE = 100;
const AUTO_INDEX_FIELDS = ['userId', 'user_id', 'createdAt', 'created_at', 'email', 'updatedAt', 'updated_at'];

// ---------------------------------------------------------------------------
// MongoSeeder -- implements DatabaseAdapter<MongoConfig>
// ---------------------------------------------------------------------------

export class MongoSeeder implements DatabaseAdapter<MongoConfig> {
  readonly id = 'mongodb';
  readonly name = 'MongoDB';
  readonly type = 'database' as const;

  private client: MongoClient | null = null;
  private connectionUrl: string = '';
  private databaseName: string | undefined;
  private seedStrategy: MongoConfig['seedStrategy'] = 'delete-and-insert';
  private autoCreateIndexes: boolean = false;
  private collectionFilter: Set<string> | null = null;

  // -----------------------------------------------------------------------
  // Adapter interface
  // -----------------------------------------------------------------------

  async init(config: MongoConfig, _context: AdapterContext): Promise<void> {
    this.connectionUrl = config.url;
    this.databaseName = config.database;
    this.seedStrategy = config.seedStrategy ?? 'delete-and-insert';
    this.autoCreateIndexes = config.autoCreateIndexes ?? false;
    this.collectionFilter = config.collections ? new Set(config.collections) : null;
  }

  async apply(data: ExpandedData, context: AdapterContext): Promise<AdapterResult> {
    const start = Date.now();
    const stats: Record<string, number> = {};

    const dataMap = new Map<string, ExpandedData>();
    dataMap.set(data.personaId, data);
    await this.seedBatch(dataMap);

    for (const [collName, docs] of Object.entries(data.documents)) {
      stats[`${collName}_docs`] = docs.length;
    }
    for (const [tableName, rows] of Object.entries(data.tables)) {
      stats[`${tableName}_rows`] = rows.length;
    }

    return {
      adapterId: this.id,
      success: true,
      stats,
      duration: Date.now() - start,
    };
  }

  async healthcheck(): Promise<boolean> {
    try {
      const client = await this.getClient();
      const db = this.getDb(client);
      await db.command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async dispose(): Promise<void> {
    await this.disconnect();
  }

  // -----------------------------------------------------------------------
  // DatabaseAdapter: introspect
  // -----------------------------------------------------------------------

  async introspect(config: MongoConfig): Promise<SchemaModel> {
    const mongodb = await this.requireMongoDB();
    const client = new mongodb.MongoClient(config.url);

    try {
      await client.connect();
      const db = config.database ? client.db(config.database) : client.db();
      const collectionModel = await this.introspectCollections(db, config.collections);
      return collectionModelToSchema(collectionModel);
    } finally {
      await client.close();
    }
  }

  private async introspectCollections(
    db: MongoDatabase,
    filterCollections?: string[],
  ): Promise<CollectionModel> {
    const collectionsCursor = await db.listCollections().toArray();
    const collections: CollectionInfo[] = [];

    for (const collInfo of collectionsCursor) {
      if (collInfo.type !== 'collection') continue;
      if (filterCollections && !filterCollections.includes(collInfo.name)) continue;
      if (collInfo.name.startsWith('system.')) continue;

      const coll = db.collection(collInfo.name);

      // Sample documents to infer schema
      const samples = await coll.aggregate([{ $sample: { size: SAMPLE_SIZE } }]).toArray();
      const sampleSchema = inferSchema(samples);

      // Get index info
      const rawIndexes = await coll.indexes();
      const indexes: IndexInfo[] = rawIndexes
        .filter((idx: MongoIndexInfo) => idx.name !== '_id_')
        .map((idx: MongoIndexInfo) => ({
          name: idx.name,
          fields: idx.key as Record<string, 1 | -1>,
          unique: idx.unique ?? false,
        }));

      const estimatedCount = await coll.estimatedDocumentCount();

      collections.push({
        name: collInfo.name,
        sampleSchema,
        indexes,
        estimatedCount,
      });
    }

    return { collections };
  }

  // -----------------------------------------------------------------------
  // DatabaseAdapter: seed
  // -----------------------------------------------------------------------

  async seed(data: ExpandedData, context: AdapterContext): Promise<AdapterResult> {
    return this.apply(data, context);
  }

  // -----------------------------------------------------------------------
  // DatabaseAdapter: inspect
  // -----------------------------------------------------------------------

  async inspect(_context: AdapterContext): Promise<InspectResult> {
    const client = await this.getClient();
    const db = this.getDb(client);

    const collectionsCursor = await db.listCollections().toArray();
    const tables: InspectResult['tables'] = {};
    let totalRows = 0;

    for (const collInfo of collectionsCursor) {
      if (collInfo.type !== 'collection') continue;
      if (collInfo.name.startsWith('system.')) continue;
      if (this.collectionFilter && !this.collectionFilter.has(collInfo.name)) continue;

      const coll = db.collection(collInfo.name);
      const rowCount = await coll.countDocuments();
      tables[collInfo.name] = { rowCount };
      totalRows += rowCount;
    }

    return { tables, totalRows, timestamp: new Date() };
  }

  // -----------------------------------------------------------------------
  // Batch seed
  // -----------------------------------------------------------------------

  async seedBatch(data: Map<string, ExpandedData>): Promise<void> {
    const client = await this.getClient();
    const db = this.getDb(client);

    try {
      const mergedDocs = new Map<string, DocumentRecord[]>();

      for (const [, expandedData] of data) {
        for (const [collName, docs] of Object.entries(expandedData.documents)) {
          if (this.collectionFilter && !this.collectionFilter.has(collName)) continue;
          if (!mergedDocs.has(collName)) mergedDocs.set(collName, []);
          mergedDocs.get(collName)!.push(...docs);
        }
        // Also seed from tables (treat each table as a collection)
        for (const [tableName, rows] of Object.entries(expandedData.tables)) {
          if (this.collectionFilter && !this.collectionFilter.has(tableName)) continue;
          if (!mergedDocs.has(tableName)) mergedDocs.set(tableName, []);
          mergedDocs.get(tableName)!.push(...rows.map((row) => row as DocumentRecord));
        }
      }

      let seededCount = 0;

      for (const [collName, docs] of mergedDocs) {
        if (docs.length === 0) continue;

        const coll = db.collection(collName);

        switch (this.seedStrategy) {
          case 'drop-and-insert': {
            try { await coll.drop(); } catch { /* collection may not exist */ }
            await this.insertBatched(coll, docs);
            break;
          }
          case 'delete-and-insert': {
            await coll.deleteMany({});
            await this.insertBatched(coll, docs);
            break;
          }
          case 'append': {
            await this.insertBatched(coll, docs);
            break;
          }
          case 'upsert': {
            for (const doc of docs) {
              const filter = doc._id ? { _id: doc._id } : { _id: doc };
              await coll.updateOne(filter, { $set: doc }, { upsert: true });
            }
            break;
          }
        }

        seededCount++;
        debug(`Seeded "${collName}" -- ${docs.length} documents`);

        if (this.autoCreateIndexes) {
          await this.createAutoIndexes(coll, docs);
        }
      }

      success(`Seeded ${seededCount} collection(s) successfully`);
    } catch (err) {
      throw new SeedingError(
        `MongoDB seeding failed: ${err instanceof Error ? err.message : String(err)}`,
        'Check connection and document structure',
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  // -----------------------------------------------------------------------
  // Clean
  // -----------------------------------------------------------------------

  async clean(_context: AdapterContext): Promise<void> {
    const client = await this.getClient();
    const db = this.getDb(client);

    try {
      const collectionsCursor = await db.listCollections().toArray();

      for (const collInfo of collectionsCursor) {
        if (collInfo.type !== 'collection') continue;
        if (collInfo.name.startsWith('system.')) continue;
        if (this.collectionFilter && !this.collectionFilter.has(collInfo.name)) continue;

        await db.collection(collInfo.name).deleteMany({});
        debug(`Cleared "${collInfo.name}"`);
      }

      success('All MongoDB collections cleaned');
    } catch (err) {
      throw new SeedingError(
        `MongoDB clean failed: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  // -----------------------------------------------------------------------
  // Connection helpers
  // -----------------------------------------------------------------------

  private async getClient(): Promise<MongoClient> {
    if (this.client) return this.client;

    try {
      const mongodb = await this.requireMongoDB();
      this.client = new mongodb.MongoClient(this.connectionUrl);
      await this.client.connect();
      debug('MongoDB connection established');
      return this.client;
    } catch (err) {
      throw new DatabaseConnectionError(
        'Failed to connect to MongoDB',
        'Check your MongoDB URL and ensure the server is running',
        err instanceof Error ? err : new Error(String(err)),
        this.connectionUrl,
      );
    }
  }

  private getDb(client: MongoClient): MongoDatabase {
    return this.databaseName ? client.db(this.databaseName) : client.db();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      debug('MongoDB connection closed');
    }
  }

  private async requireMongoDB(): Promise<MongoDBModule> {
    try {
      // Use variable to prevent TypeScript from statically resolving the optional dep
      const pkg = 'mongodb';
      const mod = await import(/* @vite-ignore */ pkg);
      return (mod.default ?? mod) as MongoDBModule;
    } catch {
      throw new DatabaseConnectionError(
        'mongodb package not installed',
        'Install it: pnpm add mongodb',
      );
    }
  }

  private async insertBatched(coll: MongoCollection, docs: DocumentRecord[]): Promise<void> {
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = docs.slice(i, i + BATCH_SIZE);
      await coll.insertMany(batch, { ordered: false });
    }
  }

  private async createAutoIndexes(coll: MongoCollection, docs: DocumentRecord[]): Promise<void> {
    if (docs.length === 0) return;
    const fieldNames = Object.keys(docs[0]!);

    for (const field of fieldNames) {
      if (AUTO_INDEX_FIELDS.includes(field)) {
        try {
          await coll.createIndex({ [field]: 1 });
          debug(`Created index on "${field}"`);
        } catch { /* index may already exist */ }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Internal types for mongodb driver
// ---------------------------------------------------------------------------

interface MongoDBModule {
  MongoClient: MongoClientConstructor;
}

interface MongoClientConstructor {
  new (url: string): MongoClient;
}

interface MongoClient {
  connect(): Promise<void>;
  db(name?: string): MongoDatabase;
  close(): Promise<void>;
}

interface MongoDatabase {
  collection(name: string): MongoCollection;
  listCollections(): MongoCursor<MongoCollectionInfo>;
  command(cmd: Record<string, unknown>): Promise<unknown>;
}

interface MongoCollection {
  insertMany(docs: DocumentRecord[], options?: { ordered?: boolean }): Promise<unknown>;
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: { upsert?: boolean }): Promise<unknown>;
  deleteMany(filter: Record<string, unknown>): Promise<unknown>;
  drop(): Promise<void>;
  countDocuments(): Promise<number>;
  estimatedDocumentCount(): Promise<number>;
  aggregate(pipeline: Record<string, unknown>[]): MongoCursor<DocumentRecord>;
  indexes(): Promise<MongoIndexInfo[]>;
  createIndex(spec: Record<string, 1 | -1>): Promise<string>;
}

interface MongoCursor<T> {
  toArray(): Promise<T[]>;
}

interface MongoCollectionInfo {
  name: string;
  type: string;
}

interface MongoIndexInfo {
  name: string;
  key: Record<string, number>;
  unique?: boolean;
}

// ---------------------------------------------------------------------------
// Schema inference helpers
// ---------------------------------------------------------------------------

function inferSchema(docs: DocumentRecord[]): Record<string, FieldType> {
  if (docs.length === 0) return {};

  const schema: Record<string, FieldType> = {};

  for (const doc of docs) {
    for (const [key, value] of Object.entries(doc)) {
      if (key === '_id') {
        schema[key] = { kind: 'objectId' };
        continue;
      }
      if (!schema[key]) {
        schema[key] = inferFieldType(value);
      }
    }
  }

  return schema;
}

function inferFieldType(value: unknown): FieldType {
  if (value === null || value === undefined) return { kind: 'string' };
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return { kind: 'date' };
    return { kind: 'string' };
  }
  if (typeof value === 'number') return { kind: 'number' };
  if (typeof value === 'boolean') return { kind: 'boolean' };
  if (value instanceof Date) return { kind: 'date' };
  if (Array.isArray(value)) {
    const itemType = value.length > 0 ? inferFieldType(value[0]) : { kind: 'string' as const };
    return { kind: 'array', items: itemType };
  }
  if (typeof value === 'object') {
    if ('_bsontype' in value || (typeof (value as Record<string, unknown>).toHexString === 'function')) {
      return { kind: 'objectId' };
    }
    const fields: Record<string, FieldType> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      fields[k] = inferFieldType(v);
    }
    return { kind: 'object', fields };
  }
  return { kind: 'string' };
}

function fieldTypeToColumnType(ft: FieldType): ColumnType {
  switch (ft.kind) {
    case 'string': return 'text';
    case 'number': return 'double';
    case 'boolean': return 'boolean';
    case 'date': return 'timestamptz';
    case 'objectId': return 'text';
    case 'array': return 'jsonb';
    case 'object': return 'jsonb';
  }
}

function collectionModelToSchema(model: CollectionModel): SchemaModel {
  const tables = model.collections.map((coll) => ({
    name: coll.name,
    columns: Object.entries(coll.sampleSchema).map(([name, fieldType]) => ({
      name,
      type: fieldTypeToColumnType(fieldType),
      pgType: fieldType.kind,
      isNullable: true,
      hasDefault: name === '_id',
      defaultValue: undefined,
      isAutoIncrement: false,
      isGenerated: name === '_id',
      maxLength: undefined,
      precision: undefined,
      scale: undefined,
      enumValues: undefined,
      comment: undefined,
    })),
    primaryKey: ['_id'],
    foreignKeys: [],
    uniqueConstraints: [],
    checkConstraints: [],
    comment: undefined,
  }));

  return {
    tables,
    enums: [],
    insertionOrder: tables.map((t) => t.name),
  };
}
