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
  // ── Database adapters ──────────────────────────────────────────────────
  const dbAdapterPackages = [
    '@mimicai/adapter-postgres',
    '@mimicai/adapter-mysql',
    '@mimicai/adapter-sqlite',
    '@mimicai/adapter-mongodb',
  ];

  for (const pkg of dbAdapterPackages) {
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

  // API mock adapters are NOT auto-registered here.
  // Users add them explicitly via `mimic adapters add <id>`, which:
  //   1. Installs the npm package
  //   2. Adds the adapter to mimic.json apis section
  // The `mimic host` command then loads only configured adapters from config.

  // ── Vector (stub, stays in core) ────────────────────────────────────────
  const vectorManifest: AdapterManifest = {
    id: 'vector',
    name: 'Vector Database',
    type: 'database',
    description: 'Seed embeddings into Pinecone, Weaviate, Chroma, or pgvector (coming in v0.3.0)',
  };
  registerAdapter(new VectorSeeder(), vectorManifest);
}
