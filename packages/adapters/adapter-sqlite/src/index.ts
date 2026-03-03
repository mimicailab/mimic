import type { AdapterManifest } from '@mimicailab/core';

export { SQLiteSeeder } from './sqlite-seeder.js';
export type { SQLiteConfig, BetterSQLite3Database } from './sqlite-seeder.js';

export const manifest: AdapterManifest = {
  id: 'sqlite',
  name: 'SQLite',
  type: 'database',
  description: 'SQLite database adapter for Mimic — prepared statements, WAL mode, PRAGMA introspection',
};
