import type { CollectionModel } from '../types/schema.js';

export interface MongoIntrospectOptions {
  /** Specific collections to introspect. If omitted, all collections are sampled. */
  collections?: string[];
  /** Number of documents to sample per collection for schema inference. */
  sampleSize?: number;
}

/**
 * Introspect a MongoDB database to infer collection schemas.
 *
 * Samples documents from each collection and infers field types,
 * indexes, and estimated counts. Requires the `mongodb` package.
 *
 * @throws Error — MongoDB introspection is not yet implemented.
 */
export async function introspectMongoDB(
  _url: string,
  _options?: MongoIntrospectOptions,
): Promise<CollectionModel> {
  throw new Error(
    'MongoDB introspection is not yet implemented. Install the `mongodb` package and check back in v0.2.0.',
  );
}
