import type {
  Adapter,
  AdapterType,
  AdapterContext,
  AdapterResult,
} from '../types/adapter.js';
import type { ExpandedData } from '../types/dataset.js';

interface VectorConfig {
  provider: 'pinecone' | 'weaviate' | 'chroma' | 'pgvector';
  config: Record<string, unknown>;
  embeddingModel?: string;
  documentSource: {
    type: 'generate' | 'directory';
    description?: string;
    path?: string;
    count?: number;
  };
}

/**
 * Vector database seeder — upserts embeddings to Pinecone, Weaviate,
 * Chroma, or pgvector.
 *
 * Requires the corresponding vector DB client package.  Currently a
 * stub; full implementation will arrive in v0.2.0.
 */
export class VectorSeeder implements Adapter<VectorConfig> {
  readonly id = 'vector';
  readonly name = 'Vector Database';
  readonly type: AdapterType = 'database';

  async init(_config: VectorConfig, _context: AdapterContext): Promise<void> {
    throw new Error('Vector seeder is not yet implemented. Coming in v0.2.0.');
  }

  async apply(_data: ExpandedData, _context: AdapterContext): Promise<AdapterResult> {
    throw new Error('Vector seeder is not yet implemented.');
  }

  async clean(_context: AdapterContext): Promise<void> {
    throw new Error('Vector seeder is not yet implemented.');
  }

  async healthcheck(_context: AdapterContext): Promise<boolean> {
    return false;
  }

  async dispose(): Promise<void> {}
}
