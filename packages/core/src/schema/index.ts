/**
 * Schema module — unified entry point for all schema parsing strategies.
 *
 * Re-exports individual parsers and provides the `parseSchema()` dispatcher
 * that selects the correct parser based on the Mimic configuration.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool } from 'pg';

import type { SchemaModel } from '../types/schema.js';
import { SchemaParseError, ConfigInvalidError } from '../utils/index.js';
import { logger } from '../utils/index.js';

// ─── Re-exports ──────────────────────────────────────────────────────────────

export { topologicalSort } from './topo-sort.js';
export { parsePrismaSchema } from './prisma-parser.js';
export { parseSQLSchema } from './sql-parser.js';
export { introspectDatabase } from './db-introspector.js';
export { introspectMongoDB } from './mongo-introspector.js';

// ─── parseSchema() dispatcher ────────────────────────────────────────────────

/**
 * Configuration subset needed by the schema dispatcher.
 * Mirrors the `databases[key].schema` portion of `MimicConfig`.
 */
export interface SchemaSourceConfig {
  source: 'prisma' | 'sql' | 'introspect';
  path?: string;
}

/**
 * Options for the `parseSchema()` dispatcher.
 */
export interface ParseSchemaOptions {
  /** Schema source configuration (from mimic.json `databases.<name>.schema`). */
  schema?: SchemaSourceConfig;

  /**
   * A `pg.Pool` instance. Required when `source` is `'introspect'` or when no
   * `schema` config is provided (introspection is the default fallback).
   */
  pool?: Pool;

  /**
   * Base directory for resolving relative schema file paths.
   * Defaults to `process.cwd()`.
   */
  basePath?: string;

  /**
   * PostgreSQL schema name for introspection. Defaults to `'public'`.
   */
  pgSchema?: string;
}

/**
 * Unified schema parsing dispatcher.
 *
 * Selects the correct parser based on the configuration's `schema.source`:
 * - `'prisma'` — reads the file at `schema.path` and parses with prisma-ast
 * - `'sql'` — reads the file at `schema.path` and parses with pgsql-parser
 * - `'introspect'` (or missing) — queries the live database via `pool`
 *
 * @param options - Dispatcher options including config, pool, and base path.
 * @returns A normalised `SchemaModel` ready for blueprint generation and seeding.
 * @throws SchemaParseError if the schema file cannot be read or parsed.
 * @throws ConfigInvalidError if required options are missing.
 */
export async function parseSchema(options: ParseSchemaOptions): Promise<SchemaModel> {
  const { schema, pool, basePath = process.cwd(), pgSchema = 'public' } = options;
  const source = schema?.source ?? 'introspect';

  switch (source) {
    case 'prisma': {
      const filePath = resolveSchemaPath(schema?.path, basePath, 'prisma');
      logger.step(`Parsing Prisma schema from ${filePath}`);

      const content = await readSchemaFile(filePath);
      const { parsePrismaSchema } = await import('./prisma-parser.js');
      const model = parsePrismaSchema(content);

      logger.success(
        `Parsed ${model.tables.length} table(s) and ${model.enums.length} enum(s) from Prisma schema`,
      );
      return model;
    }

    case 'sql': {
      const filePath = resolveSchemaPath(schema?.path, basePath, 'sql');
      logger.step(`Parsing SQL DDL from ${filePath}`);

      const content = await readSchemaFile(filePath);
      const { parseSQLSchema } = await import('./sql-parser.js');
      const model = await parseSQLSchema(content);

      logger.success(
        `Parsed ${model.tables.length} table(s) and ${model.enums.length} enum(s) from SQL DDL`,
      );
      return model;
    }

    case 'introspect': {
      if (!pool) {
        throw new ConfigInvalidError(
          'Database pool is required for schema introspection',
          'Provide a pg.Pool instance or switch to "prisma" / "sql" schema source.',
        );
      }

      logger.step(`Introspecting database schema (schema: ${pgSchema})`);

      const { introspectDatabase } = await import('./db-introspector.js');
      const model = await introspectDatabase(pool, pgSchema);

      logger.success(
        `Introspected ${model.tables.length} table(s) and ${model.enums.length} enum(s) from database`,
      );
      return model;
    }

    default: {
      // TypeScript exhaustiveness check — should never reach here if config
      // validation is correct, but handle gracefully.
      const _exhaustive: never = source;
      throw new ConfigInvalidError(
        `Unknown schema source: "${_exhaustive}"`,
        'Valid schema sources are: "prisma", "sql", "introspect".',
      );
    }
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Resolve the schema file path, applying defaults if no explicit path is given.
 */
function resolveSchemaPath(
  configPath: string | undefined,
  basePath: string,
  sourceType: 'prisma' | 'sql',
): string {
  if (configPath) {
    return resolve(basePath, configPath);
  }

  // Default file name conventions
  const defaults: Record<string, string> = {
    prisma: 'prisma/schema.prisma',
    sql: 'schema.sql',
  };

  return resolve(basePath, defaults[sourceType]);
}

/**
 * Read a schema file from disk with user-friendly error handling.
 */
async function readSchemaFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new SchemaParseError(
        `Schema file not found: ${filePath}`,
        'Check the "schema.path" setting in your mimic.json configuration.',
        err instanceof Error ? err : new Error(String(err)),
      );
    }
    if (code === 'EACCES') {
      throw new SchemaParseError(
        `Permission denied reading schema file: ${filePath}`,
        'Check file permissions.',
        err instanceof Error ? err : new Error(String(err)),
      );
    }
    throw new SchemaParseError(
      `Failed to read schema file: ${filePath}`,
      undefined,
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
