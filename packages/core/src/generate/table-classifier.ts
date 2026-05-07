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
// Column name heuristics — fallback only
// ---------------------------------------------------------------------------
//
// These sets are heuristic fallbacks used WHEN no schema mapping is available
// (e.g. DB-only runs with no API adapters configured). When a schema mapping
// IS present, the LLM-derived mapping entries are authoritative — these
// hardcoded names are not consulted.
//
// Why a fallback matters: classifyTables can be called from contexts that
// don't run the schema-mapping LLM call (some tests, future no-API flows),
// and the older bridge-table pattern (billing_platform + external_id) is
// recognisable structurally without help from a mapper.

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

  // Step 3: Read LLM-derived signals from the schema mapping.
  //   - bridgeTables: tables the LLM flagged as bridge tables.
  //   - tablesWithCrossSurfaceMappings: tables that have at least one non-bridge
  //     ID mapping pointing at an API resource (the "IDENTITY CONTRACT" pattern,
  //     where a column like `stripe_customer_id` stores the API's id values).
  //
  // These signals are authoritative when present: they're the LLM's answer to
  // "which tables coordinate with which API resources." We only fall back to
  // the heuristic name sets above when the schema mapping is absent.
  const bridgeTableSet = new Set<string>(schemaMapping?.bridgeTables ?? []);

  const tablesWithCrossSurfaceMappings = new Set<string>();
  if (schemaMapping) {
    for (const entry of schemaMapping.mappings) {
      if (entry.isBridgeTable) continue;
      if (entry.apiField !== 'id') continue;
      tablesWithCrossSurfaceMappings.add(entry.dbTable);
    }
  }

  // Treat an empty schema mapping as "no mapping" — falls through to the
  // heuristic-based path. This happens when the schema-mapping LLM call
  // failed and the engine returned `{ mappings: [], bridgeTables: [] }` as a
  // safe default; without this, every table would be misclassified as
  // internal-only.
  const hasUsableSchemaMapping = !!schemaMapping && (
    tablesWithCrossSurfaceMappings.size > 0 || bridgeTableSet.size > 0
  );

  // Step 4: Classify each table
  const classifications: TableClassification[] = [];

  for (const table of schema.tables) {
    const tableName = table.name;
    const refs = incomingFkCount.get(tableName) ?? 0;
    const hasPlatformCols = tablesWithPlatformColumns.has(tableName);
    const isBridgeCandidate = bridgeTableSet.has(tableName);
    const hasCrossSurfaceMapping = tablesWithCrossSurfaceMappings.has(tableName);

    let role: TableRole;
    let sources: MirrorSource[] | undefined;
    let identityFks: TableClassification['identityFks'] | undefined;

    // Identity: a cross-surface entity referenced by 2+ tables. We treat it as
    // the "noun" everything else points at. The schema mapping flags it via a
    // non-bridge id mapping; structural FK count tells us it's referenced
    // enough to be a true identity table (vs. a one-off mirrored table).
    //
    // Heuristic-fallback tier (no usable schema mapping): the older bridge
    // pattern (refs >= 2 with platform cols) plus the conventional-name set.
    const isIdentity = hasUsableSchemaMapping
      ? (hasCrossSurfaceMapping && refs >= 2)
      : ((refs >= 2 && hasPlatformCols) || IDENTITY_TABLE_NAMES.has(tableName));

    // External-mirrored: a table whose rows mirror API entities. Either it has
    // a non-bridge cross-surface mapping (and isn't the canonical identity),
    // or it's a bridge table flagged by the LLM, or it has the legacy bridge
    // pattern and few incoming refs.
    const isMirrored = !isIdentity && (
      hasCrossSurfaceMapping ||
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
        tableName, table, tableIndex, tablesWithPlatformColumns, schemaMapping,
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

  // From schema mapping: find all adapter+resource pairs that map to this table.
  // Two patterns produce sources:
  //   - Bridge-table entries (existing pattern): the table mirrors API rows by
  //     `external_id` + `billing_platform`.
  //   - Non-bridge cross-surface ID entries (the IDENTITY CONTRACT pattern):
  //     a string column on this table stores values of `<adapter>.<resource>.id`
  //     and joins to that resource. Same coordination story, different schema
  //     shape — the expander still derives DB rows from API entities.
  if (schemaMapping) {
    const mappedAdapters = new Map<string, string>();
    for (const entry of schemaMapping.mappings) {
      if (entry.dbTable !== tableName) continue;
      if (entry.isBridgeTable) {
        mappedAdapters.set(entry.adapterId, entry.apiResource);
      }
    }
    // Pick up non-bridge id-mapping entries for adapters not already covered
    // by a bridge entry (bridge wins when both shapes exist for the same adapter).
    for (const entry of schemaMapping.mappings) {
      if (entry.dbTable !== tableName) continue;
      if (entry.isBridgeTable) continue;
      if (entry.apiField !== 'id') continue;
      if (mappedAdapters.has(entry.adapterId)) continue;
      mappedAdapters.set(entry.adapterId, entry.apiResource);
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
  schemaMapping?: SchemaMapping,
): TableClassification['identityFks'] {
  const fkRules: NonNullable<TableClassification['identityFks']> = [];

  for (const fk of table.foreignKeys) {
    const refTable = tableIndex.get(fk.referencedTable);
    if (!refTable) continue;

    // Tier 1: legacy bridge pattern — referenced table has billing_platform +
    // external_id columns. Match on those.
    const refPlatCols = platformCols.get(fk.referencedTable);
    if (refPlatCols) {
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
      continue;
    }

    // Tier 2: IDENTITY CONTRACT pattern — referenced table has a non-bridge
    // cross-surface ID mapping (e.g. `customers.stripe_customer_id` →
    // `stripe.customer.id`). Use the mapping's `dbColumn` as the join column.
    // No platform discriminator column exists in this schema shape; the FK
    // resolver's bare-extId fallback handles single-source lookups, and
    // multi-adapter cases would need explicit modeling.identityLinks.
    if (schemaMapping) {
      const refMapping = schemaMapping.mappings.find(
        e => e.dbTable === fk.referencedTable && !e.isBridgeTable && e.apiField === 'id',
      );
      if (refMapping) {
        for (let i = 0; i < fk.columns.length; i++) {
          fkRules.push({
            column: fk.columns[i]!,
            identityTable: fk.referencedTable,
            matchOn: {
              // No real platform column in this schema; the resolver falls
              // through to bare-extId lookup, which is correct for single-source
              // identity tables.
              platformColumn: 'billing_platform',
              externalIdColumn: refMapping.dbColumn,
            },
            apiField: inferApiFieldForFk(fk.referencedTable),
          });
        }
      }
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
