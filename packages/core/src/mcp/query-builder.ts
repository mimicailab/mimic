/**
 * MCP Query Builder
 *
 * Converts tool call arguments into safe parameterised SQL queries.
 * All user-supplied values are bound via $1, $2, ... placeholders — never
 * interpolated into the query string. Table and column identifiers are
 * validated against the schema (whitelist) and quoted with double-quotes.
 */

import type { Pool, QueryResult } from 'pg';
import type { TableInfo, ColumnInfo, Row } from '../types/index.js';
import { McpServerError } from '../utils/errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The execution mode determines what kind of SQL statement is built. */
export type QueryMode = 'select' | 'aggregate';

// ---------------------------------------------------------------------------
// Column-type classification (mirrors tool-generator logic)
// ---------------------------------------------------------------------------

const DATE_TYPES = new Set(['timestamptz', 'timestamp', 'date']);
const NUMERIC_TYPES = new Set([
  'integer',
  'bigint',
  'smallint',
  'decimal',
  'float',
  'double',
]);
const TEXT_TYPES = new Set(['text', 'varchar', 'char']);

function isDateType(type: string): boolean {
  return DATE_TYPES.has(type);
}

function isNumericType(type: string): boolean {
  return NUMERIC_TYPES.has(type);
}

function isTextType(type: string): boolean {
  return TEXT_TYPES.has(type);
}

// ---------------------------------------------------------------------------
// Schema validation helpers
// ---------------------------------------------------------------------------

/** Quote an identifier with double-quotes (Postgres convention). */
function quoteIdent(name: string): string {
  // Escape any embedded double-quotes by doubling them.
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Validate that a column name exists in the table's schema.
 * Returns the ColumnInfo if valid, throws otherwise.
 */
function validateColumn(tableInfo: TableInfo, columnName: string): ColumnInfo {
  const col = tableInfo.columns.find((c) => c.name === columnName);
  if (!col) {
    throw new McpServerError(
      `Column "${columnName}" does not exist in table "${tableInfo.name}"`,
      'Verify the column name matches the database schema',
    );
  }
  return col;
}

/**
 * Check whether a column is part of a foreign key in the table.
 */
function isForeignKeyColumn(tableInfo: TableInfo, columnName: string): boolean {
  return tableInfo.foreignKeys.some((fk) => fk.columns.includes(columnName));
}

// ---------------------------------------------------------------------------
// WHERE clause builder
// ---------------------------------------------------------------------------

interface WhereFragment {
  clause: string;
  value: unknown;
}

/**
 * Given the raw arguments from a tool call, build an array of WHERE
 * fragments. Each fragment holds a parameterised clause (`column >= $N`) and
 * the corresponding bind value.
 *
 * The `paramOffset` specifies the starting $N index (1-based).
 */
function buildWhereFragments(
  tableInfo: TableInfo,
  args: Record<string, unknown>,
  paramOffset: number,
): WhereFragment[] {
  const fragments: WhereFragment[] = [];
  let idx = paramOffset;

  // Build a lookup of valid column names for fast access.
  const columnMap = new Map<string, ColumnInfo>();
  for (const col of tableInfo.columns) {
    columnMap.set(col.name, col);
  }

  for (const [key, value] of Object.entries(args)) {
    // Skip pagination and aggregate-specific keys.
    if (key === 'limit' || key === 'offset' || key === 'group_by') continue;

    // Skip null/undefined values — they mean "no filter".
    if (value === null || value === undefined) continue;

    // ── Date range: start_{col} / end_{col} ────────────────────────────
    if (key.startsWith('start_')) {
      const colName = key.slice(6); // strip "start_"
      const col = columnMap.get(colName);
      if (col && isDateType(col.type)) {
        fragments.push({
          clause: `${quoteIdent(colName)} >= $${idx}`,
          value,
        });
        idx++;
        continue;
      }
    }

    if (key.startsWith('end_')) {
      const colName = key.slice(4); // strip "end_"
      const col = columnMap.get(colName);
      if (col && isDateType(col.type)) {
        fragments.push({
          clause: `${quoteIdent(colName)} <= $${idx}`,
          value,
        });
        idx++;
        continue;
      }
    }

    // ── Numeric range: min_{col} / max_{col} ────────────────────────────
    if (key.startsWith('min_')) {
      const colName = key.slice(4); // strip "min_"
      const col = columnMap.get(colName);
      if (col && isNumericType(col.type) && !isForeignKeyColumn(tableInfo, colName)) {
        fragments.push({
          clause: `${quoteIdent(colName)} >= $${idx}`,
          value,
        });
        idx++;
        continue;
      }
    }

    if (key.startsWith('max_')) {
      const colName = key.slice(4); // strip "max_"
      const col = columnMap.get(colName);
      if (col && isNumericType(col.type) && !isForeignKeyColumn(tableInfo, colName)) {
        fragments.push({
          clause: `${quoteIdent(colName)} <= $${idx}`,
          value,
        });
        idx++;
        continue;
      }
    }

    // ── Direct column match ─────────────────────────────────────────────
    const col = columnMap.get(key);
    if (!col) {
      // Unknown parameter — skip silently rather than erroring, because
      // the MCP SDK may pass extra metadata keys.
      continue;
    }

    // Enum or FK → exact match
    if (
      col.type === 'enum' ||
      col.type === 'boolean' ||
      isForeignKeyColumn(tableInfo, key)
    ) {
      fragments.push({
        clause: `${quoteIdent(key)} = $${idx}`,
        value,
      });
      idx++;
      continue;
    }

    // Numeric FK (already handled above for ranges, but a direct numeric
    // column name means the tool exposed it as exact match — e.g. FK).
    if (isNumericType(col.type)) {
      fragments.push({
        clause: `${quoteIdent(key)} = $${idx}`,
        value,
      });
      idx++;
      continue;
    }

    // Text → ILIKE substring match
    if (isTextType(col.type)) {
      fragments.push({
        clause: `${quoteIdent(key)} ILIKE '%' || $${idx} || '%'`,
        value,
      });
      idx++;
      continue;
    }

    // Fallback: exact match for any other type
    fragments.push({
      clause: `${quoteIdent(key)} = $${idx}`,
      value,
    });
    idx++;
  }

  return fragments;
}

// ---------------------------------------------------------------------------
// ORDER BY resolution
// ---------------------------------------------------------------------------

/**
 * Determine the default ORDER BY column. Prefer the first date/timestamp
 * column (DESC), falling back to the primary key (DESC).
 */
function resolveOrderBy(tableInfo: TableInfo): string {
  const dateCol = tableInfo.columns.find((c) => isDateType(c.type));
  if (dateCol) return `${quoteIdent(dateCol.name)} DESC`;

  if (tableInfo.primaryKey.length > 0) {
    return tableInfo.primaryKey.map((pk) => `${quoteIdent(pk)} DESC`).join(', ');
  }

  // Last resort: first column
  return `${quoteIdent(tableInfo.columns[0].name)} DESC`;
}

// ---------------------------------------------------------------------------
// SELECT query builder
// ---------------------------------------------------------------------------

function buildSelectQuery(
  table: string,
  tableInfo: TableInfo,
  args: Record<string, unknown>,
): { text: string; values: unknown[] } {
  const limit = typeof args['limit'] === 'number' ? Math.max(1, args['limit'] as number) : 50;
  const offset = typeof args['offset'] === 'number' ? Math.max(0, args['offset'] as number) : 0;

  const fragments = buildWhereFragments(tableInfo, args, 1);
  const values = fragments.map((f) => f.value);

  let sql = `SELECT * FROM ${quoteIdent(table)}`;

  if (fragments.length > 0) {
    sql += ' WHERE ' + fragments.map((f) => f.clause).join(' AND ');
  }

  sql += ` ORDER BY ${resolveOrderBy(tableInfo)}`;

  // LIMIT and OFFSET as parameters
  const limitIdx = values.length + 1;
  const offsetIdx = values.length + 2;
  sql += ` LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
  values.push(limit, offset);

  return { text: sql, values };
}

// ---------------------------------------------------------------------------
// AGGREGATE query builder
// ---------------------------------------------------------------------------

function buildAggregateQuery(
  table: string,
  tableInfo: TableInfo,
  args: Record<string, unknown>,
): { text: string; values: unknown[] } {
  const limit = typeof args['limit'] === 'number' ? Math.max(1, args['limit'] as number) : 50;
  const offset = typeof args['offset'] === 'number' ? Math.max(0, args['offset'] as number) : 0;

  // Identify numeric columns eligible for aggregation (non-generated, non-FK).
  const numericCols = tableInfo.columns.filter(
    (c) =>
      isNumericType(c.type) &&
      !c.isGenerated &&
      !isForeignKeyColumn(tableInfo, c.name),
  );

  // Build SELECT expressions: COUNT(*) + SUM/AVG/MIN/MAX for each numeric col.
  const selectExprs: string[] = ['COUNT(*) AS "count"'];

  for (const col of numericCols) {
    const q = quoteIdent(col.name);
    selectExprs.push(`SUM(${q}) AS "sum_${col.name}"`);
    selectExprs.push(`AVG(${q}) AS "avg_${col.name}"`);
    selectExprs.push(`MIN(${q}) AS "min_${col.name}"`);
    selectExprs.push(`MAX(${q}) AS "max_${col.name}"`);
  }

  // ── GROUP BY handling ─────────────────────────────────────────────────
  const groupByArg = args['group_by'];
  let groupByCol: string | null = null;

  if (typeof groupByArg === 'string' && groupByArg.length > 0) {
    // Validate against schema whitelist
    validateColumn(tableInfo, groupByArg);
    groupByCol = groupByArg;
    // Prepend the grouping column to the select list
    selectExprs.unshift(quoteIdent(groupByCol));
  }

  // ── WHERE ─────────────────────────────────────────────────────────────
  const fragments = buildWhereFragments(tableInfo, args, 1);
  const values = fragments.map((f) => f.value);

  let sql = `SELECT ${selectExprs.join(', ')} FROM ${quoteIdent(table)}`;

  if (fragments.length > 0) {
    sql += ' WHERE ' + fragments.map((f) => f.clause).join(' AND ');
  }

  if (groupByCol) {
    sql += ` GROUP BY ${quoteIdent(groupByCol)}`;
    sql += ` ORDER BY "count" DESC`;
  }

  // LIMIT / OFFSET
  const limitIdx = values.length + 1;
  const offsetIdx = values.length + 2;
  sql += ` LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
  values.push(limit, offset);

  return { text: sql, values };
}

// ---------------------------------------------------------------------------
// QueryBuilder class
// ---------------------------------------------------------------------------

/**
 * Converts MCP tool-call arguments into safe parameterised SQL and executes
 * the query against a Postgres connection pool.
 *
 * **Security contract**: every user-supplied value is bound via `$N`
 * placeholders. Table and column names are validated against the schema
 * whitelist and quoted with double-quotes.
 */
export class QueryBuilder {
  constructor(private readonly pool: Pool) {}

  /**
   * Execute a query against the given table.
   *
   * @param table     - The table name (must exist in the schema).
   * @param tableInfo - The TableInfo metadata for the table.
   * @param args      - Raw arguments from the MCP tool call.
   * @param mode      - `'select'` for row-level reads, `'aggregate'` for
   *                    COUNT / SUM / AVG / MIN / MAX summaries.
   * @returns An array of result rows.
   */
  async execute(
    table: string,
    tableInfo: TableInfo,
    args: Record<string, unknown>,
    mode: QueryMode,
  ): Promise<Row[]> {
    // Validate that the table name matches the schema info (whitelist).
    if (tableInfo.name !== table) {
      throw new McpServerError(
        `Table name mismatch: expected "${tableInfo.name}", got "${table}"`,
        'This is an internal error — the tool definition may be out of sync with the schema',
      );
    }

    const query =
      mode === 'aggregate'
        ? buildAggregateQuery(table, tableInfo, args)
        : buildSelectQuery(table, tableInfo, args);

    try {
      const result: QueryResult<Row> = await this.pool.query(query.text, query.values);
      return result.rows;
    } catch (error) {
      throw new McpServerError(
        `Query failed on table "${table}": ${error instanceof Error ? error.message : String(error)}`,
        'Check that the database schema matches the introspected model',
        error instanceof Error ? error : undefined,
      );
    }
  }
}
