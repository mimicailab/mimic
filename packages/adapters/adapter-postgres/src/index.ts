import type { AdapterManifest } from '@mimicailab/core';

// ---------------------------------------------------------------------------
// Re-export the PgSeeder class and its public types
// ---------------------------------------------------------------------------
export { PgSeeder } from './pg-seeder.js';
export type { PostgresConfig, SeedOptions } from './pg-seeder.js';

// ---------------------------------------------------------------------------
// Re-export low-level PG helper functions
// ---------------------------------------------------------------------------
export { batchInsert } from './batch-insert.js';
export { bulkCopy } from './bulk-copy.js';
export { syncSequences } from './sequence-sync.js';

// ---------------------------------------------------------------------------
// Adapter manifest — used for discovery and documentation
// ---------------------------------------------------------------------------
export const manifest: AdapterManifest = {
  id: 'postgres',
  name: 'PostgreSQL',
  type: 'database',
  description:
    'PostgreSQL database adapter for Mimic — batch INSERT, COPY protocol, upsert support',
  requiredSecrets: ['DATABASE_URL'],
  documentationUrl: 'https://github.com/mimicailab/mimic/tree/main/packages/adapters/adapter-postgres',
};
