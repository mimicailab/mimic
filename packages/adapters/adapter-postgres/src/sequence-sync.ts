import type { PoolClient } from 'pg';
import type { SchemaModel } from '@mimicai/core';
import { logger } from '@mimicai/core';

const { debug } = logger;

/**
 * Re-synchronise all SERIAL / IDENTITY sequences so that the next
 * generated value is one past the current maximum in each table.
 *
 * After bulk-inserting rows with explicit primary-key values the
 * underlying sequences are typically out of date.  If left unfixed,
 * the next application-level INSERT that relies on the default value
 * will collide with an existing row.
 *
 * The function inspects every auto-increment column declared in the
 * schema, queries `pg_get_serial_sequence` to find the backing
 * sequence (if any), and calls `setval` to advance it.
 *
 * Errors for individual columns are caught and logged at debug level
 * rather than propagated -- some tables (e.g. those using GENERATED
 * ALWAYS AS IDENTITY with non-standard ownership) may not expose a
 * sequence through `pg_get_serial_sequence`.
 *
 * @param client - An active `PoolClient` (typically inside a transaction).
 * @param schema - The parsed schema model containing table metadata.
 */
export async function syncSequences(
  client: PoolClient,
  schema: SchemaModel,
): Promise<void> {
  for (const table of schema.tables) {
    const autoIncrementColumns = table.columns.filter((col) => col.isAutoIncrement);

    for (const col of autoIncrementColumns) {
      try {
        // Discover the sequence backing this column (may be null).
        const seqResult = await client.query<{ seq: string | null }>(
          `SELECT pg_get_serial_sequence($1, $2) AS seq`,
          [table.name, col.name],
        );

        const sequenceName = seqResult.rows[0]?.seq;
        if (!sequenceName) {
          debug(`No sequence found for "${table.name}"."${col.name}" -- skipping`);
          continue;
        }

        // Advance the sequence to MAX(column) or fall back to 1 for empty tables.
        await client.query(
          `SELECT setval($1, COALESCE((SELECT MAX("${col.name}") FROM "${table.name}"), 1))`,
          [sequenceName],
        );

        debug(`Synced sequence ${sequenceName} for "${table.name}"."${col.name}"`);
      } catch (err) {
        // Non-fatal: log and continue with remaining columns / tables.
        const message = err instanceof Error ? err.message : String(err);
        debug(`Failed to sync sequence for "${table.name}"."${col.name}": ${message}`);
      }
    }
  }
}
