import type { AdapterManifest } from '../types/adapter.js';
import { PgSeeder } from '../seed/pg-seeder.js';
import { MongoSeeder } from '../seed/mongo-seeder.js';
import { VectorSeeder } from '../seed/vector-seeder.js';
import { registerAdapter } from './registry.js';

let registered = false;

/**
 * Register all built-in adapters with the default AdapterRegistry singleton.
 *
 * Safe to call multiple times — only registers once.
 */
export function registerDefaults(): void {
  if (registered) return;
  registered = true;

  // ── PostgreSQL ──────────────────────────────────────────────────────────
  const pgSeeder = new PgSeeder();
  const pgManifest: AdapterManifest = {
    id: 'postgres',
    name: 'PostgreSQL',
    type: 'database',
    description: 'Seed relational data into PostgreSQL via batch INSERT or COPY',
  };
  registerAdapter(pgSeeder, pgManifest);

  // ── MongoDB (stub) ──────────────────────────────────────────────────────
  const mongoSeeder = new MongoSeeder();
  const mongoManifest: AdapterManifest = {
    id: 'mongodb',
    name: 'MongoDB',
    type: 'database',
    description: 'Seed document data into MongoDB collections (coming in v0.2.0)',
  };
  registerAdapter(mongoSeeder, mongoManifest);

  // ── Vector (stub) ──────────────────────────────────────────────────────
  const vectorSeeder = new VectorSeeder();
  const vectorManifest: AdapterManifest = {
    id: 'vector',
    name: 'Vector Database',
    type: 'database',
    description: 'Seed embeddings into Pinecone, Weaviate, Chroma, or pgvector (coming in v0.2.0)',
  };
  registerAdapter(vectorSeeder, vectorManifest);
}
