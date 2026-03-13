import type {
  SchemaModel,
  TableInfo,
  Row,
  ApiResponseSet,
  TableClassification,
} from '../types/index.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class FkResolutionError extends Error {
  constructor(
    public readonly table: string,
    public readonly column: string,
    public readonly apiRefValue: unknown,
    public readonly identityTable: string,
    public readonly availableValues: unknown[],
  ) {
    const available = availableValues.length > 5
      ? `${availableValues.slice(0, 5).join(', ')}... (${availableValues.length} total)`
      : availableValues.join(', ');
    super(
      `FK resolution failed: ${table}.${column} references ${identityTable} ` +
      `via API ref "${apiRefValue}", but no matching identity row found.\n` +
      `  Available external_id values in ${identityTable}: [${available}]\n` +
      `  Fix: ensure the API entity's ref field produces values that exist in the identity table, ` +
      `or add an explicit mapping in modeling.identityLinks.`,
    );
    this.name = 'FkResolutionError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FkResolutionContext {
  identityTables: Record<string, Row[]>;
  apiResponses: Record<string, ApiResponseSet>;
  classifications: TableClassification[];
  schema: SchemaModel;
  identityLinkOverrides?: Record<string, Record<string, {
    column: string;
    identityTable: string;
    apiField: string;
    platformColumn: string;
    externalIdColumn: string;
  }[]>>;
}

export interface FkResolutionResult {
  rows: Row[];
  errors: FkResolutionError[];
}

interface FkRule {
  column: string;
  identityTable: string;
  matchOn: { platformColumn: string; externalIdColumn: string };
  apiField: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve foreign keys from mirrored table rows to identity table rows.
 *
 * For each FK rule, finds the identity row whose external_id matches the
 * API entity's reference field, and sets the FK column to the identity
 * row's primary key value.
 *
 * Unresolved FKs produce FkResolutionError instances — never random fallbacks.
 */
export function resolveMirroredFks(
  mirroredRows: Row[],
  classification: TableClassification,
  sourceKey: string,
  ctx: FkResolutionContext,
): FkResolutionResult {
  // Determine FK rules: explicit overrides > auto-detected identityFks
  const tableOverrides = ctx.identityLinkOverrides?.[classification.table];
  const fkRules: FkRule[] | undefined = (
    tableOverrides?.[sourceKey] ??
    tableOverrides?.['*'] ??
    classification.identityFks
  ) as FkRule[] | undefined;

  if (!fkRules || fkRules.length === 0) {
    return { rows: mirroredRows, errors: [] };
  }

  const errors: FkResolutionError[] = [];

  // Derive the source platform from the sourceKey ("stripe.invoices" → "stripe")
  const sourcePlatform = sourceKey.split('.')[0]!;

  // Build lookup indexes for identity tables keyed by platform+external_id.
  // Multi-source tables can have Stripe cus_001 and Chargebee cus_001 — the
  // platform discriminator is essential to avoid cross-platform collisions.
  const identityIndexes = new Map<string, Map<string, Row>>();
  for (const rule of fkRules) {
    if (identityIndexes.has(rule.identityTable)) continue;

    const identityRows = ctx.identityTables[rule.identityTable] ?? [];
    const index = new Map<string, Row>();
    let hasPlatformColumn = false;

    for (const row of identityRows) {
      const extId = row[rule.matchOn.externalIdColumn];
      if (extId === undefined || extId === null) continue;

      const platform = row[rule.matchOn.platformColumn];
      if (platform !== undefined && platform !== null) {
        hasPlatformColumn = true;
        // Composite key: "stripe::cus_p1_001"
        index.set(`${String(platform)}::${String(extId)}`, row);
      }
      // Also index by bare external_id as fallback for tables without platform column
      if (!index.has(`::${String(extId)}`)) {
        index.set(`::${String(extId)}`, row);
      }
    }
    // Store whether this identity table uses platform discrimination
    (index as Map<string, Row> & { _hasPlatformColumn?: boolean })._hasPlatformColumn = hasPlatformColumn;
    identityIndexes.set(rule.identityTable, index);
  }

  for (const row of mirroredRows) {
    for (const fkRule of fkRules) {
      let apiRefValue = row[`_apiRef_${fkRule.apiField}`] ?? row[fkRule.apiField];

      if (apiRefValue === undefined || apiRefValue === null) continue;

      // API platforms like Stripe sometimes expand refs into full objects
      // (e.g. customer: { id: "cus_...", ... }) — extract the id.
      if (typeof apiRefValue === 'object' && apiRefValue !== null && 'id' in (apiRefValue as Record<string, unknown>)) {
        apiRefValue = (apiRefValue as Record<string, unknown>).id;
      }

      const identityIndex = identityIndexes.get(fkRule.identityTable);
      if (!identityIndex) continue;

      // Determine the platform for this row. Use the row's own discriminator
      // first, then the source platform from the sourceKey.
      const rowPlatform =
        row[fkRule.matchOn.platformColumn] ??
        row.billing_platform ??
        sourcePlatform;

      // Try platform-qualified lookup first, then bare external_id fallback
      const hasPlatformCol = (identityIndex as Map<string, Row> & { _hasPlatformColumn?: boolean })._hasPlatformColumn;
      const compositeKey = `${String(rowPlatform)}::${String(apiRefValue)}`;
      const bareKey = `::${String(apiRefValue)}`;

      const match = hasPlatformCol
        ? (identityIndex.get(compositeKey) ?? identityIndex.get(bareKey))
        : identityIndex.get(bareKey);

      if (match) {
        const pkCol = getPrimaryKeyColumn(ctx.schema, fkRule.identityTable);
        row[fkRule.column] = match[pkCol];
      } else {
        // Collect available values for actionable error message
        const availableValues: string[] = [];
        for (const [key] of identityIndex) {
          if (!key.startsWith('_') && key.startsWith(`${String(rowPlatform)}::`)) {
            availableValues.push(key.split('::')[1]!);
          }
        }
        if (availableValues.length === 0) {
          for (const [key] of identityIndex) {
            if (key.startsWith('::')) {
              availableValues.push(key.slice(2));
            }
          }
        }

        errors.push(new FkResolutionError(
          classification.table,
          fkRule.column,
          apiRefValue,
          fkRule.identityTable,
          availableValues,
        ));
      }
    }
  }

  return { rows: mirroredRows, errors };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPrimaryKeyColumn(schema: SchemaModel, tableName: string): string {
  const table = schema.tables.find(t => t.name === tableName);
  if (table && table.primaryKey.length > 0) {
    return table.primaryKey[0]!;
  }
  return 'id';
}
