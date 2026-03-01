/**
 * Prisma schema parser.
 *
 * Converts a `.prisma` schema string into the normalised `SchemaModel`
 * representation using `@mrleebo/prisma-ast`.
 *
 * Handles:
 * - Enum declarations
 * - Model declarations with field-level and block-level attributes
 * - `@relation` directives (extracts FK info, skips the relation field itself)
 * - `@id` / `@@id` / `@@unique` / `@@map` / `@default` / `@updatedAt`
 * - PascalCase → snake_case conversion + naive pluralisation for table names
 * - Topological sort for insertion order
 */

import { getSchema } from '@mrleebo/prisma-ast';
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

// ─── Prisma type → ColumnType mapping ────────────────────────────────────────

const PRISMA_TYPE_MAP: Record<string, { columnType: ColumnType; pgType: string }> = {
  Int: { columnType: 'integer', pgType: 'int4' },
  BigInt: { columnType: 'bigint', pgType: 'int8' },
  Float: { columnType: 'float', pgType: 'float8' },
  Decimal: { columnType: 'decimal', pgType: 'numeric' },
  String: { columnType: 'text', pgType: 'text' },
  Boolean: { columnType: 'boolean', pgType: 'bool' },
  DateTime: { columnType: 'timestamptz', pgType: 'timestamptz' },
  Json: { columnType: 'jsonb', pgType: 'jsonb' },
  Bytes: { columnType: 'bytea', pgType: 'bytea' },
};

// ─── Naming helpers ──────────────────────────────────────────────────────────

/**
 * Convert PascalCase (or camelCase) to snake_case.
 * E.g. `UserProfile` → `user_profile`, `HTMLParser` → `html_parser`.
 */
function toSnakeCase(input: string): string {
  return input
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * Naive English pluralisation. Sufficient for typical model names.
 *
 * Rules:
 * - ends in `s`, `x`, `z`, `ch`, `sh` → append `es`
 * - ends in consonant + `y` → replace `y` with `ies`
 * - otherwise → append `s`
 */
function naivePluralize(word: string): string {
  if (word.length === 0) return word;

  const lower = word.toLowerCase();
  if (lower.endsWith('ss') || lower.endsWith('sh') || lower.endsWith('ch') || lower.endsWith('x') || lower.endsWith('z')) {
    return word + 'es';
  }
  if (lower.endsWith('y') && word.length > 1) {
    const beforeY = lower[lower.length - 2];
    const vowels = 'aeiou';
    if (!vowels.includes(beforeY)) {
      return word.slice(0, -1) + 'ies';
    }
  }
  if (lower.endsWith('s')) {
    return word;
  }
  return word + 's';
}

/**
 * Derive the PostgreSQL table name from a Prisma model name.
 * Respects `@@map("...")` if present; otherwise converts PascalCase to
 * snake_case and pluralises.
 */
function deriveTableName(modelName: string, mapName: string | undefined): string {
  if (mapName) return mapName;
  return naivePluralize(toSnakeCase(modelName));
}

// ─── AST helpers ─────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Extract the string value from an attribute argument. Handles both positional
 * and named arguments across prisma-ast versions.
 */
function getAttributeArg(attr: any, name: string): any {
  if (!attr.args) return undefined;
  for (const arg of attr.args) {
    // Named argument: { type: 'attributeArgument', value: { name, value } }
    if (arg.type === 'attributeArgument') {
      const inner = arg.value;
      if (typeof inner === 'object' && inner !== null) {
        // Object form: { type: 'keyValue', key: 'name', value: ... }
        if (inner.key === name || inner.name === name) {
          return inner.value;
        }
      }
    }
    // Some versions flatten to { name, value } directly
    if (arg.name === name || arg.key === name) {
      return arg.value;
    }
  }
  return undefined;
}

/**
 * Extract the first positional string argument from an attribute.
 * E.g. `@@map("users")` → `"users"`.
 */
function getFirstStringArg(attr: any): string | undefined {
  if (!attr.args || attr.args.length === 0) return undefined;
  const first = attr.args[0];
  if (typeof first === 'string') return first;
  if (first?.type === 'attributeArgument') {
    const val = first.value;
    if (typeof val === 'string') return val.replace(/^"|"$/g, '');
    if (typeof val === 'object' && val !== null && typeof val.value === 'string') {
      return val.value.replace(/^"|"$/g, '');
    }
  }
  return undefined;
}

/**
 * Extract an array of field name strings from a composite attribute like
 * `@@id([field1, field2])` or `@@unique([field1, field2])`.
 */
function getFieldListArg(attr: any): string[] {
  if (!attr.args) return [];
  const fields: string[] = [];
  for (const arg of attr.args) {
    const val = arg?.type === 'attributeArgument' ? arg.value : arg;
    if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string') fields.push(item);
        else if (item?.type === 'keyValue' && typeof item.key === 'string') fields.push(item.key);
        else if (typeof item?.name === 'string') fields.push(item.name);
        else if (typeof item?.value === 'string') fields.push(item.value);
      }
    } else if (typeof val === 'object' && val !== null && val.type === 'array') {
      for (const item of val.args ?? []) {
        if (typeof item === 'string') fields.push(item);
        else if (typeof item?.value === 'string') fields.push(item.value);
      }
    }
  }
  return fields;
}

/**
 * Check whether a field or block has a specific attribute (e.g. `@id`).
 */
function hasAttribute(field: any, name: string): boolean {
  if (!field.attributes) return false;
  return field.attributes.some(
    (a: any) => a.name === name || a.type === name || a.name === `@${name}`,
  );
}

/**
 * Get a specific attribute object from a field or block.
 */
function getAttribute(field: any, name: string): any | undefined {
  if (!field.attributes) return undefined;
  return field.attributes.find(
    (a: any) => a.name === name || a.type === name || a.name === `@${name}`,
  );
}

/**
 * Determine if a Prisma field is a relation field (references another model).
 * Relation fields have type = another model name and typically carry `@relation`.
 */
function isRelationField(field: any, modelNames: Set<string>): boolean {
  const fieldType = unwrapFieldType(field);
  if (modelNames.has(fieldType)) return true;
  if (hasAttribute(field, 'relation')) return true;
  return false;
}

/**
 * Unwrap optional (?) and array ([]) type modifiers to get the base type name.
 */
function unwrapFieldType(field: any): string {
  const ft = field.fieldType ?? field.type;
  if (typeof ft === 'string') return ft.replace(/[?\[\]]/g, '');
  if (typeof ft === 'object' && ft !== null) {
    return (ft.name ?? ft.type ?? '').replace(/[?\[\]]/g, '');
  }
  return '';
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Relation extraction ─────────────────────────────────────────────────────

interface RelationInfo {
  fields: string[];
  references: string[];
  referencedModel: string;
  onDelete?: string;
  onUpdate?: string;
}

/**
 * Parse the `@relation` attribute on a field to extract FK column mappings.
 */
function extractRelation(
  field: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  modelNames: Set<string>,
): RelationInfo | undefined {
  const referencedModel = unwrapFieldType(field);
  if (!modelNames.has(referencedModel)) return undefined;

  const attr = getAttribute(field, 'relation');
  if (!attr) return undefined;

  const fields = resolveStringArray(getAttributeArg(attr, 'fields'));
  const references = resolveStringArray(getAttributeArg(attr, 'references'));

  if (fields.length === 0 || references.length === 0) return undefined;

  const onDelete = resolveEnumArg(getAttributeArg(attr, 'onDelete'));
  const onUpdate = resolveEnumArg(getAttributeArg(attr, 'onUpdate'));

  return { fields, references, referencedModel, onDelete, onUpdate };
}

function resolveStringArray(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val
      .map((v: unknown) => {
        if (typeof v === 'string') return v;
        if (typeof v === 'object' && v !== null && 'name' in v) return (v as any).name as string; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (typeof v === 'object' && v !== null && 'value' in v) return (v as any).value as string; // eslint-disable-line @typescript-eslint/no-explicit-any
        return '';
      })
      .filter(Boolean);
  }
  if (typeof val === 'object' && val !== null && 'args' in val) {
    return resolveStringArray((val as any).args); // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  return [];
}

function resolveEnumArg(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val !== null && 'value' in val) {
    return (val as any).value as string; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  return undefined;
}

const FK_ACTION_MAP: Record<string, ForeignKey['onDelete']> = {
  Cascade: 'CASCADE',
  SetNull: 'SET NULL',
  Restrict: 'RESTRICT',
  NoAction: 'NO ACTION',
};

// ─── Column mapping ──────────────────────────────────────────────────────────

function mapPrismaField(
  field: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  enumNames: Set<string>,
  enumMap: Map<string, string[]>,
): ColumnInfo {
  // Respect @map("...") for the column name; fall back to the Prisma field name.
  const mapAttr = getAttribute(field, 'map');
  const name: string = (mapAttr ? getFirstStringArg(mapAttr) : undefined) ?? field.name;
  const baseType = unwrapFieldType(field);
  const isOptional = field.optional === true || (typeof field.fieldType === 'string' && field.fieldType.includes('?'));
  const isList = field.array === true || (typeof field.fieldType === 'string' && field.fieldType.includes('[]'));

  // Determine column type
  let columnType: ColumnType;
  let pgType: string;

  if (enumNames.has(baseType)) {
    columnType = 'enum';
    pgType = toSnakeCase(baseType);
  } else if (isList) {
    columnType = 'array';
    const inner = PRISMA_TYPE_MAP[baseType];
    pgType = inner ? `_${inner.pgType}` : '_text';
  } else {
    const mapped = PRISMA_TYPE_MAP[baseType];
    if (mapped) {
      columnType = mapped.columnType;
      pgType = mapped.pgType;
    } else {
      columnType = 'unknown';
      pgType = 'text';
    }
  }

  // Check for @id with autoincrement
  const isId = hasAttribute(field, 'id');
  const defaultAttr = getAttribute(field, 'default');
  let hasDefault = defaultAttr != null || hasAttribute(field, 'updatedAt');
  let defaultValue: string | undefined;
  let isAutoIncrement = false;

  if (defaultAttr) {
    const defVal = defaultAttr.args?.[0];
    if (defVal) {
      const resolved = defVal?.type === 'attributeArgument' ? defVal.value : defVal;
      if (typeof resolved === 'string') {
        if (resolved === 'autoincrement' || resolved === 'autoincrement()') {
          isAutoIncrement = true;
          hasDefault = true;
        } else if (resolved === 'uuid' || resolved === 'uuid()') {
          hasDefault = true;
          defaultValue = 'gen_random_uuid()';
        } else if (resolved === 'cuid' || resolved === 'cuid()') {
          hasDefault = true;
          defaultValue = 'gen_random_uuid()';
        } else if (resolved === 'now' || resolved === 'now()') {
          hasDefault = true;
          defaultValue = 'now()';
        } else if (resolved === 'dbgenerated') {
          hasDefault = true;
        } else {
          hasDefault = true;
          defaultValue = resolved;
        }
      } else if (typeof resolved === 'object' && resolved !== null) {
        const funcName = resolved.name ?? resolved.value ?? '';
        if (funcName === 'autoincrement') {
          isAutoIncrement = true;
          hasDefault = true;
        } else if (funcName === 'uuid') {
          hasDefault = true;
          defaultValue = 'gen_random_uuid()';
        } else if (funcName === 'cuid') {
          hasDefault = true;
          defaultValue = 'gen_random_uuid()';
        } else if (funcName === 'now') {
          hasDefault = true;
          defaultValue = 'now()';
        } else if (funcName === 'dbgenerated') {
          hasDefault = true;
        } else {
          hasDefault = true;
          defaultValue = String(funcName);
        }
      } else if (typeof resolved === 'number' || typeof resolved === 'boolean') {
        hasDefault = true;
        defaultValue = String(resolved);
      }
    }
  }

  const enumValues = enumNames.has(baseType) ? enumMap.get(baseType) : undefined;

  return {
    name,
    type: columnType,
    pgType,
    isNullable: isOptional && !isId,
    hasDefault,
    defaultValue,
    isAutoIncrement,
    isGenerated: false,
    enumValues,
  };
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Parse a Prisma schema string and return a normalised `SchemaModel`.
 *
 * @param content - Raw contents of a `.prisma` file.
 * @returns A fully populated `SchemaModel` with tables, enums, and insertion order.
 * @throws SchemaParseError if the schema cannot be parsed.
 */
export function parsePrismaSchema(content: string): SchemaModel {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ast: any;
  try {
    ast = getSchema(content);
  } catch (err) {
    throw new SchemaParseError(
      'Failed to parse Prisma schema',
      'Check your .prisma file for syntax errors',
      err instanceof Error ? err : new Error(String(err)),
    );
  }

  const blocks: any[] = ast.list ?? ast; // eslint-disable-line @typescript-eslint/no-explicit-any

  // ── First pass: collect enums ───────────────────────────────────────
  const enums: EnumInfo[] = [];
  const enumNames = new Set<string>();
  const enumMap = new Map<string, string[]>();

  for (const block of blocks) {
    if (block.type !== 'enum') continue;
    const enumName = block.name as string;
    const values: string[] = [];

    const enumerators = block.enumerators ?? block.values ?? [];
    for (const entry of enumerators) {
      if (typeof entry === 'string') {
        values.push(entry);
      } else if (entry.type === 'enumerator' || entry.type === 'enumValue') {
        values.push(entry.name ?? entry.value);
      }
    }

    enums.push({ name: toSnakeCase(enumName), values });
    enumNames.add(enumName);
    enumMap.set(enumName, values);
  }

  // ── Collect model names first (needed for relation detection) ───────
  const modelNames = new Set<string>();
  for (const block of blocks) {
    if (block.type === 'model') {
      modelNames.add(block.name as string);
    }
  }

  // ── Second pass: process models ─────────────────────────────────────
  const tables: TableInfo[] = [];

  for (const block of blocks) {
    if (block.type !== 'model') continue;

    const modelName = block.name as string;
    const properties = block.properties ?? block.members ?? [];

    // Check for @@map
    const mapAttr = properties.find(
      (p: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
        (p.type === 'attribute' && (p.name === 'map' || p.name === '@@map')) ||
        (p.type === 'break'), // skip line breaks
    );
    const mapName =
      mapAttr?.type === 'attribute' ? getFirstStringArg(mapAttr) : undefined;

    const tableName = deriveTableName(modelName, mapName);

    const columns: ColumnInfo[] = [];
    const foreignKeys: ForeignKey[] = [];
    const primaryKey: string[] = [];
    const uniqueConstraints: string[][] = [];

    // Track FK column names from @relation fields so we still produce columns for them.
    const fkColumnNames = new Set<string>();

    // Process fields
    for (const prop of properties) {
      if (prop.type !== 'field') continue;

      // Check if this is a relation field
      if (isRelationField(prop, modelNames)) {
        const rel = extractRelation(prop, modelNames);
        if (rel) {
          // Record the FK columns — they should still appear as columns
          for (const f of rel.fields) {
            fkColumnNames.add(f);
          }

          const refModelName = rel.referencedModel;
          // Find the @@map for the referenced model if it exists
          const refBlock = blocks.find(
            (b: any) => b.type === 'model' && b.name === refModelName, // eslint-disable-line @typescript-eslint/no-explicit-any
          );
          let refTableName = deriveTableName(refModelName, undefined);
          if (refBlock) {
            const refProps = refBlock.properties ?? refBlock.members ?? [];
            const refMap = refProps.find(
              (p: any) => p.type === 'attribute' && (p.name === 'map' || p.name === '@@map'), // eslint-disable-line @typescript-eslint/no-explicit-any
            );
            if (refMap) {
              const mapped = getFirstStringArg(refMap);
              if (mapped) refTableName = mapped;
            }
          }

          foreignKeys.push({
            columns: rel.fields,
            referencedTable: refTableName,
            referencedColumns: rel.references,
            onDelete: rel.onDelete ? FK_ACTION_MAP[rel.onDelete] : undefined,
            onUpdate: rel.onUpdate ? FK_ACTION_MAP[rel.onUpdate] : undefined,
          });
        }
        // Skip relation field itself — it is not a database column
        continue;
      }

      // Regular scalar / enum field
      const col = mapPrismaField(prop, enumNames, enumMap);
      columns.push(col);

      // Collect single-field @id
      if (hasAttribute(prop, 'id')) {
        primaryKey.push(col.name);
      }

      // Collect single-field @unique → treated as a single-column unique constraint
      if (hasAttribute(prop, 'unique')) {
        uniqueConstraints.push([col.name]);
      }
    }

    // Build a Prisma-field-name → DB-column-name mapping for @map resolution.
    // This is needed to remap FK columns and referenced columns.
    const fieldNameMap = new Map<string, string>();
    for (const prop of properties) {
      if (prop.type !== 'field') continue;
      const mapA = getAttribute(prop, 'map');
      if (mapA) {
        const mapped = getFirstStringArg(mapA);
        if (mapped) fieldNameMap.set(prop.name as string, mapped);
      }
    }

    // Remap FK column names from Prisma field names to DB column names
    for (const fk of foreignKeys) {
      fk.columns = fk.columns.map((c) => fieldNameMap.get(c) ?? c);
    }

    // Remap fkColumnNames set to use DB names
    const mappedFkNames = new Set<string>();
    for (const f of fkColumnNames) {
      mappedFkNames.add(fieldNameMap.get(f) ?? f);
    }

    // Process block-level attributes (@@id, @@unique, @@map is handled above)
    for (const prop of properties) {
      if (prop.type !== 'attribute') continue;

      if (prop.name === 'id' || prop.name === '@@id') {
        const fields = getFieldListArg(prop);
        if (fields.length > 0) {
          // Clear any previously collected single-field PKs; composite takes precedence
          primaryKey.length = 0;
          // Remap field names through @map
          primaryKey.push(...fields.map((f) => fieldNameMap.get(f) ?? f));
        }
      }

      if (prop.name === 'unique' || prop.name === '@@unique') {
        const fields = getFieldListArg(prop);
        if (fields.length > 0) {
          uniqueConstraints.push(fields.map((f) => fieldNameMap.get(f) ?? f));
        }
      }
    }

    tables.push({
      name: tableName,
      columns,
      primaryKey,
      foreignKeys,
      uniqueConstraints,
      checkConstraints: [],
    });
  }

  // ── Topological sort for insertion order ────────────────────────────
  const insertionOrder = topologicalSort(tables);

  return { tables, enums, insertionOrder };
}
