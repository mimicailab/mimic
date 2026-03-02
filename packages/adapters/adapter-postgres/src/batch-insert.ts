import type { PoolClient } from 'pg';
import type { Row } from '@mimicailab/core';

/**
 * Default number of rows per INSERT statement.
 * Kept at 100 to stay well within PostgreSQL's parameter limit (~65535)
 * while still benefiting from multi-row insert throughput.
 */
const DEFAULT_BATCH_SIZE = 100;

/**
 * Serialise a single cell value into a form suitable for a parameterised query.
 *
 * - `null` / `undefined`  -> null
 * - `Date`                -> ISO-8601 string
 * - `boolean`             -> native boolean (pg driver handles it)
 * - plain objects / arrays -> JSON string
 * - everything else       -> passed through unchanged
 */
function serialiseValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return value;
}

/**
 * Build a multi-row INSERT statement with positional placeholders.
 *
 * Example output for 2 columns, 3 rows:
 *   INSERT INTO "users" ("name", "email") VALUES ($1, $2), ($3, $4), ($5, $6)
 */
function buildInsertSql(
  table: string,
  columns: string[],
  rowCount: number,
): string {
  const quotedCols = columns.map((c) => `"${c}"`).join(', ');
  const colCount = columns.length;

  const valueTuples: string[] = [];
  for (let row = 0; row < rowCount; row++) {
    const placeholders: string[] = [];
    for (let col = 0; col < colCount; col++) {
      placeholders.push(`$${row * colCount + col + 1}`);
    }
    valueTuples.push(`(${placeholders.join(', ')})`);
  }

  return `INSERT INTO "${table}" (${quotedCols}) VALUES ${valueTuples.join(', ')}`;
}

/**
 * Insert rows into a PostgreSQL table using multi-row parameterised INSERTs,
 * processed in batches to avoid exceeding the parameter limit.
 *
 * @param client   - An active `PoolClient` (typically inside a transaction).
 * @param table    - Target table name (unquoted; will be double-quoted in SQL).
 * @param columns  - Ordered list of column names to insert.
 * @param rows     - Array of row objects keyed by column name.
 * @param batchSize - Maximum rows per INSERT statement (default 100).
 */
export async function batchInsert(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: Row[],
  batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<void> {
  if (rows.length === 0 || columns.length === 0) {
    return;
  }

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);

    const sql = buildInsertSql(table, columns, batch.length);

    const params: unknown[] = [];
    for (const row of batch) {
      for (const col of columns) {
        params.push(serialiseValue(row[col]));
      }
    }

    await client.query(sql, params);
  }
}
