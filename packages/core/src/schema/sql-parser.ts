/**
 * SQL DDL parser.
 *
 * Converts PostgreSQL DDL (CREATE TABLE / CREATE TYPE / COMMENT ON) into the
 * normalised `SchemaModel` representation using `pgsql-parser` (libpg_query
 * WASM binding).
 *
 * The parser is wrapped in a try/catch because `pgsql-parser` relies on a
 * native WASM binary that may fail to load on some platforms (notably certain
 * ARM configurations). When that happens a clear error with remediation hints
 * is thrown.
 */

import type {
  SchemaModel,
  TableInfo,
  ColumnInfo,
  ColumnType,
  ForeignKey,
  EnumInfo,
} from '../types/schema.js';
import { topologicalSort } from './topo-sort.js';
import { SchemaParseError } from '../utils/index.js';

// ─── pgType → ColumnType mapping ─────────────────────────────────────────────

const PG_TYPE_MAP: Record<string, { columnType: ColumnType; pgType: string }> = {
  int4: { columnType: 'integer', pgType: 'int4' },
  int8: { columnType: 'bigint', pgType: 'int8' },
  int2: { columnType: 'smallint', pgType: 'int2' },
  float4: { columnType: 'float', pgType: 'float4' },
  float8: { columnType: 'double', pgType: 'float8' },
  numeric: { columnType: 'decimal', pgType: 'numeric' },
  varchar: { columnType: 'varchar', pgType: 'varchar' },
  text: { columnType: 'text', pgType: 'text' },
  bpchar: { columnType: 'char', pgType: 'bpchar' },
  char: { columnType: 'char', pgType: 'bpchar' },
  bool: { columnType: 'boolean', pgType: 'bool' },
  boolean: { columnType: 'boolean', pgType: 'bool' },
  timestamptz: { columnType: 'timestamptz', pgType: 'timestamptz' },
  timestamp: { columnType: 'timestamp', pgType: 'timestamp' },
  date: { columnType: 'date', pgType: 'date' },
  time: { columnType: 'time', pgType: 'time' },
  timetz: { columnType: 'time', pgType: 'timetz' },
  uuid: { columnType: 'uuid', pgType: 'uuid' },
  json: { columnType: 'json', pgType: 'json' },
  jsonb: { columnType: 'jsonb', pgType: 'jsonb' },
  bytea: { columnType: 'bytea', pgType: 'bytea' },
  // Aliases commonly found in DDL
  integer: { columnType: 'integer', pgType: 'int4' },
  bigint: { columnType: 'bigint', pgType: 'int8' },
  smallint: { columnType: 'smallint', pgType: 'int2' },
  serial: { columnType: 'integer', pgType: 'int4' },
  bigserial: { columnType: 'bigint', pgType: 'int8' },
  smallserial: { columnType: 'smallint', pgType: 'int2' },
  real: { columnType: 'float', pgType: 'float4' },
  'double precision': { columnType: 'double', pgType: 'float8' },
  decimal: { columnType: 'decimal', pgType: 'numeric' },
};

// ─── AST helpers ─────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Resolve a type name from the pgsql-parser AST's `TypeName` node.
 * Returns the final type string (e.g. `int4`, `varchar`, `timestamptz`).
 */
function resolveTypeName(typeNode: any): { typeName: string; isArray: boolean; maxLength?: number; precision?: number; scale?: number } {
  if (!typeNode) return { typeName: 'text', isArray: false };

  const names: string[] = (typeNode.names ?? [])
    .map((n: any) => {
      if (typeof n === 'string') return n;
      if (n.String) return n.String.sval ?? n.String.str;
      if (n.str) return n.str;
      if (n.sval) return n.sval;
      return '';
    })
    .filter((s: string) => s !== 'pg_catalog' && s !== 'public' && s !== '');

  const typeName = names[names.length - 1] ?? 'text';

  // Check for array type modifier
  const isArray = (typeNode.arrayBounds ?? []).length > 0;

  // Extract type modifiers (precision, scale, length)
  let maxLength: number | undefined;
  let precision: number | undefined;
  let scale: number | undefined;

  const typmods = typeNode.typmods ?? [];
  if (typmods.length > 0) {
    const first = typmods[0];
    const val = extractIntegerValue(first);
    if (val !== undefined) {
      if (typeName === 'varchar' || typeName === 'bpchar' || typeName === 'char') {
        maxLength = val;
      } else if (typeName === 'numeric' || typeName === 'decimal') {
        precision = val;
        if (typmods.length > 1) {
          scale = extractIntegerValue(typmods[1]);
        }
      }
    }
  }

  return { typeName, isArray, maxLength, precision, scale };
}

function extractIntegerValue(node: any): number | undefined {
  if (!node) return undefined;
  if (node.Integer) return node.Integer.ival;
  if (node.ival !== undefined) return node.ival;
  if (node.A_Const) {
    if (node.A_Const.ival) return node.A_Const.ival.ival ?? node.A_Const.ival;
    if (node.A_Const.val?.Integer) return node.A_Const.val.Integer.ival;
  }
  return undefined;
}

/**
 * Resolve a RangeVar (table reference) to a plain table name string.
 */
function resolveRangeVar(rv: any): string {
  if (!rv) return '';
  return rv.relname ?? rv.RangeVar?.relname ?? '';
}

/**
 * Map a resolved pg type name to our ColumnType + pgType.
 */
function mapColumnType(
  typeName: string,
  isArray: boolean,
  enumNames: Set<string>,
): { columnType: ColumnType; pgType: string } {
  if (enumNames.has(typeName)) {
    return isArray
      ? { columnType: 'array', pgType: `_${typeName}` }
      : { columnType: 'enum', pgType: typeName };
  }

  const mapped = PG_TYPE_MAP[typeName];
  if (mapped) {
    return isArray
      ? { columnType: 'array', pgType: `_${mapped.pgType}` }
      : mapped;
  }

  return isArray
    ? { columnType: 'array', pgType: `_${typeName}` }
    : { columnType: 'unknown', pgType: typeName };
}

/**
 * Check whether a column default expression implies auto-increment (serial).
 */
function isAutoIncrementDefault(defaultExpr: any): boolean {
  if (!defaultExpr) return false;
  const str = deparseFuncCall(defaultExpr);
  return str.startsWith('nextval(');
}

/**
 * Attempt a best-effort text representation of a function call default.
 */
function deparseFuncCall(node: any): string {
  if (!node) return '';
  if (node.FuncCall) {
    const funcNames = (node.FuncCall.funcname ?? [])
      .map((n: any) => n.String?.sval ?? n.String?.str ?? n.str ?? n.sval ?? '')
      .filter(Boolean);
    return `${funcNames.join('.')}()`;
  }
  if (node.SQLValueFunction) {
    return 'now()';
  }
  if (node.TypeCast) {
    return deparseFuncCall(node.TypeCast.arg);
  }
  return '';
}

/**
 * Convert a constraint action enum from pgsql-parser to our FK action type.
 */
function mapFkAction(action: string | undefined): ForeignKey['onDelete'] {
  switch (action) {
    case 'FKCONSTR_ACTION_CASCADE':
    case 'a':
      return 'CASCADE';
    case 'FKCONSTR_ACTION_SETNULL':
    case 'n':
      return 'SET NULL';
    case 'FKCONSTR_ACTION_RESTRICT':
    case 'r':
      return 'RESTRICT';
    case 'FKCONSTR_ACTION_NOACTION':
    case 'd':
      return 'NO ACTION';
    default:
      return undefined;
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Statement processors ────────────────────────────────────────────────────

function processCreateEnum(
  stmt: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  enums: EnumInfo[],
  enumNames: Set<string>,
): void {
  const createEnum = stmt.CreateEnumStmt ?? stmt;
  const typeNames: string[] = (createEnum.typeName ?? [])
    .map((n: any) => n.String?.sval ?? n.String?.str ?? n.str ?? n.sval ?? '') // eslint-disable-line @typescript-eslint/no-explicit-any
    .filter((s: string) => s !== 'pg_catalog' && s !== 'public' && s !== '');

  const enumName = typeNames[typeNames.length - 1] ?? '';
  if (!enumName) return;

  const values: string[] = (createEnum.vals ?? [])
    .map((v: any) => v.String?.sval ?? v.String?.str ?? v.str ?? v.sval ?? '') // eslint-disable-line @typescript-eslint/no-explicit-any
    .filter(Boolean);

  enums.push({ name: enumName, values });
  enumNames.add(enumName);
}

function processCreateTable(
  stmt: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  tableMap: Map<string, TableInfo>,
  enumNames: Set<string>,
): void {
  const createStmt = stmt.CreateStmt ?? stmt;
  const relation = createStmt.relation ?? createStmt.RangeVar;
  const tableName = resolveRangeVar(relation);
  if (!tableName) return;

  const columns: ColumnInfo[] = [];
  const foreignKeys: ForeignKey[] = [];
  const primaryKey: string[] = [];
  const uniqueConstraints: string[][] = [];
  const checkConstraints: string[] = [];

  const elements = createStmt.tableElts ?? [];

  for (const elt of elements) {
    // Column definition
    if (elt.ColumnDef) {
      const colDef = elt.ColumnDef;
      const colName: string = colDef.colname ?? '';
      const typeInfo = resolveTypeName(colDef.typeName ?? colDef.TypeName);

      const { columnType, pgType } = mapColumnType(
        typeInfo.typeName,
        typeInfo.isArray,
        enumNames,
      );

      // Check for SERIAL types → auto-increment
      const isSerial = ['serial', 'bigserial', 'smallserial'].includes(
        typeInfo.typeName.toLowerCase(),
      );

      let isNullable = true;
      let hasDefault = isSerial;
      let defaultValue: string | undefined;
      let isAutoIncrement = isSerial;
      let colPrimaryKey = false;
      const colUniqueConstraints: string[][] = [];

      // Process column-level constraints
      const constraints = colDef.constraints ?? [];
      for (const constraint of constraints) {
        const con = constraint.Constraint ?? constraint;
        const contype = con.contype;

        switch (contype) {
          case 'CONSTR_NOTNULL':
          case 0: // NOT NULL
            isNullable = false;
            break;

          case 'CONSTR_NULL':
          case 1: // explicit NULL
            isNullable = true;
            break;

          case 'CONSTR_DEFAULT':
          case 2: { // DEFAULT
            hasDefault = true;
            const rawDefault = con.raw_expr ?? con.rawExpr;
            if (rawDefault) {
              if (isAutoIncrementDefault(rawDefault)) {
                isAutoIncrement = true;
              }
              const deparsed = deparseFuncCall(rawDefault);
              if (deparsed) defaultValue = deparsed;
            }
            break;
          }

          case 'CONSTR_PRIMARY':
          case 5: // PRIMARY KEY
            colPrimaryKey = true;
            isNullable = false;
            break;

          case 'CONSTR_UNIQUE':
          case 4: // UNIQUE
            colUniqueConstraints.push([colName]);
            break;

          case 'CONSTR_FOREIGN':
          case 8: { // REFERENCES
            const refTable = resolveRangeVar(con.pktable);
            const refCols = (con.pk_attrs ?? [])
              .map((a: any) => a.String?.sval ?? a.String?.str ?? a.str ?? a.sval ?? '') // eslint-disable-line @typescript-eslint/no-explicit-any
              .filter(Boolean);

            if (refTable) {
              foreignKeys.push({
                columns: [colName],
                referencedTable: refTable,
                referencedColumns: refCols.length > 0 ? refCols : ['id'],
                onDelete: mapFkAction(con.fk_del_action),
                onUpdate: mapFkAction(con.fk_upd_action),
              });
            }
            break;
          }

          case 'CONSTR_CHECK':
          case 6: { // CHECK
            // Store the raw constraint name if available
            const conName = con.conname ?? '';
            if (conName) checkConstraints.push(conName);
            break;
          }

          case 'CONSTR_IDENTITY':
          case 10: // GENERATED ALWAYS AS IDENTITY / GENERATED BY DEFAULT AS IDENTITY
            isAutoIncrement = true;
            hasDefault = true;
            break;

          default:
            break;
        }
      }

      if (colPrimaryKey) {
        primaryKey.push(colName);
      }

      columns.push({
        name: colName,
        type: columnType,
        pgType,
        isNullable,
        hasDefault,
        defaultValue,
        isAutoIncrement,
        isGenerated: false,
        maxLength: typeInfo.maxLength,
        precision: typeInfo.precision,
        scale: typeInfo.scale,
        enumValues: columnType === 'enum' ? findEnumValues(pgType, enumNames, []) : undefined,
      });

      uniqueConstraints.push(...colUniqueConstraints);
    }

    // Table-level constraint
    if (elt.Constraint) {
      const con = elt.Constraint;
      const contype = con.contype;

      const keyColumns = (con.keys ?? con.fk_attrs ?? [])
        .map((k: any) => k.String?.sval ?? k.String?.str ?? k.str ?? k.sval ?? '') // eslint-disable-line @typescript-eslint/no-explicit-any
        .filter(Boolean);

      switch (contype) {
        case 'CONSTR_PRIMARY':
        case 5:
          primaryKey.length = 0;
          primaryKey.push(...keyColumns);
          break;

        case 'CONSTR_UNIQUE':
        case 4:
          if (keyColumns.length > 0) {
            uniqueConstraints.push(keyColumns);
          }
          break;

        case 'CONSTR_FOREIGN':
        case 8: {
          const refTable = resolveRangeVar(con.pktable);
          const refCols = (con.pk_attrs ?? [])
            .map((a: any) => a.String?.sval ?? a.String?.str ?? a.str ?? a.sval ?? '') // eslint-disable-line @typescript-eslint/no-explicit-any
            .filter(Boolean);

          const fkCols = (con.fk_attrs ?? [])
            .map((a: any) => a.String?.sval ?? a.String?.str ?? a.str ?? a.sval ?? '') // eslint-disable-line @typescript-eslint/no-explicit-any
            .filter(Boolean);

          if (refTable && fkCols.length > 0) {
            foreignKeys.push({
              columns: fkCols,
              referencedTable: refTable,
              referencedColumns: refCols.length > 0 ? refCols : ['id'],
              onDelete: mapFkAction(con.fk_del_action),
              onUpdate: mapFkAction(con.fk_upd_action),
            });
          }
          break;
        }

        case 'CONSTR_CHECK':
        case 6: {
          const conName = con.conname ?? '';
          if (conName) checkConstraints.push(conName);
          break;
        }

        default:
          break;
      }
    }
  }

  tableMap.set(tableName, {
    name: tableName,
    columns,
    primaryKey,
    foreignKeys,
    uniqueConstraints,
    checkConstraints,
  });
}

function processComment(
  stmt: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  tableMap: Map<string, TableInfo>,
): void {
  const commentStmt = stmt.CommentStmt ?? stmt;
  const objType = commentStmt.objtype;
  const comment = commentStmt.comment ?? '';

  // COMMENT ON TABLE
  if (objType === 'OBJECT_TABLE' || objType === 32) {
    const tableName = resolveListName(commentStmt.object);
    const table = tableMap.get(tableName);
    if (table) {
      table.comment = comment;
    }
  }

  // COMMENT ON COLUMN
  if (objType === 'OBJECT_COLUMN' || objType === 7) {
    const parts = resolveListParts(commentStmt.object);
    if (parts.length >= 2) {
      const tableName = parts[parts.length - 2];
      const colName = parts[parts.length - 1];
      const table = tableMap.get(tableName);
      if (table) {
        const col = table.columns.find((c) => c.name === colName);
        if (col) {
          col.comment = comment;
        }
      }
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveListName(obj: any): string {
  const parts = resolveListParts(obj);
  return parts[parts.length - 1] ?? '';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveListParts(obj: any): string[] {
  if (!obj) return [];
  // pgsql-parser may represent the object as a list of String nodes
  if (Array.isArray(obj)) {
    return obj
      .map((n: any) => n.String?.sval ?? n.String?.str ?? n.str ?? n.sval ?? '') // eslint-disable-line @typescript-eslint/no-explicit-any
      .filter(Boolean);
  }
  // Or as a single RangeVar
  const name = resolveRangeVar(obj);
  return name ? [name] : [];
}

function findEnumValues(
  _pgType: string,
  _enumNames: Set<string>,
  _enums: EnumInfo[],
): string[] | undefined {
  // This is a placeholder — in the SQL parser context, enum values are
  // populated after the full parse when we have all enums collected.
  return undefined;
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Parse a PostgreSQL DDL string and return a normalised `SchemaModel`.
 *
 * This function dynamically imports `pgsql-parser` and wraps the call in a
 * try/catch to gracefully handle platforms where the WASM binary fails to load.
 *
 * @param sql - Raw SQL DDL (CREATE TABLE, CREATE TYPE, COMMENT ON, etc.).
 * @returns A fully populated `SchemaModel` with tables, enums, and insertion order.
 * @throws SchemaParseError if parsing fails or pgsql-parser cannot be loaded.
 */
export async function parseSQLSchema(sql: string): Promise<SchemaModel> {
  // Dynamic import with platform-safety catch
  let parse: (sql: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const mod = await import('pgsql-parser');
    parse = mod.parse ?? mod.default?.parse ?? mod.default;
  } catch (err) {
    throw new SchemaParseError(
      'Failed to load pgsql-parser. This library requires a WASM binary that may not be available on your platform.',
      'Try running on an x86_64 Linux or macOS machine, or use the "introspect" schema source instead.',
      err instanceof Error ? err : new Error(String(err)),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ast: { stmts: any[] };
  try {
    ast = parse(sql);
  } catch (err) {
    throw new SchemaParseError(
      'Failed to parse SQL DDL',
      'Check your SQL file for syntax errors. Ensure it contains valid PostgreSQL DDL statements.',
      err instanceof Error ? err : new Error(String(err)),
    );
  }

  const statements = ast.stmts ?? [];
  const enums: EnumInfo[] = [];
  const enumNames = new Set<string>();
  const tableMap = new Map<string, TableInfo>();

  // ── Process statements in order ─────────────────────────────────────
  // Enums should be defined before tables that use them, but we do
  // multiple passes to be safe.

  for (const wrapper of statements) {
    const stmt = wrapper.stmt ?? wrapper.RawStmt?.stmt ?? wrapper;

    if (stmt.CreateEnumStmt) {
      processCreateEnum(stmt.CreateEnumStmt, enums, enumNames);
    }
  }

  for (const wrapper of statements) {
    const stmt = wrapper.stmt ?? wrapper.RawStmt?.stmt ?? wrapper;

    if (stmt.CreateStmt) {
      processCreateTable(stmt.CreateStmt, tableMap, enumNames);
    }
  }

  for (const wrapper of statements) {
    const stmt = wrapper.stmt ?? wrapper.RawStmt?.stmt ?? wrapper;

    if (stmt.CommentStmt) {
      processComment(stmt.CommentStmt, tableMap);
    }
  }

  // ── Back-fill enum values on columns ────────────────────────────────
  const enumValueMap = new Map(enums.map((e) => [e.name, e.values]));
  for (const table of tableMap.values()) {
    for (const col of table.columns) {
      if (col.type === 'enum' && !col.enumValues) {
        col.enumValues = enumValueMap.get(col.pgType);
      }
    }
  }

  const tables = [...tableMap.values()];
  const insertionOrder = topologicalSort(tables);

  return { tables, enums, insertionOrder };
}
