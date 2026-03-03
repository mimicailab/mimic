import type { PoolClient } from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Row } from '@mimicailab/core';

/**
 * Escape a string value for the PostgreSQL COPY TEXT format.
 *
 * The TEXT format uses tab as the column delimiter and newline as the row
 * delimiter.  Backslash is the escape character.  The following
 * substitutions are required:
 *
 *   \  ->  \\
 *   \t ->  \\t  (tab)
 *   \n ->  \\n  (newline)
 *   \r ->  \\r  (carriage return)
 */
function escapeCopyValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Serialise a single cell value into its COPY TEXT representation.
 *
 * - `null` / `undefined`  -> `\\N`  (the NULL marker)
 * - `boolean`             -> `t` or `f`
 * - `Date`                -> ISO-8601 string
 * - plain objects / arrays -> JSON string (escaped)
 * - strings               -> escaped string
 * - numbers / bigints     -> string representation
 */
function toCopyCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '\\N';
  }
  if (typeof value === 'boolean') {
    return value ? 't' : 'f';
  }
  if (value instanceof Date) {
    return escapeCopyValue(value.toISOString());
  }
  if (typeof value === 'object') {
    return escapeCopyValue(JSON.stringify(value));
  }
  if (typeof value === 'string') {
    return escapeCopyValue(value);
  }
  // numbers, bigints
  return String(value);
}

/**
 * Build a complete COPY TEXT payload from an array of rows.
 *
 * Each row is a tab-separated line terminated by `\n`.
 */
function buildCopyPayload(columns: string[], rows: Row[]): string {
  const lines: string[] = [];
  for (const row of rows) {
    const cells = columns.map((col) => toCopyCell(row[col]));
    lines.push(cells.join('\t'));
  }
  return lines.join('\n') + '\n';
}

/**
 * Bulk-load rows into a PostgreSQL table using the COPY protocol.
 *
 * This is significantly faster than INSERT for large row counts because
 * the data is streamed directly into the table without per-row overhead.
 *
 * @param client  - An active `PoolClient` (typically inside a transaction).
 * @param table   - Target table name (unquoted; will be double-quoted in SQL).
 * @param columns - Ordered list of column names.
 * @param rows    - Array of row objects keyed by column name.
 */
export async function bulkCopy(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: Row[],
): Promise<void> {
  if (rows.length === 0 || columns.length === 0) {
    return;
  }

  const quotedCols = columns.map((c) => `"${c}"`).join(', ');
  const copyQuery = `COPY "${table}" (${quotedCols}) FROM STDIN WITH (FORMAT text)`;

  const copyStream = client.query(copyFrom(copyQuery));
  const payload = buildCopyPayload(columns, rows);
  const source = Readable.from([payload]);

  await pipeline(source, copyStream);
}
