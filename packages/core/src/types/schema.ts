/** Normalized database schema — all parsers produce this */
export interface SchemaModel {
  tables: TableInfo[];
  enums: EnumInfo[];
  insertionOrder: string[];
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  primaryKey: string[];
  foreignKeys: ForeignKey[];
  uniqueConstraints: string[][];
  checkConstraints: string[];
  comment?: string;
}

export interface ColumnInfo {
  name: string;
  type: ColumnType;
  pgType: string;
  isNullable: boolean;
  hasDefault: boolean;
  defaultValue?: string;
  isAutoIncrement: boolean;
  isGenerated: boolean;
  maxLength?: number;
  precision?: number;
  scale?: number;
  enumValues?: string[];
  comment?: string;
}

export type ColumnType =
  | 'integer'
  | 'bigint'
  | 'smallint'
  | 'decimal'
  | 'float'
  | 'double'
  | 'text'
  | 'varchar'
  | 'char'
  | 'boolean'
  | 'timestamptz'
  | 'timestamp'
  | 'date'
  | 'time'
  | 'uuid'
  | 'json'
  | 'jsonb'
  | 'bytea'
  | 'enum'
  | 'array'
  | 'unknown';

export interface ForeignKey {
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
  onUpdate?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
}

export interface EnumInfo {
  name: string;
  values: string[];
}

export interface CollectionModel {
  collections: CollectionInfo[];
}

export interface CollectionInfo {
  name: string;
  sampleSchema: Record<string, FieldType>;
  indexes: IndexInfo[];
  estimatedCount: number;
}

export type FieldType =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'date' }
  | { kind: 'objectId' }
  | { kind: 'array'; items: FieldType }
  | { kind: 'object'; fields: Record<string, FieldType> };

export interface IndexInfo {
  name: string;
  fields: Record<string, 1 | -1>;
  unique: boolean;
}
