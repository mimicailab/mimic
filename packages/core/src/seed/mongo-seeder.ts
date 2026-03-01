import type {
  Adapter,
  AdapterType,
  AdapterContext,
  AdapterResult,
} from '../types/adapter.js';
import type { ExpandedData } from '../types/dataset.js';

interface MongoConfig {
  url: string;
  collections?: string[];
}

/**
 * MongoDB seeder — seeds document collections via insertMany.
 *
 * Requires the `mongodb` npm package.  Currently a stub; full
 * implementation will arrive in v0.2.0.
 */
export class MongoSeeder implements Adapter<MongoConfig> {
  readonly id = 'mongodb';
  readonly name = 'MongoDB';
  readonly type: AdapterType = 'database';

  async init(_config: MongoConfig, _context: AdapterContext): Promise<void> {
    throw new Error('MongoDB seeder is not yet implemented. Coming in v0.2.0.');
  }

  async apply(_data: ExpandedData, _context: AdapterContext): Promise<AdapterResult> {
    throw new Error('MongoDB seeder is not yet implemented.');
  }

  async clean(_context: AdapterContext): Promise<void> {
    throw new Error('MongoDB seeder is not yet implemented.');
  }

  async healthcheck(_context: AdapterContext): Promise<boolean> {
    return false;
  }

  async dispose(): Promise<void> {}
}
