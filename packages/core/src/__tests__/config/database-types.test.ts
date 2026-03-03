import { describe, it, expect } from 'vitest';
import { MimicConfigSchema } from '../../types/config.js';

describe('MimicConfigSchema — database types', () => {
  const baseConfig = {
    domain: 'test-agent',
    personas: [{ name: 'test', description: 'A test persona' }],
  };

  it('should accept a postgres database config', () => {
    const result = MimicConfigSchema.safeParse({
      ...baseConfig,
      databases: {
        default: {
          type: 'postgres',
          url: 'postgresql://localhost/test',
          seedStrategy: 'truncate-and-insert',
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('should accept a mysql database config', () => {
    const result = MimicConfigSchema.safeParse({
      ...baseConfig,
      databases: {
        default: {
          type: 'mysql',
          url: 'mysql://localhost/test',
          seedStrategy: 'upsert',
          pool: { max: 10, timeout: 3000 },
          copyThreshold: 1000,
          excludeTables: ['_migrations'],
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const db = result.data.databases!.default!;
      expect(db.type).toBe('mysql');
    }
  });

  it('should accept a sqlite database config', () => {
    const result = MimicConfigSchema.safeParse({
      ...baseConfig,
      databases: {
        default: {
          type: 'sqlite',
          path: './test.db',
          walMode: true,
          seedStrategy: 'truncate-and-insert',
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const db = result.data.databases!.default!;
      expect(db.type).toBe('sqlite');
    }
  });

  it('should accept a mongodb database config with all options', () => {
    const result = MimicConfigSchema.safeParse({
      ...baseConfig,
      databases: {
        default: {
          type: 'mongodb',
          url: 'mongodb://localhost:27017/test',
          database: 'mydb',
          collections: ['users', 'orders'],
          seedStrategy: 'drop-and-insert',
          autoCreateIndexes: true,
          tls: false,
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const db = result.data.databases!.default!;
      expect(db.type).toBe('mongodb');
    }
  });

  it('should accept multiple databases of different types', () => {
    const result = MimicConfigSchema.safeParse({
      ...baseConfig,
      databases: {
        primary: {
          type: 'postgres',
          url: 'postgresql://localhost/primary',
        },
        cache: {
          type: 'sqlite',
          path: './cache.db',
        },
        documents: {
          type: 'mongodb',
          url: 'mongodb://localhost:27017/docs',
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data.databases!)).toHaveLength(3);
    }
  });

  it('should default mysql seedStrategy to truncate-and-insert', () => {
    const result = MimicConfigSchema.safeParse({
      ...baseConfig,
      databases: {
        default: {
          type: 'mysql',
          url: 'mysql://localhost/test',
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const db = result.data.databases!.default! as { seedStrategy: string };
      expect(db.seedStrategy).toBe('truncate-and-insert');
    }
  });

  it('should default mongodb seedStrategy to delete-and-insert', () => {
    const result = MimicConfigSchema.safeParse({
      ...baseConfig,
      databases: {
        default: {
          type: 'mongodb',
          url: 'mongodb://localhost:27017/test',
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const db = result.data.databases!.default! as { seedStrategy: string };
      expect(db.seedStrategy).toBe('delete-and-insert');
    }
  });

  it('should default sqlite seedStrategy to truncate-and-insert', () => {
    const result = MimicConfigSchema.safeParse({
      ...baseConfig,
      databases: {
        default: {
          type: 'sqlite',
          path: './test.db',
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const db = result.data.databases!.default! as { seedStrategy: string };
      expect(db.seedStrategy).toBe('truncate-and-insert');
    }
  });

  it('should reject invalid database type', () => {
    const result = MimicConfigSchema.safeParse({
      ...baseConfig,
      databases: {
        default: {
          type: 'invalid',
          url: 'something',
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it('should reject sqlite without path', () => {
    const result = MimicConfigSchema.safeParse({
      ...baseConfig,
      databases: {
        default: {
          type: 'sqlite',
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it('should reject mysql without url', () => {
    const result = MimicConfigSchema.safeParse({
      ...baseConfig,
      databases: {
        default: {
          type: 'mysql',
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid mongodb seed strategy', () => {
    const result = MimicConfigSchema.safeParse({
      ...baseConfig,
      databases: {
        default: {
          type: 'mongodb',
          url: 'mongodb://localhost:27017/test',
          seedStrategy: 'upsert-merge',
        },
      },
    });
    expect(result.success).toBe(false);
  });
});
