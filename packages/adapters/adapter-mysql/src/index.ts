import type { AdapterManifest } from '@mimicailab/core';

export { MySQLSeeder } from './mysql-seeder.js';
export type { MySQLConfig } from './mysql-seeder.js';

export const manifest: AdapterManifest = {
  id: 'mysql',
  name: 'MySQL',
  type: 'database',
  description: 'MySQL database adapter for Mimic — batch INSERT, upsert, INFORMATION_SCHEMA introspection',
};
