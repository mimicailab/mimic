import type { Adapter, AdapterManifest } from '../types/adapter.js';
import { registerAdapter } from './registry.js';
import { VectorSeeder } from '../seed/vector-seeder.js';

let registered = false;

/**
 * Register all built-in adapters with the default AdapterRegistry singleton.
 * Uses dynamic imports so adapters are only loaded if installed.
 */
export async function registerDefaults(): Promise<void> {
  if (registered) return;
  registered = true;

  // Dynamically load adapter packages — silently skip if not installed.
  // Variable names prevent TypeScript from statically resolving the modules.
  const adapterPackages = [
    '@mimicailab/adapter-postgres',
    '@mimicailab/adapter-mysql',
    '@mimicailab/adapter-sqlite',
    '@mimicailab/adapter-mongodb',
  ];

  for (const pkg of adapterPackages) {
    try {
      const mod = await import(/* @vite-ignore */ pkg);
      const AdapterClass = mod.PgSeeder ?? mod.MySQLSeeder ?? mod.SQLiteSeeder ?? mod.MongoSeeder;
      const manifest: AdapterManifest | undefined = mod.manifest;
      if (AdapterClass && manifest) {
        registerAdapter(new AdapterClass() as Adapter, manifest);
      }
    } catch {
      // Adapter package not installed — skip silently
    }
  }

  // ── Vector (stub, stays in core) ────────────────────────────────────────
  const vectorManifest: AdapterManifest = {
    id: 'vector',
    name: 'Vector Database',
    type: 'database',
    description: 'Seed embeddings into Pinecone, Weaviate, Chroma, or pgvector (coming in v0.3.0)',
  };
  registerAdapter(new VectorSeeder(), vectorManifest);
}
