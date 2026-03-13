import type {
  SchemaModel,
  TableInfo,
  SchemaMapping,
  TableRole,
  MirrorSource,
  TableClassification,
} from '../types/index.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelingOverride {
  role: TableRole;
  sources?: { adapter: string; resource: string; discriminatorValue?: string }[];
}

export interface ClassifyTablesOptions {
  schema: SchemaModel;
  schemaMapping?: SchemaMapping;
  adapterIds: string[];
  modelingOverrides?: Record<string, ModelingOverride>;
}

// ---------------------------------------------------------------------------
// Column name heuristics
// ---------------------------------------------------------------------------

const PLATFORM_DISCRIMINATOR_COLUMNS = new Set([
  'billing_platform', 'provider', 'platform', 'source_platform',
  'payment_provider', 'api_platform',
]);

const EXTERNAL_ID_COLUMNS = new Set([
  'external_id', 'platform_id', 'provider_id', 'remote_id',
  'stripe_id', 'chargebee_id', 'paddle_id',
]);

const IDENTITY_TABLE_NAMES = new Set([
  'customers', 'users', 'accounts', 'tenants', 'organizations', 'companies',
  'merchants', 'members', 'contacts', 'clients',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Deterministically classify DB tables into roles based on schema structure,
 * FK graph, schema mapping, and explicit config overrides.
 *
 * No LLM involvement — purely structural analysis.
 */
export function classifyTables(options: ClassifyTablesOptions): TableClassification[] {
  const { schema, schemaMapping, adapterIds, modelingOverrides } = options;

  if (schema.tables.length === 0) return [];

  const tableIndex = new Map<string, TableInfo>();
  for (const t of schema.tables) tableIndex.set(t.name, t);

  // Step 1: Build FK reference graph — count how many other tables reference each table
  const incomingFkCount = new Map<string, number>();
  for (const table of schema.tables) {
    for (const fk of table.foreignKeys) {
      const count = incomingFkCount.get(fk.referencedTable) ?? 0;
      incomingFkCount.set(fk.referencedTable, count + 1);
    }
  }

  // Step 2: Identify tables with platform discriminator + external ID columns
  const tablesWithPlatformColumns = new Map<string, { discriminatorCol: string; externalIdCol: string }>();
  for (const table of schema.tables) {
    const discCol = table.columns.find(c => PLATFORM_DISCRIMINATOR_COLUMNS.has(c.name));
    const extIdCol = table.columns.find(c => EXTERNAL_ID_COLUMNS.has(c.name));
    if (discCol && extIdCol) {
      tablesWithPlatformColumns.set(table.name, {
        discriminatorCol: discCol.name,
        externalIdCol: extIdCol.name,
      });
    }
  }

  // Step 3: Build bridge table set from schema mapping
  const bridgeTableSet = new Set<string>(schemaMapping?.bridgeTables ?? []);

  // Step 4: Classify each table
  const classifications: TableClassification[] = [];

  for (const table of schema.tables) {
    const tableName = table.name;
    const refs = incomingFkCount.get(tableName) ?? 0;
    const hasPlatformCols = tablesWithPlatformColumns.has(tableName);
    const isBridgeCandidate = bridgeTableSet.has(tableName);

    let role: TableRole;
    let sources: MirrorSource[] | undefined;
    let identityFks: TableClassification['identityFks'] | undefined;

    // Identity: referenced by 2+ tables AND (has platform cols OR is a known identity table name)
    const isIdentity = (refs >= 2 && hasPlatformCols) || IDENTITY_TABLE_NAMES.has(tableName);

    // External-mirrored: bridge candidate that is NOT identity, OR has platform columns but few incoming refs
    const isMirrored = !isIdentity && (
      isBridgeCandidate ||
      (hasPlatformCols && refs < 2)
    );

    if (isIdentity) {
      role = 'identity';

      // Identity tables need sources for API↔DB coordination.
      // Without sources, the expander can't derive identity rows from API data.
      sources = buildMirrorSources(
        tableName, table, adapterIds, schemaMapping, tablesWithPlatformColumns,
      );
    } else if (isMirrored) {
      role = 'external-mirrored';

      // Determine sources from schema mapping and configured adapters
      sources = buildMirrorSources(
        tableName, table, adapterIds, schemaMapping, tablesWithPlatformColumns,
      );

      // Build identity FK resolution rules
      identityFks = buildIdentityFks(
        tableName, table, tableIndex, tablesWithPlatformColumns,
      );
    } else {
      role = 'internal-only';
    }

    classifications.push({ table: tableName, role, sources, identityFks });
  }

  // Step 5: Apply explicit overrides from config (absolute precedence)
  if (modelingOverrides) {
    for (const [tableName, override] of Object.entries(modelingOverrides)) {
      if (!tableIndex.has(tableName)) {
        throw new Error(
          `Table classification failed: modeling.tableRoles references table "${tableName}", ` +
          `but this table does not exist in the schema.\n` +
          `  Available tables: [${schema.tables.map(t => t.name).join(', ')}]`,
        );
      }

      const existing = classifications.find(c => c.table === tableName);
      if (existing) {
        existing.role = override.role;
        if (override.sources) {
          existing.sources = override.sources.map(s => ({
            adapter: s.adapter,
            resource: s.resource,
            discriminator: s.discriminatorValue
              ? {
                  column: tablesWithPlatformColumns.get(tableName)?.discriminatorCol ?? 'billing_platform',
                  value: s.discriminatorValue,
                }
              : undefined,
          }));
        }
      }
    }
  }

  // Step 6: Validate invariants
  validateClassifications(classifications, adapterIds, schema);

  // Log summary
  const identityTables = classifications.filter(c => c.role === 'identity').map(c => c.table);
  const mirroredTables = classifications.filter(c => c.role === 'external-mirrored').map(c => c.table);
  const internalTables = classifications.filter(c => c.role === 'internal-only').map(c => c.table);

  logger.debug(
    `Table classification: ${identityTables.length} identity, ` +
    `${mirroredTables.length} mirrored, ${internalTables.length} internal-only`,
  );
  if (identityTables.length > 0) logger.debug(`  Identity: ${identityTables.join(', ')}`);
  if (mirroredTables.length > 0) logger.debug(`  Mirrored: ${mirroredTables.join(', ')}`);

  return classifications;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMirrorSources(
  tableName: string,
  table: TableInfo,
  adapterIds: string[],
  schemaMapping: SchemaMapping | undefined,
  platformCols: Map<string, { discriminatorCol: string; externalIdCol: string }>,
): MirrorSource[] {
  const sources: MirrorSource[] = [];
  const platCols = platformCols.get(tableName);

  // From schema mapping: find all adapter+resource pairs that map to this table
  if (schemaMapping) {
    const mappedAdapters = new Map<string, string>();
    for (const entry of schemaMapping.mappings) {
      if (entry.dbTable === tableName && entry.isBridgeTable) {
        mappedAdapters.set(entry.adapterId, entry.apiResource);
      }
    }

    for (const [adapterId, resource] of mappedAdapters) {
      sources.push({
        adapter: adapterId,
        resource,
        discriminator: platCols ? { column: platCols.discriminatorCol, value: adapterId } : undefined,
      });
    }
  }

  // If no sources from mapping, try matching configured adapters to table name
  if (sources.length === 0) {
    for (const adapterId of adapterIds) {
      sources.push({
        adapter: adapterId,
        resource: tableName,
        discriminator: platCols ? { column: platCols.discriminatorCol, value: adapterId } : undefined,
      });
    }
  }

  return sources;
}

function buildIdentityFks(
  tableName: string,
  table: TableInfo,
  tableIndex: Map<string, TableInfo>,
  platformCols: Map<string, { discriminatorCol: string; externalIdCol: string }>,
): TableClassification['identityFks'] {
  const fkRules: NonNullable<TableClassification['identityFks']> = [];

  for (const fk of table.foreignKeys) {
    const refTable = tableIndex.get(fk.referencedTable);
    if (!refTable) continue;

    // Check if the referenced table has platform columns (making it an identity table candidate)
    const refPlatCols = platformCols.get(fk.referencedTable);
    if (!refPlatCols) continue;

    for (let i = 0; i < fk.columns.length; i++) {
      fkRules.push({
        column: fk.columns[i]!,
        identityTable: fk.referencedTable,
        matchOn: {
          platformColumn: refPlatCols.discriminatorCol,
          externalIdColumn: refPlatCols.externalIdCol,
        },
        apiField: inferApiFieldForFk(fk.referencedTable),
      });
    }
  }

  return fkRules.length > 0 ? fkRules : undefined;
}

function inferApiFieldForFk(identityTableName: string): string {
  // Common mappings from identity table names to API FK field names
  const TABLE_TO_API_FIELD: Record<string, string> = {
    customers: 'customer',
    users: 'user',
    accounts: 'account',
    merchants: 'merchant',
    organizations: 'organization',
  };
  return TABLE_TO_API_FIELD[identityTableName] ?? identityTableName.replace(/s$/, '');
}

function validateClassifications(
  classifications: TableClassification[],
  adapterIds: string[],
  schema: SchemaModel,
): void {
  const adapterSet = new Set(adapterIds);
  const classifiedTables = new Map<string, TableClassification>();
  for (const c of classifications) classifiedTables.set(c.table, c);

  for (const classification of classifications) {
    if (classification.role !== 'external-mirrored') continue;

    // Every mirrored table must have at least one source
    if (!classification.sources || classification.sources.length === 0) {
      logger.warn(
        `Mirrored table "${classification.table}" has no sources configured. ` +
        `It will be treated as internal-only during expansion.`,
      );
      classification.role = 'internal-only';
      classification.sources = undefined;
      continue;
    }

    // Every source adapter must exist in configured APIs
    for (const source of classification.sources) {
      if (!adapterSet.has(source.adapter)) {
        throw new Error(
          `Mirrored source invalid: ${classification.table} source "${source.adapter}.${source.resource}" ` +
          `references adapter "${source.adapter}", but no adapter with that ID is configured.\n` +
          `  Configured adapters: [${adapterIds.join(', ')}]`,
        );
      }
    }

    // Every identity table referenced by an identityFks rule must exist
    if (classification.identityFks) {
      for (const fkRule of classification.identityFks) {
        if (!classifiedTables.has(fkRule.identityTable)) {
          throw new Error(
            `FK rule invalid: ${classification.table}.${fkRule.column} references identity table ` +
            `"${fkRule.identityTable}", but this table does not exist in the schema.`,
          );
        }
      }
    }
  }
}
