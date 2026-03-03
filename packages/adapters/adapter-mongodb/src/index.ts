import type { AdapterManifest } from '@mimicai/core';

export { MongoSeeder } from './mongo-seeder.js';
export type { MongoConfig } from './mongo-seeder.js';

export const manifest: AdapterManifest = {
  id: 'mongodb',
  name: 'MongoDB',
  type: 'database',
  description: 'MongoDB database adapter for Mimic — insertMany batching, schema inference, auto-indexing',
};
