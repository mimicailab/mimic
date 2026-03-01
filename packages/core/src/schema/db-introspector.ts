/**
 * Live PostgreSQL database introspector.
 *
 * Queries `information_schema` and `pg_catalog` views to build a normalised
 * `SchemaModel` from a running database. This is the most reliable schema
 * source since it reads the ground truth directly from PostgreSQL's system
 * catalogues.
 *
 * Key design decisions:
 * - Uses `udt_name` (NOT `data_type`) for type mapping — `data_type` returns
 *   `'USER-DEFINED'` for enums and `'ARRAY'` for arrays, which is useless.
 * - Auto-increment detection: `column_default LIKE 'nextval(%'` (SERIAL) or
 *   `is_identity = 'YES'` (IDENTITY).
 * - Per-table detail queries run in parallel via `Promise.all()` for speed
 *   (target < 500ms for 20 tables).
 */

import type { Pool } from 'pg';
import type {
  SchemaModel,
  TableInfo,
  ColumnInfo,
  ColumnType,
  ForeignKey,
  EnumInfo,
} from '../types/schema.js';
import { topologicalSort } from './topo-sort.js';
import { SchemaParseError, DatabaseConnectionError } from '../utils/index.js';

// ─── udt_name → ColumnType mapping ──────────────────────────────────────────

const UDT_TYPE_MAP: Record<string, { columnType: ColumnType; pgType: string }> = {
  int4: { columnType: 'integer', pgType: 'int4' },
  int8: { columnType: 'bigint', pgType: 'int8' },
  int2: { columnType: 'smallint', pgType: 'int2' },
  float4: { columnType: 'float', pgType: 'float4' },
  float8: { columnType: 'double', pgType: 'float8' },
  numeric: { columnType: 'decimal', pgType: 'numeric' },
  varchar: { columnType: 'varchar', pgType: 'varchar' },
  text: { columnType: 'text', pgType: 'text' },
  bpchar: { columnType: 'char', pgType: 'bpchar' },
  bool: { columnType: 'boolean', pgType: 'bool' },
  timestamptz: { columnType: 'timestamptz', pgType: 'timestamptz' },
  timestamp: { columnType: 'timestamp', pgType: 'timestamp' },
  date: { columnType: 'date', pgType: 'date' },
  time: { columnType: 'time', pgType: 'time' },
  timetz: { columnType: 'time', pgType: 'timetz' },
  uuid: { columnType: 'uuid', pgType: 'uuid' },
  json: { columnType: 'json', pgType: 'json' },
  jsonb: { columnType: 'jsonb', pgType: 'jsonb' },
  bytea: { columnType: 'bytea', pgType: 'bytea' },
};

/**
 * Map a PostgreSQL `udt_name` to our normalised ColumnType.
 * Handles user-defined enums and array types (udt_name starts with `_`).
 */
function mapUdtName(
  udtName: string,
  enumNames: Set<string>,
): { columnType: ColumnType; pgType: string } {
  // Array types: udt_name starts with underscore (e.g. `_int4`, `_text`)
  if (udtName.startsWith('_')) {
    const elementType = udtName.slice(1);
    const mapped = UDT_TYPE_MAP[elementType];
    if (mapped) {
      return { columnType: 'array', pgType: udtName };
    }
    if (enumNames.has(elementType)) {
      return { columnType: 'array', pgType: udtName };
    }
    return { columnType: 'array', pgType: udtName };
  }

  // Check if it's a known enum
  if (enumNames.has(udtName)) {
    return { columnType: 'enum', pgType: udtName };
  }

  // Standard type mapping
  const mapped = UDT_TYPE_MAP[udtName];
  if (mapped) return mapped;

  // Fallback
  return { columnType: 'unknown', pgType: udtName };
}

// ─── SQL queries ─────────────────────────────────────────────────────────────

/** Fetch all user tables in the given schema. */
const TABLES_QUERY = `
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = $1
    AND table_type = 'BASE TABLE'
  ORDER BY table_name;
`;

/** Fetch columns for a specific table, ordered by ordinal position. */
const COLUMNS_QUERY = `
  SELECT
    c.column_name,
    c.udt_name,
    c.is_nullable,
    c.column_default,
    c.character_maximum_length,
    c.numeric_precision,
    c.numeric_scale,
    c.is_identity,
    c.identity_generation,
    c.generation_expression,
    c.is_generated
  FROM information_schema.columns c
  WHERE c.table_schema = $1
    AND c.table_name = $2
  ORDER BY c.ordinal_position;
`;

/** Fetch primary key columns for a specific table. */
const PRIMARY_KEY_QUERY = `
  SELECT kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
    AND tc.table_name = kcu.table_name
  WHERE tc.table_schema = $1
    AND tc.table_name = $2
    AND tc.constraint_type = 'PRIMARY KEY'
  ORDER BY kcu.ordinal_position;
`;

/** Fetch foreign key constraints for a specific table. */
const FOREIGN_KEYS_QUERY = `
  SELECT
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name AS referenced_table,
    ccu.column_name AS referenced_column,
    rc.delete_rule,
    rc.update_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
    AND tc.table_name = kcu.table_name
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
    AND tc.table_schema = ccu.table_schema
  JOIN information_schema.referential_constraints rc
    ON tc.constraint_name = rc.constraint_name
    AND tc.table_schema = rc.constraint_schema
  WHERE tc.table_schema = $1
    AND tc.table_name = $2
    AND tc.constraint_type = 'FOREIGN KEY'
  ORDER BY tc.constraint_name, kcu.ordinal_position;
`;

/** Fetch unique constraints for a specific table. */
const UNIQUE_CONSTRAINTS_QUERY = `
  SELECT
    tc.constraint_name,
    kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
    AND tc.table_name = kcu.table_name
  WHERE tc.table_schema = $1
    AND tc.table_name = $2
    AND tc.constraint_type = 'UNIQUE'
  ORDER BY tc.constraint_name, kcu.ordinal_position;
`;

/** Fetch check constraints for a specific table. */
const CHECK_CONSTRAINTS_QUERY = `
  SELECT
    tc.constraint_name,
    cc.check_clause
  FROM information_schema.table_constraints tc
  JOIN information_schema.check_constraints cc
    ON tc.constraint_name = cc.constraint_name
    AND tc.constraint_schema = cc.constraint_schema
  WHERE tc.table_schema = $1
    AND tc.table_name = $2
    AND tc.constraint_type = 'CHECK'
    AND tc.constraint_name NOT LIKE '%_not_null'
  ORDER BY tc.constraint_name;
`;

/**
 * Fetch all enum types and their values from pg_catalog.
 * This is the most reliable way to enumerate custom enum types.
 */
const ENUMS_QUERY = `
  SELECT
    t.typname AS enum_name,
    e.enumlabel AS enum_value
  FROM pg_catalog.pg_type t
  JOIN pg_catalog.pg_enum e ON t.oid = e.enumtypid
  JOIN pg_catalog.pg_namespace n ON t.typnamespace = n.oid
  WHERE n.nspname = $1
  ORDER BY t.typname, e.enumsortorder;
`;

/** Fetch column comments from pg_catalog. */
const COLUMN_COMMENTS_QUERY = `
  SELECT
    a.attname AS column_name,
    d.description AS comment
  FROM pg_catalog.pg_description d
  JOIN pg_catalog.pg_attribute a ON d.objoid = a.attrelid AND d.objsubid = a.attnum
  JOIN pg_catalog.pg_class c ON a.attrelid = c.oid
  JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = $1
    AND c.relname = $2
    AND a.attnum > 0
    AND NOT a.attisdropped;
`;

/** Fetch table comment from pg_catalog. */
const TABLE_COMMENT_QUERY = `
  SELECT
    d.description AS comment
  FROM pg_catalog.pg_description d
  JOIN pg_catalog.pg_class c ON d.objoid = c.oid AND d.objsubid = 0
  JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = $1
    AND c.relname = $2;
`;

// ─── FK action mapping ───────────────────────────────────────────────────────

function mapFkRule(rule: string | null): ForeignKey['onDelete'] {
  switch (rule) {
    case 'CASCADE':
      return 'CASCADE';
    case 'SET NULL':
      return 'SET NULL';
    case 'RESTRICT':
      return 'RESTRICT';
    case 'NO ACTION':
      return 'NO ACTION';
    default:
      return undefined;
  }
}

// ─── Per-table detail fetcher ────────────────────────────────────────────────

interface RawColumnRow {
  column_name: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  is_identity: string;
  identity_generation: string | null;
  generation_expression: string | null;
  is_generated: string;
}

interface RawFkRow {
  constraint_name: string;
  column_name: string;
  referenced_table: string;
  referenced_column: string;
  delete_rule: string;
  update_rule: string;
}

interface RawUniqueRow {
  constraint_name: string;
  column_name: string;
}

interface RawCheckRow {
  constraint_name: string;
  check_clause: string;
}

interface RawCommentRow {
  column_name: string;
  comment: string;
}

/**
 * Fetch all detail information for a single table. This function is designed
 * to be called in parallel for each table via `Promise.all()`.
 */
async function fetchTableDetails(
  pool: Pool,
  schemaName: string,
  tableName: string,
  enumNames: Set<string>,
  enumValueMap: Map<string, string[]>,
): Promise<TableInfo> {
  // Run all per-table queries in parallel
  const [
    columnsResult,
    pkResult,
    fkResult,
    uniqueResult,
    checkResult,
    colCommentsResult,
    tableCommentResult,
  ] = await Promise.all([
    pool.query<RawColumnRow>(COLUMNS_QUERY, [schemaName, tableName]),
    pool.query<{ column_name: string }>(PRIMARY_KEY_QUERY, [schemaName, tableName]),
    pool.query<RawFkRow>(FOREIGN_KEYS_QUERY, [schemaName, tableName]),
    pool.query<RawUniqueRow>(UNIQUE_CONSTRAINTS_QUERY, [schemaName, tableName]),
    pool.query<RawCheckRow>(CHECK_CONSTRAINTS_QUERY, [schemaName, tableName]),
    pool.query<RawCommentRow>(COLUMN_COMMENTS_QUERY, [schemaName, tableName]),
    pool.query<{ comment: string }>(TABLE_COMMENT_QUERY, [schemaName, tableName]),
  ]);

  // ── Build column comment map ────────────────────────────────────────
  const commentMap = new Map<string, string>();
  for (const row of colCommentsResult.rows) {
    commentMap.set(row.column_name, row.comment);
  }

  // ── Map columns ─────────────────────────────────────────────────────
  const columns: ColumnInfo[] = columnsResult.rows.map((row) => {
    const { columnType, pgType } = mapUdtName(row.udt_name, enumNames);

    const columnDefault = row.column_default;
    const isAutoIncrement =
      (columnDefault !== null && columnDefault.startsWith('nextval(')) ||
      row.is_identity === 'YES';

    const isGenerated = row.is_generated === 'ALWAYS' || row.generation_expression !== null;

    const hasDefault = columnDefault !== null || isAutoIncrement || isGenerated;

    const col: ColumnInfo = {
      name: row.column_name,
      type: columnType,
      pgType,
      isNullable: row.is_nullable === 'YES',
      hasDefault,
      defaultValue: columnDefault ?? undefined,
      isAutoIncrement,
      isGenerated,
    };

    // Optional fields
    if (row.character_maximum_length !== null) {
      col.maxLength = row.character_maximum_length;
    }
    if (row.numeric_precision !== null) {
      col.precision = row.numeric_precision;
    }
    if (row.numeric_scale !== null) {
      col.scale = row.numeric_scale;
    }

    // Enum values
    if (columnType === 'enum') {
      col.enumValues = enumValueMap.get(row.udt_name);
    }

    // Column comment
    const comment = commentMap.get(row.column_name);
    if (comment) {
      col.comment = comment;
    }

    return col;
  });

  // ── Primary key ─────────────────────────────────────────────────────
  const primaryKey = pkResult.rows.map((row) => row.column_name);

  // ── Foreign keys (grouped by constraint name) ───────────────────────
  const fkGroups = new Map<string, { columns: string[]; refTable: string; refColumns: string[]; deleteRule: string; updateRule: string }>();
  for (const row of fkResult.rows) {
    let group = fkGroups.get(row.constraint_name);
    if (!group) {
      group = {
        columns: [],
        refTable: row.referenced_table,
        refColumns: [],
        deleteRule: row.delete_rule,
        updateRule: row.update_rule,
      };
      fkGroups.set(row.constraint_name, group);
    }
    if (!group.columns.includes(row.column_name)) {
      group.columns.push(row.column_name);
    }
    if (!group.refColumns.includes(row.referenced_column)) {
      group.refColumns.push(row.referenced_column);
    }
  }

  const foreignKeys: ForeignKey[] = [...fkGroups.values()].map((g) => ({
    columns: g.columns,
    referencedTable: g.refTable,
    referencedColumns: g.refColumns,
    onDelete: mapFkRule(g.deleteRule),
    onUpdate: mapFkRule(g.updateRule),
  }));

  // ── Unique constraints (grouped by constraint name) ─────────────────
  const uniqueGroups = new Map<string, string[]>();
  for (const row of uniqueResult.rows) {
    let group = uniqueGroups.get(row.constraint_name);
    if (!group) {
      group = [];
      uniqueGroups.set(row.constraint_name, group);
    }
    group.push(row.column_name);
  }
  const uniqueConstraints = [...uniqueGroups.values()];

  // ── Check constraints ───────────────────────────────────────────────
  const checkConstraints = checkResult.rows.map((row) => row.check_clause);

  // ── Table comment ───────────────────────────────────────────────────
  const tableComment = tableCommentResult.rows[0]?.comment;

  return {
    name: tableName,
    columns,
    primaryKey,
    foreignKeys,
    uniqueConstraints,
    checkConstraints,
    comment: tableComment,
  };
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Introspect a live PostgreSQL database and return a normalised `SchemaModel`.
 *
 * @param pool - A `pg.Pool` instance connected to the target database.
 * @param schema - PostgreSQL schema name (defaults to `'public'`).
 * @returns A fully populated `SchemaModel` with tables, enums, and insertion order.
 * @throws DatabaseConnectionError if the database cannot be reached.
 * @throws SchemaParseError if introspection queries fail.
 */
export async function introspectDatabase(
  pool: Pool,
  schema: string = 'public',
): Promise<SchemaModel> {
  // ── Verify connectivity ─────────────────────────────────────────────
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    throw new DatabaseConnectionError(
      'Cannot connect to PostgreSQL database',
      'Check your DATABASE_URL and ensure the database server is running.',
      err instanceof Error ? err : new Error(String(err)),
    );
  }

  try {
    // ── Fetch enums ─────────────────────────────────────────────────────
    const enumResult = await pool.query<{ enum_name: string; enum_value: string }>(
      ENUMS_QUERY,
      [schema],
    );

    const enumMap = new Map<string, string[]>();
    for (const row of enumResult.rows) {
      let values = enumMap.get(row.enum_name);
      if (!values) {
        values = [];
        enumMap.set(row.enum_name, values);
      }
      values.push(row.enum_value);
    }

    const enums: EnumInfo[] = [...enumMap.entries()].map(([name, values]) => ({
      name,
      values,
    }));

    const enumNames = new Set(enumMap.keys());

    // ── Fetch table list ────────────────────────────────────────────────
    const tablesResult = await pool.query<{ table_name: string }>(
      TABLES_QUERY,
      [schema],
    );
    const tableNames = tablesResult.rows.map((r) => r.table_name);

    if (tableNames.length === 0) {
      return { tables: [], enums, insertionOrder: [] };
    }

    // ── Fetch all table details in parallel ─────────────────────────────
    const tables = await Promise.all(
      tableNames.map((name) =>
        fetchTableDetails(pool, schema, name, enumNames, enumMap),
      ),
    );

    // ── Topological sort ────────────────────────────────────────────────
    const insertionOrder = topologicalSort(tables);

    return { tables, enums, insertionOrder };
  } catch (err) {
    // Re-throw our own errors
    if (err instanceof DatabaseConnectionError || err instanceof SchemaParseError) {
      throw err;
    }

    throw new SchemaParseError(
      'Failed to introspect database schema',
      'Ensure the database user has SELECT privileges on information_schema and pg_catalog.',
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
