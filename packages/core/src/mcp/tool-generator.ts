/**
 * MCP Tool Generator
 *
 * Reads a normalised SchemaModel and produces MCP tool definitions with
 * smart parameter inference based on column types. Each table gets a read
 * tool (get_{table}) and, when numeric columns are present, an aggregate
 * tool (get_{table}_summary).
 */

import type {
  SchemaModel,
  TableInfo,
  ColumnInfo,
  ColumnType,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** JSON Schema property descriptor used inside an MCP tool's inputSchema. */
export interface JsonSchemaProperty {
  type: string;
  description: string;
  default?: unknown;
  enum?: string[];
  format?: string;
  minimum?: number;
}

/** The inputSchema for an MCP tool (a JSON Schema "object"). */
export interface McpToolInputSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/** A fully-formed MCP tool definition ready for registration. */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: McpToolInputSchema;
}

// ---------------------------------------------------------------------------
// Column-type classification helpers
// ---------------------------------------------------------------------------

const DATE_TYPES: ReadonlySet<ColumnType> = new Set([
  'timestamptz',
  'timestamp',
  'date',
]);

const NUMERIC_TYPES: ReadonlySet<ColumnType> = new Set([
  'integer',
  'bigint',
  'smallint',
  'decimal',
  'float',
  'double',
]);

const TEXT_TYPES: ReadonlySet<ColumnType> = new Set([
  'text',
  'varchar',
  'char',
]);

function isDateColumn(col: ColumnInfo): boolean {
  return DATE_TYPES.has(col.type);
}

function isNumericColumn(col: ColumnInfo): boolean {
  return NUMERIC_TYPES.has(col.type);
}

function isTextColumn(col: ColumnInfo): boolean {
  return TEXT_TYPES.has(col.type);
}

function isBooleanColumn(col: ColumnInfo): boolean {
  return col.type === 'boolean';
}

function isEnumColumn(col: ColumnInfo): boolean {
  return col.type === 'enum' && Array.isArray(col.enumValues) && col.enumValues.length > 0;
}

// ---------------------------------------------------------------------------
// Human-readable helpers
// ---------------------------------------------------------------------------

/** Convert snake_case table/column name to a human-readable label. */
function humanise(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Build a concise sentence describing the column for tool descriptions. */
function describeColumn(col: ColumnInfo): string {
  if (col.comment) return col.comment;
  const label = humanise(col.name);
  if (isEnumColumn(col)) return `${label} (one of: ${col.enumValues!.join(', ')})`;
  if (isDateColumn(col)) return `${label} (date/timestamp)`;
  if (isNumericColumn(col)) return `${label} (numeric)`;
  if (isBooleanColumn(col)) return label;
  return label;
}

// ---------------------------------------------------------------------------
// FK lookup helper
// ---------------------------------------------------------------------------

function isForeignKeyColumn(table: TableInfo, columnName: string): boolean {
  return table.foreignKeys.some((fk) => fk.columns.includes(columnName));
}

// ---------------------------------------------------------------------------
// Parameter builders
// ---------------------------------------------------------------------------

/**
 * Infer the set of filter parameters for a single column based on its type,
 * whether it is a FK, and its enum values.
 */
function buildColumnParameters(
  table: TableInfo,
  col: ColumnInfo,
): Record<string, JsonSchemaProperty> {
  const params: Record<string, JsonSchemaProperty> = {};

  // ── Date / Timestamp → range filters ──────────────────────────────────
  if (isDateColumn(col)) {
    params[`start_${col.name}`] = {
      type: 'string',
      format: 'date',
      description: `Start date for ${describeColumn(col)} range (inclusive, ISO 8601)`,
    };
    params[`end_${col.name}`] = {
      type: 'string',
      format: 'date',
      description: `End date for ${describeColumn(col)} range (inclusive, ISO 8601)`,
    };
    return params;
  }

  // ── Enum → exact match with allowed values ────────────────────────────
  if (isEnumColumn(col)) {
    params[col.name] = {
      type: 'string',
      description: `Filter by ${describeColumn(col)}`,
      enum: col.enumValues!,
    };
    return params;
  }

  // ── Numeric → min/max range filters ───────────────────────────────────
  if (isNumericColumn(col)) {
    // FK columns get exact-match instead of range
    if (isForeignKeyColumn(table, col.name)) {
      params[col.name] = {
        type: 'number',
        description: `Filter by exact ${humanise(col.name)} (foreign key)`,
      };
      return params;
    }

    params[`min_${col.name}`] = {
      type: 'number',
      description: `Minimum value for ${humanise(col.name)} (inclusive)`,
    };
    params[`max_${col.name}`] = {
      type: 'number',
      description: `Maximum value for ${humanise(col.name)} (inclusive)`,
    };
    return params;
  }

  // ── Text / Varchar → substring match via ILIKE ────────────────────────
  if (isTextColumn(col)) {
    params[col.name] = {
      type: 'string',
      description: `Filter by ${humanise(col.name)} (substring match, case-insensitive)`,
    };
    return params;
  }

  // ── Boolean → exact match ─────────────────────────────────────────────
  if (isBooleanColumn(col)) {
    params[col.name] = {
      type: 'boolean',
      description: `Filter by ${humanise(col.name)}`,
    };
    return params;
  }

  // ── UUID FK → exact match ─────────────────────────────────────────────
  if (isForeignKeyColumn(table, col.name)) {
    params[col.name] = {
      type: 'string',
      description: `Filter by exact ${humanise(col.name)} (foreign key)`,
    };
    return params;
  }

  return params;
}

// ---------------------------------------------------------------------------
// Pagination parameters (shared by all tools)
// ---------------------------------------------------------------------------

function paginationProperties(): Record<string, JsonSchemaProperty> {
  return {
    limit: {
      type: 'integer',
      description: 'Maximum number of rows to return',
      default: 50,
      minimum: 1,
    },
    offset: {
      type: 'integer',
      description: 'Number of rows to skip (for pagination)',
      default: 0,
      minimum: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Tool builders
// ---------------------------------------------------------------------------

/**
 * Build the "get_{table}" read tool for a table.
 */
function buildReadTool(table: TableInfo): McpToolDefinition {
  const properties: Record<string, JsonSchemaProperty> = {};

  for (const col of table.columns) {
    // Skip generated / auto-increment columns from filters — they are
    // internal identifiers that callers rarely filter on directly, unless
    // they are FKs or PKs.
    if (col.isGenerated) continue;

    const colParams = buildColumnParameters(table, col);
    Object.assign(properties, colParams);
  }

  Object.assign(properties, paginationProperties());

  const tableLabel = humanise(table.name);
  const description = table.comment
    ? `Query ${tableLabel} records. ${table.comment}`
    : `Query ${tableLabel} records with smart filters, pagination, and sorting.`;

  return {
    name: `get_${table.name}`,
    description,
    inputSchema: {
      type: 'object',
      properties,
    },
  };
}

/**
 * Build the "get_{table}_summary" aggregate tool for a table.
 * Only generated when the table contains at least one numeric column.
 */
function buildAggregateTool(table: TableInfo): McpToolDefinition | null {
  const numericCols = table.columns.filter(
    (c) => isNumericColumn(c) && !c.isGenerated && !isForeignKeyColumn(table, c.name),
  );

  if (numericCols.length === 0) return null;

  // Build the same filter properties as the read tool so that aggregates
  // can be scoped by any filter.
  const properties: Record<string, JsonSchemaProperty> = {};

  for (const col of table.columns) {
    if (col.isGenerated) continue;
    const colParams = buildColumnParameters(table, col);
    Object.assign(properties, colParams);
  }

  // Add a group_by parameter listing eligible columns (enums, booleans,
  // FKs, and date columns are reasonable grouping candidates).
  const groupCandidates = table.columns
    .filter(
      (c) =>
        isEnumColumn(c) ||
        isBooleanColumn(c) ||
        isDateColumn(c) ||
        isForeignKeyColumn(table, c.name),
    )
    .map((c) => c.name);

  if (groupCandidates.length > 0) {
    properties['group_by'] = {
      type: 'string',
      description: `Column to group results by (one of: ${groupCandidates.join(', ')})`,
      enum: groupCandidates,
    };
  }

  // Pagination still applies to aggregate results
  Object.assign(properties, paginationProperties());

  const tableLabel = humanise(table.name);
  const numericLabels = numericCols.map((c) => humanise(c.name)).join(', ');
  const description =
    `Get aggregate statistics (count, sum, avg, min, max) for ${tableLabel}. ` +
    `Numeric columns: ${numericLabels}.`;

  return {
    name: `get_${table.name}_summary`,
    description,
    inputSchema: {
      type: 'object',
      properties,
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate MCP tool definitions for every table in the schema.
 *
 * For each table two tools are considered:
 *  - `get_{table}` — always created (read / filter tool)
 *  - `get_{table}_summary` — created only when numeric columns exist
 *
 * @param schema - The normalised database schema model.
 * @returns An array of MCP tool definitions ready for server registration.
 */
export function generateTools(schema: SchemaModel): McpToolDefinition[] {
  const tools: McpToolDefinition[] = [];

  for (const table of schema.tables) {
    tools.push(buildReadTool(table));

    const aggregate = buildAggregateTool(table);
    if (aggregate) {
      tools.push(aggregate);
    }
  }

  return tools;
}
