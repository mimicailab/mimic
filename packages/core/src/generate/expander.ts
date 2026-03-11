import type {
  Blueprint,
  DataPattern,
  RandomSpec,
  FrequencySpec,
  FieldVariation,
  SchemaModel,
  TableInfo,
  ColumnInfo,
  ExpandedData,
  Row,
  EntityData,
  EntityArchetype,
  EntityArchetypeConfig,
  ApiResponseSet,
  ApiResponse,
  PromptContext,
  SchemaMapping,
  SchemaMappingEntry,
  TableClassification,
} from '../types/index.js';
import type { Fact } from '../types/fact-manifest.js';
import { SeededRandom } from './seed-random.js';
import { FieldGenerator } from './field-generators.js';
import { classifyTables } from './table-classifier.js';
import { resolveMirroredFks } from './fk-resolver.js';
import type { FkResolutionContext } from './fk-resolver.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimeRange {
  start: Date;
  end: Date;
}

interface IdTracker {
  counters: Map<string, number>;
  lookup: Map<string, Map<string | number, number>>;
  /** Full rows stored per table for correlated cross-column reference resolution */
  rows: Map<string, Row[]>;
}

// ---------------------------------------------------------------------------
// BlueprintExpander
// ---------------------------------------------------------------------------

/**
 * Deterministically expands a Blueprint into full row data.
 *
 * Given a blueprint (entity seeds + data patterns) and a volume string such
 * as "6 months", the expander stamps out every transactional row, assigns
 * auto-increment IDs, resolves foreign-key references, and sorts time-series
 * tables chronologically.
 */
export class BlueprintExpander {
  private readonly rng: SeededRandom;
  private readonly fieldGen: FieldGenerator;

  constructor(seed: number) {
    this.rng = new SeededRandom(seed);
    this.fieldGen = new FieldGenerator(this.rng, seed);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Expand the blueprint into a full ExpandedData payload.
   *
   * Uses the **three-role** classification model:
   *
   * - **identity** tables: always expanded DB-first (archetypes + patterns).
   *   These are FK anchors — everything else references them.
   * - **external-mirrored** tables: rows derived from API entity data, with
   *   FK resolution back to identity tables. Patterns can augment volume.
   * - **internal-only** tables: expanded normally (archetypes + patterns).
   *
   * When no schema mapping or classifications are available, falls back to
   * the legacy flow for backward compatibility.
   */
  expand(
    blueprint: Blueprint,
    schema: SchemaModel,
    volume: string,
    promptContexts?: Record<string, PromptContext>,
    schemaMapping?: SchemaMapping,
    tableClassifications?: TableClassification[],
    modelingConfig?: {
      fieldMappings?: Record<string, Record<string, Record<string, string>>>;
      identityLinks?: Record<string, Record<string, {
        column: string;
        identityTable: string;
        apiField: string;
        platformColumn: string;
        externalIdColumn: string;
      }[]>>;
    },
  ): ExpandedData {
    const range = parseVolume(volume);
    const tables: Record<string, Row[]> = {};
    const idTracker = createIdTracker();
    const tableIndex = indexTables(schema);

    // Build classifications if not provided but schema mapping exists
    const adapterIds = [
      ...Object.keys(blueprint.data.apiEntityArchetypes ?? {}),
      ...Object.keys(blueprint.data.apiEntities ?? {}),
    ].filter((v, i, a) => a.indexOf(v) === i);

    const classifications = tableClassifications ?? (
      schema.tables.length > 0 && adapterIds.length > 0
        ? classifyTables({ schema, schemaMapping, adapterIds })
        : []
    );

    // Build lookup maps
    const classificationMap = new Map<string, TableClassification>();
    for (const c of classifications) classificationMap.set(c.table, c);

    const identitySet = new Set<string>();
    const mirroredSet = new Set<string>();
    for (const c of classifications) {
      if (c.role === 'identity') identitySet.add(c.table);
      else if (c.role === 'external-mirrored') mirroredSet.add(c.table);
    }

    const hasThreeRoleFlow = identitySet.size > 0 || mirroredSet.size > 0;

    logger.debug(
      `Expanding blueprint "${blueprint.personaId}" over ${volume} ` +
        `(${range.start.toISOString()} → ${range.end.toISOString()})` +
        (hasThreeRoleFlow
          ? ` [3-role: ${identitySet.size} identity, ${mirroredSet.size} mirrored]`
          : ''),
    );

    // ==================================================================
    // PHASE A: Expand API entities (always done early)
    // ==================================================================
    const apiResponses: Record<string, ApiResponseSet> = {};

    // A1. Expand apiEntityArchetypes
    if (blueprint.data.apiEntityArchetypes) {
      for (const [adapterId, resources] of Object.entries(
        blueprint.data.apiEntityArchetypes,
      )) {
        apiResponses[adapterId] = this.expandApiArchetypes(
          adapterId,
          resources,
          blueprint.personaId,
          range,
        );
      }
    }

    // A2. Pass through static apiEntities
    if (blueprint.data.apiEntities) {
      for (const [adapterId, resources] of Object.entries(
        blueprint.data.apiEntities,
      )) {
        const staticSet = this.expandApiEntities(
          adapterId,
          resources,
          blueprint.personaId,
        );
        if (apiResponses[adapterId]) {
          for (const [resourceType, responses] of Object.entries(
            staticSet.responses,
          )) {
            const existing = apiResponses[adapterId]!.responses[resourceType] ?? [];
            apiResponses[adapterId]!.responses[resourceType] = [
              ...existing,
              ...responses,
            ];
          }
        } else {
          apiResponses[adapterId] = staticSet;
        }
      }
    }

    // A3. Normalize, post-process, fill missing, then resolve cross-refs
    this.normalizeAdapterKeys(apiResponses);
    this.postProcessApiResponses(apiResponses);
    if (promptContexts) {
      this.fillMissingApiRequiredFields(apiResponses, promptContexts);
    }
    this.resolveApiCrossReferences(apiResponses);

    // ==================================================================
    // PHASE B: Expand identity tables
    // ==================================================================
    // In 3-role flow: derive identity rows FROM API entity data so that
    // external_id values are guaranteed to match. DB archetypes are used
    // only as templates for DB-only columns (plan, mrr_cents, etc.).
    // Without 3-role flow: use legacy DB-first expansion.
    const expandDbTable = (tableName: string) => {
      const tableInfo = tableIndex.get(tableName);

      // B1. Static entities
      const entityRows = blueprint.data.entities[tableName];
      if (entityRows && entityRows.length > 0) {
        const rows: Row[] = [];
        for (let i = 0; i < entityRows.length; i++) {
          const row = { ...entityRows[i]! } as Row;
          resolveInlineVariations(row, tableName, this.fieldGen, i);
          assignAutoIncrementIds(row, tableInfo, idTracker, tableName);
          resolveReferences(row, idTracker);
          rows.push(row);
          trackRow(row, tableInfo, idTracker, tableName);
        }
        tables[tableName] = [...(tables[tableName] ?? []), ...rows];
      }

      // B2. Archetype expansion
      const archetypeConfig = blueprint.data.entityArchetypes?.[tableName];
      if (archetypeConfig) {
        const existingRows = tables[tableName] ?? [];
        const archetypeRows = this.expandArchetypes(
          archetypeConfig,
          tableName,
          tableInfo,
          idTracker,
        );
        tables[tableName] = [...existingRows, ...archetypeRows];
      }
    };

    if (hasThreeRoleFlow) {
      // Derive identity table rows from API entity data
      for (const tableName of schema.insertionOrder) {
        if (!identitySet.has(tableName)) continue;
        const classification = classificationMap.get(tableName)!;

        this.deriveIdentityTableRows(
          tables, apiResponses, classification, tableIndex, idTracker,
          blueprint, schema,
        );
      }

      // Handle identity tables not in insertionOrder
      for (const tableName of identitySet) {
        if (schema.insertionOrder.includes(tableName)) continue;
        if (tables[tableName] && tables[tableName]!.length > 0) continue;
        const classification = classificationMap.get(tableName)!;

        this.deriveIdentityTableRows(
          tables, apiResponses, classification, tableIndex, idTracker,
          blueprint, schema,
        );
      }

      // Expand identity table patterns
      if (schema.tables.length > 0) {
        for (const pattern of blueprint.data.patterns) {
          if (!identitySet.has(pattern.targetTable)) continue;
          const existing = tables[pattern.targetTable] ?? [];
          const tableInfo = tableIndex.get(pattern.targetTable);
          const generated = this.expandPattern(
            pattern, range, tableInfo, idTracker, tables, tableIndex,
          );
          tables[pattern.targetTable] = [...existing, ...generated];
        }
      }

      // ==================================================================
      // PHASE C: Derive external-mirrored table rows (multi-source)
      // ==================================================================
      for (const tableName of schema.insertionOrder) {
        if (!mirroredSet.has(tableName)) continue;
        const classification = classificationMap.get(tableName)!;

        this.deriveMirroredTableRows(
          tables, apiResponses, classification, tableIndex, idTracker,
          schema, schemaMapping, modelingConfig,
        );
      }

      // Run patterns that target mirrored tables (augment volume)
      if (schema.tables.length > 0) {
        for (const pattern of blueprint.data.patterns) {
          if (!mirroredSet.has(pattern.targetTable)) continue;
          const existing = tables[pattern.targetTable] ?? [];
          const tableInfo = tableIndex.get(pattern.targetTable);
          const generated = this.expandPattern(
            pattern, range, tableInfo, idTracker, tables, tableIndex,
          );
          tables[pattern.targetTable] = [...existing, ...generated];
        }
      }

      // ==================================================================
      // PHASE D: Expand internal-only tables
      // ==================================================================
      for (const tableName of schema.insertionOrder) {
        if (identitySet.has(tableName) || mirroredSet.has(tableName)) continue;
        expandDbTable(tableName);
      }

      // Archetype tables not in insertionOrder and not classified
      if (blueprint.data.entityArchetypes && schema.tables.length > 0) {
        for (const [tableName, config] of Object.entries(blueprint.data.entityArchetypes)) {
          if (schema.insertionOrder.includes(tableName)) continue;
          if (identitySet.has(tableName) || mirroredSet.has(tableName)) continue;
          const tableInfo = tableIndex.get(tableName);
          const existingRows = tables[tableName] ?? [];
          const archetypeRows = this.expandArchetypes(config, tableName, tableInfo, idTracker);
          tables[tableName] = [...existingRows, ...archetypeRows];
        }
      }

      // Internal-only patterns
      if (schema.tables.length > 0) {
        for (const pattern of blueprint.data.patterns) {
          if (identitySet.has(pattern.targetTable) || mirroredSet.has(pattern.targetTable)) continue;
          const existing = tables[pattern.targetTable] ?? [];
          const tableInfo = tableIndex.get(pattern.targetTable);
          const generated = this.expandPattern(
            pattern, range, tableInfo, idTracker, tables, tableIndex,
          );
          tables[pattern.targetTable] = [...existing, ...generated];
        }
      }
    } else {
      // Legacy flow: no classification, expand all tables normally
      for (const tableName of schema.insertionOrder) {
        expandDbTable(tableName);
      }

      if (blueprint.data.entityArchetypes && schema.tables.length > 0) {
        for (const [tableName, config] of Object.entries(blueprint.data.entityArchetypes)) {
          if (schema.insertionOrder.includes(tableName)) continue;
          const tableInfo = tableIndex.get(tableName);
          const existingRows = tables[tableName] ?? [];
          const archetypeRows = this.expandArchetypes(config, tableName, tableInfo, idTracker);
          tables[tableName] = [...existingRows, ...archetypeRows];
        }
      }

      if (schema.tables.length > 0) {
        for (const pattern of blueprint.data.patterns) {
          const existing = tables[pattern.targetTable] ?? [];
          const tableInfo = tableIndex.get(pattern.targetTable);
          const generated = this.expandPattern(
            pattern, range, tableInfo, idTracker, tables, tableIndex,
          );
          tables[pattern.targetTable] = [...existing, ...generated];
        }
      }
    }

    // ==================================================================
    // PHASE E: Post-process all DB tables
    // ==================================================================
    for (const [tableName, rows] of Object.entries(tables)) {
      const tableInfo = tableIndex.get(tableName);
      sortChronologically(rows, tableInfo);
      reassignSequentialIds(rows, tableInfo, idTracker, tableName);
    }

    for (const [tableName, rows] of Object.entries(tables)) {
      const tableInfo = tableIndex.get(tableName);
      if (tableInfo && rows.length > 1) {
        tables[tableName] = deduplicateByUniqueConstraints(rows, tableInfo);
      }
    }

    for (const [tableName, rows] of Object.entries(tables)) {
      const tableInfo = tableIndex.get(tableName);
      if (tableInfo && rows.length > 0) {
        fillMissingRequiredColumns(rows, tableInfo, this.rng);
      }
    }

    // ==================================================================
    // PHASE F: Cross-reference API ↔ DB (bidirectional sync)
    // ==================================================================
    this.crossReferenceApiWithDb(tables, apiResponses);

    // ==================================================================
    // PHASE G: Validate facts
    // ==================================================================
    const validatedFacts = this.validateFacts(
      blueprint.data.facts ?? [],
      tables,
      apiResponses,
    );

    return {
      personaId: blueprint.personaId,
      blueprint,
      tables,
      documents: {},
      apiResponses,
      files: [],
      events: [],
      facts: validatedFacts,
    };
  }

  // -----------------------------------------------------------------------
  // Pattern expansion
  // -----------------------------------------------------------------------

  private expandPattern(
    pattern: DataPattern,
    range: TimeRange,
    tableInfo: TableInfo | undefined,
    idTracker: IdTracker,
    tables: Record<string, Row[]>,
    tableIndex: Map<string, TableInfo>,
  ): Row[] {
    if (pattern.forEachParent) {
      return this.expandPatternPerParent(
        pattern, range, tableInfo, idTracker, tables, tableIndex,
      );
    }
    return this.expandPatternCore(pattern, range, tableInfo, idTracker);
  }

  /**
   * Core pattern dispatch — runs the pattern once (globally).
   */
  private expandPatternCore(
    pattern: DataPattern,
    range: TimeRange,
    tableInfo: TableInfo | undefined,
    idTracker: IdTracker,
  ): Row[] {
    switch (pattern.type) {
      case 'recurring':
        return this.expandRecurring(pattern, range, tableInfo, idTracker);
      case 'variable':
        return this.expandVariable(pattern, range, tableInfo, idTracker);
      case 'periodic':
        return this.expandPeriodic(pattern, range, tableInfo, idTracker);
      case 'event':
        return this.expandEvent(pattern, range, tableInfo, idTracker);
      default:
        logger.debug(`Unknown pattern type: ${(pattern as DataPattern).type}`);
        return [];
    }
  }

  // -----------------------------------------------------------------------
  // Per-parent fanout
  // -----------------------------------------------------------------------

  /**
   * Expand a pattern once per entity in the parent table.
   *
   * For each parent row, clones the pattern with `{{parentTable.column}}`
   * references pre-resolved to the current parent's values, then runs the
   * core pattern expansion. This produces per-customer/per-account row
   * volumes (e.g. 50 customers × 6 months = 300 invoices).
   */
  private expandPatternPerParent(
    pattern: DataPattern,
    range: TimeRange,
    tableInfo: TableInfo | undefined,
    idTracker: IdTracker,
    tables: Record<string, Row[]>,
    tableIndex: Map<string, TableInfo>,
  ): Row[] {
    const parentTableName = pattern.forEachParent!.table;
    const parentRows = tables[parentTableName] ?? [];

    if (parentRows.length === 0) {
      logger.debug(
        `Per-parent pattern for "${pattern.targetTable}": parent table "${parentTableName}" has 0 rows, skipping`,
      );
      return [];
    }

    const parentTableInfo = tableIndex.get(parentTableName);
    const parentPkCol = parentTableInfo?.primaryKey[0] ?? 'id';

    const fkColumn = pattern.forEachParent!.foreignKey ??
      this.inferForeignKeyColumn(tableInfo, parentTableName);

    logger.debug(
      `Per-parent expansion: "${pattern.targetTable}" × ${parentRows.length} "${parentTableName}" rows` +
        (fkColumn ? ` (FK: ${fkColumn})` : ''),
    );

    const allRows: Row[] = [];

    for (const parentRow of parentRows) {
      const parentPkValue = parentRow[parentPkCol];

      const resolved = resolveParentRefsInPattern(
        pattern, parentTableName, parentRow,
      );

      const generated = this.expandPatternCore(resolved, range, tableInfo, idTracker);

      for (const row of generated) {
        // Set FK column if it wasn't already resolved by {{}} reference replacement
        if (fkColumn && parentPkValue !== undefined) {
          const existing = row[fkColumn];
          if (
            existing === undefined ||
            existing === null ||
            (typeof existing === 'string' && existing.includes('{{'))
          ) {
            row[fkColumn] = parentPkValue;
          }
        }
      }

      allRows.push(...generated);
    }

    return allRows;
  }

  /**
   * Infer the FK column in a target table that references a parent table,
   * using the schema's foreign key constraints.
   */
  private inferForeignKeyColumn(
    tableInfo: TableInfo | undefined,
    parentTableName: string,
  ): string | undefined {
    if (!tableInfo) return undefined;
    for (const fk of tableInfo.foreignKeys) {
      if (fk.referencedTable === parentTableName && fk.columns.length > 0) {
        return fk.columns[0];
      }
    }
    return undefined;
  }

  // -- Recurring ---------------------------------------------------------

  private expandRecurring(
    pattern: DataPattern,
    range: TimeRange,
    tableInfo: TableInfo | undefined,
    idTracker: IdTracker,
  ): Row[] {
    const config = pattern.recurring;
    if (!config) return [];

    const dates = generateScheduleDates(config.schedule, range);
    const rows: Row[] = [];

    for (let i = 0; i < dates.length; i++) {
      const row: Row = {
        ...config.fields,
        ...inferDateField(tableInfo, dates[i]!),
      };
      resolveInlineVariations(row, pattern.targetTable, this.fieldGen, i);
      resolveReferences(row, idTracker);
      rows.push(row);
    }

    return rows;
  }

  // -- Variable ----------------------------------------------------------

  private expandVariable(
    pattern: DataPattern,
    range: TimeRange,
    tableInfo: TableInfo | undefined,
    idTracker: IdTracker,
  ): Row[] {
    const config = pattern.variable;
    if (!config) return [];

    const periods = splitIntoPeriods(range, config.frequency.period);
    const rows: Row[] = [];

    for (const period of periods) {
      const count = this.rng.intBetween(
        config.frequency.min,
        config.frequency.max,
      );

      for (let i = 0; i < count; i++) {
        const date = this.rng.dateBetween(period.start, period.end);
        const randomValues = this.resolveRandomFields(config.randomFields);

        const row: Row = {
          ...config.fields,
          ...randomValues,
          ...inferDateField(tableInfo, date),
        };
        resolveInlineVariations(row, pattern.targetTable, this.fieldGen, rows.length);
        resolveReferences(row, idTracker);
        rows.push(row);
      }
    }

    return rows;
  }

  // -- Periodic ----------------------------------------------------------

  private expandPeriodic(
    pattern: DataPattern,
    range: TimeRange,
    tableInfo: TableInfo | undefined,
    idTracker: IdTracker,
  ): Row[] {
    const config = pattern.periodic;
    if (!config) return [];

    const schedule = {
      frequency: config.frequency as
        | 'weekly'
        | 'biweekly'
        | 'monthly',
    };
    const dates = generateScheduleDates(schedule, range);
    const rows: Row[] = [];

    for (let i = 0; i < dates.length; i++) {
      const row: Row = {
        ...config.fields,
        ...inferDateField(tableInfo, dates[i]!),
      };
      resolveInlineVariations(row, pattern.targetTable, this.fieldGen, i);
      resolveReferences(row, idTracker);
      rows.push(row);
    }

    return rows;
  }

  // -- Event -------------------------------------------------------------

  private expandEvent(
    pattern: DataPattern,
    range: TimeRange,
    tableInfo: TableInfo | undefined,
    idTracker: IdTracker,
  ): Row[] {
    const config = pattern.event;
    if (!config) return [];

    // Roll once per month in the range
    const months = splitIntoPeriods(range, 'month');
    const rows: Row[] = [];

    for (const period of months) {
      if (this.rng.chance(config.probability)) {
        const date = this.rng.dateBetween(period.start, period.end);
        const row: Row = {
          ...config.fields,
          ...inferDateField(tableInfo, date),
        };
        resolveInlineVariations(row, pattern.targetTable, this.fieldGen, rows.length);
        resolveReferences(row, idTracker);
        rows.push(row);
      }
    }

    return rows;
  }

  // -----------------------------------------------------------------------
  // Random field resolution
  // -----------------------------------------------------------------------

  private resolveRandomFields(
    specs: Record<string, RandomSpec>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [field, spec] of Object.entries(specs)) {
      result[field] = this.resolveRandomSpec(spec);
    }

    return result;
  }

  private resolveRandomSpec(spec: RandomSpec): unknown {
    switch (spec.type) {
      case 'pick':
        if (!spec.values || spec.values.length === 0) return null;
        return this.rng.pick(spec.values);

      case 'range':
        return this.rng.intBetween(spec.min ?? 0, spec.max ?? 100);

      case 'decimal_range':
        return this.rng.decimalBetween(spec.min ?? 0, spec.max ?? 100, 2);

      case 'date_in_period':
        // Handled at the pattern level; return null as placeholder
        return null;

      default:
        return null;
    }
  }
  // -----------------------------------------------------------------------
  // Archetype expansion
  // -----------------------------------------------------------------------

  /**
   * Expand archetypes into full entity rows by cloning templates with
   * randomized field variations. Respects distribution weights.
   */
  private expandArchetypes(
    config: EntityArchetypeConfig,
    tableName: string,
    tableInfo: TableInfo | undefined,
    idTracker: IdTracker,
  ): Row[] {
    const { count, archetypes } = config;
    const distribution = distributeByWeight(archetypes, count);
    const rows: Row[] = [];

    logger.debug(
      `Expanding ${count} entities for "${tableName}" from ${archetypes.length} archetype(s)`,
    );

    for (let arcIdx = 0; arcIdx < archetypes.length; arcIdx++) {
      const archetype = archetypes[arcIdx]!;
      const archetypeCount = distribution[arcIdx]!;

      for (let i = 0; i < archetypeCount; i++) {
        const row = this.fieldGen.applyVariations(
          archetype.vary,
          archetype.fields,
          i,
          tableName,
        );

        assignAutoIncrementIds(row, tableInfo, idTracker, tableName);
        resolveReferences(row, idTracker, this.rng);
        rows.push(row);
        trackRow(row, tableInfo, idTracker, tableName);
      }
    }

    return rows;
  }

  // -----------------------------------------------------------------------
  // API entity expansion
  // -----------------------------------------------------------------------

  /**
   * Expand compact API entity seeds into ApiResponseSet objects.
   *
   * Each entity becomes an ApiResponse with a stateKey matching the
   * adapter's StateStore namespace convention (e.g. "stripe_customers").
   * The LLM generates IDs that match cross-platform references in DB entities.
   */
  /**
   * Expand API entity archetypes into full ApiResponseSet objects.
   *
   * Uses the same archetype expansion logic as DB entities — distributes
   * count by weight, clones with field variations via FieldGenerator.
   * Generic: works for any adapter (Stripe, Plaid, Slack, etc.).
   */
  private expandApiArchetypes(
    adapterId: string,
    resources: Record<string, EntityArchetypeConfig>,
    personaId: string,
    range: TimeRange,
  ): ApiResponseSet {
    const responses: Record<string, ApiResponse[]> = {};
    const startSec = Math.floor(range.start.getTime() / 1000);
    const endSec = Math.floor(range.end.getTime() / 1000);

    for (const [resourceType, config] of Object.entries(resources)) {
      const { count, archetypes } = config;
      const distribution = distributeByWeight(archetypes, count);
      const expanded: ApiResponse[] = [];

      logger.debug(
        `Expanding ${count} API entities for "${adapterId}.${resourceType}" from ${archetypes.length} archetype(s)`,
      );

      for (let arcIdx = 0; arcIdx < archetypes.length; arcIdx++) {
        const archetype = archetypes[arcIdx]!;
        const archetypeCount = distribution[arcIdx]!;

        for (let i = 0; i < archetypeCount; i++) {
          const row = this.fieldGen.applyVariations(
            archetype.vary,
            archetype.fields,
            i,
            `${adapterId}.${resourceType}`,
          );

          // Ensure created timestamp falls within the configured date range
          const createdKey = row.created !== undefined ? 'created' : row.created_at !== undefined ? 'created_at' : null;
          if (createdKey) {
            const ts = row[createdKey] as number;
            if (ts < startSec || ts > endSec) {
              row[createdKey] = startSec + Math.floor(this.rng.next() * (endSec - startSec));
            }
          } else {
            row.created = startSec + Math.floor(this.rng.next() * (endSec - startSec));
          }

          expanded.push({
            statusCode: 200,
            headers: { 'content-type': 'application/json' },
            body: row,
            personaId,
            stateKey: `${adapterId}_${resourceType}`,
          });
        }
      }

      // Sort by created timestamp for chronological consistency
      expanded.sort((a, b) => {
        const ca = (a.body as Record<string, unknown>).created as number ?? 0;
        const cb = (b.body as Record<string, unknown>).created as number ?? 0;
        return ca - cb;
      });

      responses[resourceType] = expanded;
    }

    return { adapterId, responses };
  }

  private expandApiEntities(
    adapterId: string,
    resources: Record<string, EntityData[]>,
    personaId: string,
  ): ApiResponseSet {
    const responses: Record<string, ApiResponse[]> = {};

    for (const [resourceType, entities] of Object.entries(resources)) {
      const expanded: ApiResponse[] = [];

      for (const entity of entities) {
        const body: Record<string, unknown> = { ...entity };

        // Add created timestamp if not present
        if (body.created === undefined && body.created_at === undefined) {
          body.created = Math.floor(Date.now() / 1000);
        }

        expanded.push({
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body,
          personaId,
          stateKey: `${adapterId}_${resourceType}`,
        });
      }

      responses[resourceType] = expanded;
    }

    return { adapterId, responses };
  }

  // -----------------------------------------------------------------------
  // Post-process API responses: FK wrapping, timestamps, consistency
  // -----------------------------------------------------------------------

  /**
   * Fix common data quality issues in expanded API responses.
   * Runs after all API archetypes are expanded. Generic — works for any adapter.
   *
   * 1. Wrap FK sequence references that exceed parent entity counts
   * 2. Ensure timestamp pairs are ordered (start < end)
   * 3. Fix logically impossible field combinations (paid+failed, etc.)
   */
  private postProcessApiResponses(
    apiResponses: Record<string, ApiResponseSet>,
  ): void {
    const SEQ_PATTERN = /^([a-z_]+p\d+_)(\d{3,})$/;

    for (const responseSet of Object.values(apiResponses)) {
      // ── Phase 1: Identify prefix ownership ──────────────────────────
      // For each resource, find the primary ID field and record
      // prefix → entityCount (e.g. "cus_p1_" → 30).
      const prefixOwnerCount = new Map<string, number>();

      for (const [resourceType, responses] of Object.entries(
        responseSet.responses,
      )) {
        if (responses.length === 0) continue;

        const firstBody = responses[0]!.body as Record<string, unknown>;
        const pkField = findPrimaryIdField(firstBody, resourceType);
        if (!pkField) continue;

        const pkValue = firstBody[pkField];
        if (typeof pkValue !== 'string') continue;

        const m = pkValue.match(SEQ_PATTERN);
        if (m) {
          prefixOwnerCount.set(m[1]!, responses.length);
        }
      }

      // ── Phase 2: Wrap FK references + fix timestamps + consistency ─
      for (const responses of Object.values(responseSet.responses)) {
        for (const response of responses) {
          const body = response.body as Record<string, unknown>;

          // 2a. Wrap dangling FK references
          for (const [key, value] of Object.entries(body)) {
            if (typeof value !== 'string') continue;
            const match = value.match(SEQ_PATTERN);
            if (!match) continue;

            const prefix = match[1]!;
            const numStr = match[2]!;
            const num = parseInt(numStr, 10);
            const ownerCount = prefixOwnerCount.get(prefix);

            if (ownerCount && num > ownerCount) {
              const wrapped = ((num - 1) % ownerCount) + 1;
              body[key] = `${prefix}${String(wrapped).padStart(numStr.length, '0')}`;
            }
          }

          // 2b. Fix timestamp pair ordering
          fixTimestampOrdering(body);

          // 2c. Fix logical state consistency
          fixLogicalConsistency(body);

          // 2d. Fix country/currency mismatches
          fixCountryCurrencyConsistency(body);

          // 2e. Deserialize stringified JSON objects (e.g. amount fields)
          normalizeStringifiedObjects(body);
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Resolve cross-resource FK references within each adapter
  // -----------------------------------------------------------------------

  /**
   * Replace `gen_*` placeholder IDs in API response bodies with real IDs
   * from sibling resources in the same adapter.
   *
   * Uses a convention-based FK map: field name → parent resource type.
   * For each FK field with a `gen_*` value, picks a random real ID from
   * the parent resource's ID pool.
   */
  private resolveApiCrossReferences(
    apiResponses: Record<string, ApiResponseSet>,
  ): void {
    // FK field name → parent resource type (convention-based)
    const FK_MAP: Record<string, string> = {
      customer: 'customers', customer_id: 'customers', customerId: 'customers',
      plan_id: 'plans', planId: 'plans',
      product_id: 'products', productId: 'products',
      price_id: 'prices', priceId: 'prices',
      subscription_id: 'subscriptions', subscriptionId: 'subscriptions',
      invoice_id: 'invoices', invoiceId: 'invoices',
      charge_id: 'charges', chargeId: 'charges',
      payment_intent_id: 'payment_intents',
      payment_method_id: 'payment_methods',
      accountId: 'accounts', account_id: 'accounts',
      merchantAccountId: 'merchants',
      mandate_id: 'mandates',
      order_id: 'orders', orderId: 'orders',
      refund_id: 'refunds',
      payout_id: 'payouts',
      item_id: 'items',
      source_id: 'sources',
      transaction_id: 'transactions',
      user_id: 'users', userId: 'users',
      team_id: 'teams', teamId: 'teams',
      channel_id: 'channels', channelId: 'channels',
    };

    for (const responseSet of Object.values(apiResponses)) {
      // Build ID pools per resource type within this adapter
      const idPools = new Map<string, string[]>();
      for (const [resourceType, responses] of Object.entries(responseSet.responses)) {
        const ids: string[] = [];
        for (const r of responses) {
          const body = r.body as Record<string, unknown>;
          if (typeof body.id === 'string') ids.push(body.id);
        }
        if (ids.length > 0) idPools.set(resourceType, ids);
      }

      if (idPools.size === 0) continue;

      let resolvedCount = 0;
      for (const responses of Object.values(responseSet.responses)) {
        for (const r of responses) {
          const body = r.body as Record<string, unknown>;
          for (const [field, parentResource] of Object.entries(FK_MAP)) {
            const val = body[field];
            if (typeof val !== 'string') continue;
            if (!val.startsWith('gen_')) continue;
            const pool = idPools.get(parentResource);
            if (pool && pool.length > 0) {
              body[field] = this.rng.pick(pool);
              resolvedCount++;
            }
          }
        }
      }

      if (resolvedCount > 0) {
        logger.debug(
          `Resolved ${resolvedCount} cross-resource FK(s) in ${responseSet.adapterId}`,
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // Cross-reference API entities with DB rows
  // -----------------------------------------------------------------------

  /**
   * Bidirectional cross-reference between DB rows and API entities.
   *
   * When both surfaces share sequence-based IDs (e.g. "cus_p1_023"), sync
   * fields in both directions so the same entity looks consistent whether
   * queried from the database or the API.
   *
   * DB → API: name, email, company, plan, status, amounts, country, currency
   * API → DB: fill any unresolved placeholder columns from API entity data
   */
  private crossReferenceApiWithDb(
    tables: Record<string, Row[]>,
    apiResponses: Record<string, ApiResponseSet>,
  ): void {
    // ── Phase 1: Build lookup maps from DB tables ────────────────────
    // Map: idValue → { tableName, row, colName }
    const SEQ_ID = /^[a-z_]+p\d+_\d+$/;
    const dbIdIndex = new Map<string, { tableName: string; row: Row; colName: string }>();

    for (const [tableName, rows] of Object.entries(tables)) {
      for (const row of rows) {
        for (const [colName, value] of Object.entries(row)) {
          if (typeof value !== 'string') continue;
          if (SEQ_ID.test(value)) {
            dbIdIndex.set(value, { tableName, row, colName });
          }
        }
      }
    }

    // Fields to sync DB → API (exact name match)
    const DB_TO_API_FIELDS = [
      'name', 'email', 'company_name', 'contact_name', 'phone',
      'plan', 'status', 'currency', 'country',
      'description', 'metadata',
    ];

    // Semantic field mappings: DB column name → API field name
    const DB_TO_API_SEMANTIC: [string, string][] = [
      ['company_name', 'name'],        // DB company_name → API name (for business entities)
      ['company', 'name'],             // DB company → API name
      ['mrr_cents', 'amount'],         // DB mrr → API amount (same unit)
      ['plan', 'plan_id'],             // DB plan → API plan_id
      ['country', 'country_code'],
    ];

    // Fields to sync API → DB (fill unresolved DB columns)
    const API_TO_DB_FIELDS = [
      'name', 'email', 'phone', 'status', 'currency', 'country',
    ];

    // ── Phase 2: Bidirectional sync ────────────────────────────────
    // Build API ID → body map first (needed for both directions)
    const apiIdIndex = new Map<string, Record<string, unknown>>();
    for (const responseSet of Object.values(apiResponses)) {
      for (const responses of Object.values(responseSet.responses)) {
        for (const apiResponse of responses) {
          const body = apiResponse.body as Record<string, unknown>;
          const id = body.id;
          if (typeof id === 'string') {
            apiIdIndex.set(id, body);
          }
        }
      }
    }

    // Phase 2a: API → DB sync
    // API data is authoritative for overlapping fields (name, email, status, etc.)
    // because identity table rows are derived from API entities.
    for (const [_tableName, rows] of Object.entries(tables)) {
      for (const row of rows) {
        for (const [_colName, value] of Object.entries(row)) {
          if (typeof value !== 'string' || !SEQ_ID.test(value)) continue;
          const apiBody = apiIdIndex.get(value);
          if (!apiBody) continue;

          for (const field of API_TO_DB_FIELDS) {
            const apiVal = apiBody[field];
            if (apiVal === undefined || apiVal === null) continue;
            const dbVal = row[field];
            // Overwrite if DB is missing, has a placeholder, or has a generic value
            if (dbVal === undefined || dbVal === null) {
              row[field] = apiVal;
            } else if (typeof dbVal === 'string' && dbVal.includes('{{')) {
              row[field] = apiVal;
            }
          }
          break;
        }
      }
    }

    // Phase 2b: DB → API sync (fill missing API fields from DB data)
    for (const responseSet of Object.values(apiResponses)) {
      for (const responses of Object.values(responseSet.responses)) {
        for (const apiResponse of responses) {
          const body = apiResponse.body as Record<string, unknown>;
          const apiId = body.id as string | undefined;
          if (!apiId || typeof apiId !== 'string') continue;

          const match = dbIdIndex.get(apiId);
          if (!match) continue;
          const { row: dbRow } = match;

          // Fill missing API fields from DB (DB → API for non-overlapping)
          for (const field of DB_TO_API_FIELDS) {
            if (body[field] !== undefined && body[field] !== null) continue;
            if (dbRow[field] === undefined || dbRow[field] === null) continue;
            if (typeof dbRow[field] === 'string' && (dbRow[field] as string).includes('{{')) continue;
            body[field] = dbRow[field];
          }

          // Semantic field mapping (DB → API) for missing fields only
          for (const [dbField, apiField] of DB_TO_API_SEMANTIC) {
            if (body[apiField] !== undefined && body[apiField] !== null) continue;
            if (dbRow[dbField] === undefined || dbRow[dbField] === null) continue;
            if (typeof dbRow[dbField] === 'string' && (dbRow[dbField] as string).includes('{{')) continue;
            body[apiField] = dbRow[dbField];
          }
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Mirrored table derivation (three-role flow)
  // -----------------------------------------------------------------------

  /**
   * Derive mirrored table rows from expanded API entity data using the
   * three-role classification model.
   *
   * For each source in the classification, creates DB rows by projecting
   * API entity fields onto DB columns, then resolves FKs back to identity
   * tables. Supports multi-source tables (e.g. invoices from Stripe +
   * Chargebee simultaneously).
   */
  private deriveMirroredTableRows(
    tables: Record<string, Row[]>,
    apiResponses: Record<string, ApiResponseSet>,
    classification: TableClassification,
    tableIndex: Map<string, TableInfo>,
    idTracker: IdTracker,
    schema: SchemaModel,
    schemaMapping?: SchemaMapping,
    modelingConfig?: {
      fieldMappings?: Record<string, Record<string, Record<string, string>>>;
      identityLinks?: Record<string, Record<string, {
        column: string;
        identityTable: string;
        apiField: string;
        platformColumn: string;
        externalIdColumn: string;
      }[]>>;
    },
  ): void {
    const tableName = classification.table;
    const tableInfo = tableIndex.get(tableName);
    const allRows: Row[] = [];

    if (!classification.sources || classification.sources.length === 0) return;

    // Build field mappings from schema mapping + config overrides
    const bridgeMappings = new Map<string, SchemaMappingEntry[]>();
    if (schemaMapping) {
      for (const entry of schemaMapping.mappings) {
        if (entry.dbTable !== tableName || !entry.isBridgeTable) continue;
        const key = `${entry.adapterId}:${entry.apiResource}`;
        const group = bridgeMappings.get(key) ?? [];
        group.push(entry);
        bridgeMappings.set(key, group);
      }
    }

    const hasBillingPlatformCol = tableInfo?.columns.some(c => c.name === 'billing_platform');
    const hasExternalIdCol = tableInfo?.columns.some(c => c.name === 'external_id');

    for (const source of classification.sources) {
      const sourceKey = `${source.adapter}.${source.resource}`;
      const responseSet = apiResponses[source.adapter];
      if (!responseSet) continue;

      const responses = responseSet.responses[source.resource];
      if (!responses || responses.length === 0) continue;

      // Get field mappings for this source
      const mappings = bridgeMappings.get(`${source.adapter}:${source.resource}`) ?? [];

      // Get config-level field mapping overrides
      const configFieldMap = modelingConfig?.fieldMappings?.[tableName];
      const sourceFieldMap = configFieldMap?.[sourceKey] ?? configFieldMap?.['*'] ?? {};

      const sourceRows: Row[] = [];

      for (const apiResponse of responses) {
        const body = apiResponse.body as Record<string, unknown>;
        const row: Row = {};

        // Set discriminator column
        if (hasBillingPlatformCol && source.discriminator) {
          row[source.discriminator.column] = source.discriminator.value;
        } else if (hasBillingPlatformCol) {
          row.billing_platform = source.adapter;
        }

        // Set external_id
        if (hasExternalIdCol && typeof body.id === 'string') {
          row.external_id = body.id;
        }

        // Map API fields → DB columns via schema mapping
        for (const mapping of mappings) {
          const apiValue = body[mapping.apiField];
          if (apiValue !== undefined && apiValue !== null) {
            row[mapping.dbColumn] = apiValue;
          }
        }

        // Apply config-level field mapping overrides
        for (const [dbCol, apiField] of Object.entries(sourceFieldMap)) {
          const apiValue = body[apiField];
          if (apiValue !== undefined && apiValue !== null) {
            row[dbCol] = apiValue;
          }
        }

        // Store API ref fields for FK resolution.
        // Stripe (and similar APIs) sometimes expand refs into full objects
        // like { id: "cus_...", object: "customer", ... } — extract the id.
        if (classification.identityFks) {
          for (const fkRule of classification.identityFks) {
            let apiRefValue = body[fkRule.apiField];
            if (apiRefValue !== undefined) {
              if (typeof apiRefValue === 'object' && apiRefValue !== null && 'id' in apiRefValue) {
                apiRefValue = (apiRefValue as Record<string, unknown>).id;
              }
              row[`_apiRef_${fkRule.apiField}`] = apiRefValue;
            }
          }
        }

        assignAutoIncrementIds(row, tableInfo, idTracker, tableName);
        sourceRows.push(row);
        trackRow(row, tableInfo, idTracker, tableName);
      }

      // Resolve FKs to identity tables
      if (classification.identityFks && classification.identityFks.length > 0) {
        const fkCtx: FkResolutionContext = {
          identityTables: tables,
          apiResponses,
          classifications: [],
          schema,
          identityLinkOverrides: modelingConfig?.identityLinks,
        };

        const result = resolveMirroredFks(sourceRows, classification, sourceKey, fkCtx);

        if (result.errors.length > 0) {
          const errorSummary = result.errors
            .map(e => `  - ${e.table}.${e.column}: ref "${e.apiRefValue}" → ${e.identityTable}`)
            .join('\n');
          throw new Error(
            `FK resolution failed for mirrored table "${classification.table}" (source: ${sourceKey}).\n` +
            `${result.errors.length} unresolved reference(s):\n${errorSummary}\n\n` +
            `This is a hard error to prevent silently broken datasets. Fixes:\n` +
            `  1. Ensure API entity ref fields produce IDs that exist in the identity table's external_id column.\n` +
            `  2. Add explicit mappings in modeling.identityLinks to override auto-detection.\n` +
            `  3. If cross-surface consistency is not needed for this table, reclassify it as "internal-only" in modeling.tableRoles.`,
          );
        }
      }

      // Clean up temporary _apiRef_ fields
      for (const row of sourceRows) {
        for (const key of Object.keys(row)) {
          if (key.startsWith('_apiRef_')) delete row[key];
        }
      }

      allRows.push(...sourceRows);
    }

    if (allRows.length > 0) {
      tables[tableName] = [...(tables[tableName] ?? []), ...allRows];

      // Dedup + fill mirrored tables immediately
      if (tableInfo) {
        tables[tableName] = deduplicateByUniqueConstraints(tables[tableName]!, tableInfo);
        fillMissingRequiredColumns(tables[tableName]!, tableInfo, this.rng);
      }

      logger.debug(
        `Mirrored table "${tableName}": derived ${allRows.length} rows from ${classification.sources!.length} source(s)`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Identity table derivation (three-role flow)
  // -----------------------------------------------------------------------

  /**
   * Derive identity table rows FROM expanded API entity data.
   *
   * Instead of expanding DB archetypes independently (which would produce
   * non-matching external_id values), this creates one DB row per API
   * entity, copying the API entity's `id` into `external_id` and setting
   * `billing_platform` from the adapter ID.
   *
   * DB-only columns (like `plan`, `mrr_cents`) are populated from:
   * 1. DB archetype templates (round-robin across archetypes for variety)
   * 2. Common field mapping from API → DB (name, email, status, etc.)
   * 3. `fillMissingRequiredColumns` as a final safety net
   */
  private deriveIdentityTableRows(
    tables: Record<string, Row[]>,
    apiResponses: Record<string, ApiResponseSet>,
    classification: TableClassification,
    tableIndex: Map<string, TableInfo>,
    idTracker: IdTracker,
    blueprint: Blueprint,
    schema: SchemaModel,
  ): void {
    const tableName = classification.table;
    const tableInfo = tableIndex.get(tableName);
    const allRows: Row[] = [];

    if (!classification.sources || classification.sources.length === 0) {
      logger.debug(`Identity table "${tableName}" has no sources — falling back to DB archetype expansion`);
      return;
    }

    // Get DB archetype templates for DB-only column values
    const dbArchetypes = blueprint.data.entityArchetypes?.[tableName];
    const archetypeTemplates = dbArchetypes?.archetypes ?? [];
    const distribution = archetypeTemplates.length > 0
      ? distributeByWeight(archetypeTemplates, dbArchetypes!.count)
      : [];

    const hasBillingPlatformCol = tableInfo?.columns.some(c => c.name === 'billing_platform');
    const hasExternalIdCol = tableInfo?.columns.some(c => c.name === 'external_id');

    // Common API → DB field mappings for identity tables.
    // Only map fields that actually exist in the target table schema.
    const allApiToDbMappings: [string, string][] = [
      ['name', 'name'],
      ['email', 'email'],
      ['phone', 'phone'],
      ['description', 'description'],
      ['currency', 'currency'],
      ['status', 'status'],
      ['metadata', 'metadata'],
    ];
    const dbColumnNames = new Set(tableInfo?.columns.map(c => c.name) ?? []);
    const API_TO_DB_MAP = allApiToDbMappings.filter(([, dbCol]) => dbColumnNames.has(dbCol));

    for (const source of classification.sources) {
      const responseSet = apiResponses[source.adapter];
      if (!responseSet) continue;

      const responses = responseSet.responses[source.resource];
      if (!responses || responses.length === 0) continue;

      logger.debug(
        `Deriving identity table "${tableName}" rows from ${source.adapter}.${source.resource} (${responses.length} entities)`,
      );

      // Build a round-robin index into archetypes for DB-only column variety.
      // Match archetypes by billing_platform where possible.
      const platformArchetypes = archetypeTemplates.filter(
        a => a.fields.billing_platform === source.adapter ||
             a.fields.billing_platform === source.discriminator?.value,
      );
      const templatePool = platformArchetypes.length > 0 ? platformArchetypes : archetypeTemplates;

      for (let i = 0; i < responses.length; i++) {
        const apiResponse = responses[i]!;
        const body = apiResponse.body as Record<string, unknown>;
        const row: Row = {};

        // 1. Set billing_platform
        if (hasBillingPlatformCol) {
          if (source.discriminator) {
            row[source.discriminator.column] = source.discriminator.value;
          } else {
            row.billing_platform = source.adapter;
          }
        }

        // 2. Set external_id from API entity ID
        if (hasExternalIdCol && typeof body.id === 'string') {
          row.external_id = body.id;
        }

        // 3. Map common fields from API → DB
        for (const [apiField, dbCol] of API_TO_DB_MAP) {
          const apiValue = body[apiField];
          if (apiValue !== undefined && apiValue !== null) {
            row[dbCol] = apiValue;
          }
        }

        // 4. Apply DB-only columns from archetype template (round-robin).
        // Only set fields that exist in the DB schema to avoid inserting
        // columns that don't exist in the target table.
        if (templatePool.length > 0) {
          const template = templatePool[i % templatePool.length]!;
          for (const [field, value] of Object.entries(template.fields)) {
            if (row[field] !== undefined) continue;
            if (field === 'billing_platform' || field === 'external_id') continue;
            if (dbColumnNames.size > 0 && !dbColumnNames.has(field)) continue;
            row[field] = value;
          }

          for (const [field, variation] of Object.entries(template.vary)) {
            if (row[field] !== undefined) continue;
            if (field === 'billing_platform' || field === 'external_id') continue;
            if (dbColumnNames.size > 0 && !dbColumnNames.has(field)) continue;
            row[field] = this.fieldGen.resolveVariation(
              variation, row, i, `${tableName}.${field}`,
            );
          }
        }

        assignAutoIncrementIds(row, tableInfo, idTracker, tableName);
        allRows.push(row);
        trackRow(row, tableInfo, idTracker, tableName);
      }
    }

    // Also include any static entities from the blueprint
    const entityRows = blueprint.data.entities[tableName];
    if (entityRows && entityRows.length > 0) {
      for (let i = 0; i < entityRows.length; i++) {
        const row = { ...entityRows[i]! } as Row;
        // Only include static entities that aren't already covered by API derivation
        const extId = row.external_id as string | undefined;
        if (extId && allRows.some(r => r.external_id === extId)) continue;

        resolveInlineVariations(row, tableName, this.fieldGen, i);
        assignAutoIncrementIds(row, tableInfo, idTracker, tableName);
        resolveReferences(row, idTracker);
        allRows.push(row);
        trackRow(row, tableInfo, idTracker, tableName);
      }
    }

    if (allRows.length > 0) {
      tables[tableName] = [...(tables[tableName] ?? []), ...allRows];

      // Dedup + fill identity tables immediately
      if (tableInfo) {
        tables[tableName] = deduplicateByUniqueConstraints(tables[tableName]!, tableInfo);
        fillMissingRequiredColumns(tables[tableName]!, tableInfo, this.rng);
      }

      logger.debug(
        `Identity table "${tableName}": derived ${allRows.length} rows from ${classification.sources!.length} source(s)`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Fact validation against actual expanded data
  // -----------------------------------------------------------------------

  /**
   * Validate LLM-generated facts against the actual expanded data.
   *
   * Removes facts that reference platforms with no data, corrects numeric
   * claims where possible, and recalculates counts/totals from the real
   * expanded entities. Facts that can't be validated are kept but marked
   * with reduced severity.
   */
  private validateFacts(
    facts: Fact[],
    tables: Record<string, Row[]>,
    apiResponses: Record<string, ApiResponseSet>,
  ): Fact[] {
    if (facts.length === 0) return [];

    const validated: Fact[] = [];
    const availablePlatforms = new Set([
      'database',
      ...Object.keys(apiResponses),
    ]);

    for (const fact of facts) {
      // Drop facts that reference platforms with no data
      if (fact.platform !== 'database' && !availablePlatforms.has(fact.platform)) {
        logger.debug(
          `Dropping fact "${fact.id}": platform "${fact.platform}" has no data`,
        );
        continue;
      }

      // Try to reconcile numeric claims with actual data
      const reconciled = this.reconcileFact(fact, tables, apiResponses);
      validated.push(reconciled);
    }

    const dropped = facts.length - validated.length;
    if (dropped > 0) {
      logger.debug(
        `Fact validation: kept ${validated.length}/${facts.length} facts (${dropped} dropped for missing platforms)`,
      );
    }

    return validated;
  }

  /**
   * Reconcile a single fact's numeric claims against expanded data.
   * Updates `data` fields with actual counts/totals where possible.
   */
  private reconcileFact(
    fact: Fact,
    tables: Record<string, Row[]>,
    apiResponses: Record<string, ApiResponseSet>,
  ): Fact {
    const reconciled = { ...fact, data: { ...fact.data } };

    // Get the relevant data source
    const getApiEntities = (platform: string, resource: string): Record<string, unknown>[] => {
      const responseSet = apiResponses[platform];
      if (!responseSet) return [];
      const responses = responseSet.responses[resource];
      if (!responses) return [];
      return responses.map((r) => r.body as Record<string, unknown>);
    };

    try {
      switch (fact.type) {
        case 'overdue': {
          // Count invoices/items with overdue-like status
          const platform = fact.platform === 'database' ? null : fact.platform;
          let overdueCount = 0;
          let overdueTotal = 0;

          if (platform) {
            const invoices = getApiEntities(platform, 'invoices');
            for (const inv of invoices) {
              const status = inv.status as string;
              if (['past_due', 'overdue', 'unpaid', 'not_paid', 'payment_due'].includes(status)) {
                overdueCount++;
                overdueTotal += (inv.amount_due as number) ?? (inv.amount as number) ?? 0;
              }
            }
          } else {
            // Check DB invoices table
            const dbInvoices = tables.invoices ?? [];
            for (const row of dbInvoices) {
              const status = row.status as string;
              if (['past_due', 'overdue', 'unpaid'].includes(status)) {
                overdueCount++;
                overdueTotal += (row.amount_cents as number) ?? (row.amount as number) ?? 0;
              }
            }
          }

          if (overdueCount > 0) {
            reconciled.data.count = overdueCount;
            reconciled.data.total_amount = overdueTotal;
          }
          break;
        }

        case 'dispute': {
          const platform = fact.platform === 'database' ? null : fact.platform;
          if (platform) {
            const disputes = getApiEntities(platform, 'disputes');
            if (disputes.length > 0) {
              reconciled.data.count = disputes.length;
              const totalAmount = disputes.reduce(
                (sum, d) => sum + ((d.amount as number) ?? 0), 0,
              );
              if (totalAmount > 0) reconciled.data.total_amount = totalAmount;
            }
          }
          break;
        }

        case 'churn': {
          const platform = fact.platform === 'database' ? null : fact.platform;
          if (platform) {
            const subs = getApiEntities(platform, 'subscriptions');
            const canceled = subs.filter(
              (s) => ['canceled', 'cancelled', 'expired'].includes(s.status as string),
            );
            if (subs.length > 0) {
              reconciled.data.canceled_count = canceled.length;
              reconciled.data.total_subscriptions = subs.length;
              reconciled.data.churn_rate = subs.length > 0
                ? Math.round((canceled.length / subs.length) * 100) / 100
                : 0;
            }
          }
          break;
        }

        default:
          // For other fact types, keep the LLM claims as-is but flag
          // them as unverified if they have numeric data
          if (Object.keys(reconciled.data).length > 0) {
            reconciled.data._verified = false;
          }
          break;
      }
    } catch {
      // Reconciliation failure is non-fatal — keep the original fact
      logger.debug(`Could not reconcile fact "${fact.id}": error during validation`);
    }

    return reconciled;
  }

  // -----------------------------------------------------------------------
  // Normalize adapter keys: merge _arche / _extra suffixed entries
  // -----------------------------------------------------------------------

  /**
   * LLMs sometimes produce adapter keys with `_arche` or `_extra` suffixes
   * (e.g. `stripe_arche`, `klarna_arche`). Merge them into the canonical
   * adapter ID so downstream consumers find data under the expected key.
   */
  private normalizeAdapterKeys(
    apiResponses: Record<string, ApiResponseSet>,
  ): void {
    const suffixedKeys = Object.keys(apiResponses).filter(
      (k) => k.endsWith('_arche') || k.endsWith('_extra'),
    );

    for (const suffixedKey of suffixedKeys) {
      const canonical = suffixedKey
        .replace(/_arche$/, '')
        .replace(/_extra$/, '')
        .replace(/_/g, '-');

      // Also try without dash conversion (e.g. checkout_arche → checkout-com)
      const canonicalUnderscore = suffixedKey
        .replace(/_arche$/, '')
        .replace(/_extra$/, '');

      // Find the target key — prefer existing canonical key, then dash-converted
      const targetKey = apiResponses[canonical]
        ? canonical
        : apiResponses[canonicalUnderscore]
          ? canonicalUnderscore
          : canonical;

      if (apiResponses[targetKey]) {
        // Merge responses into existing canonical entry
        for (const [resourceType, responses] of Object.entries(
          apiResponses[suffixedKey]!.responses,
        )) {
          const existing =
            apiResponses[targetKey]!.responses[resourceType] ?? [];
          apiResponses[targetKey]!.responses[resourceType] = [
            ...existing,
            ...responses,
          ];
        }
      } else {
        // Promote to canonical key
        apiResponses[targetKey] = {
          ...apiResponses[suffixedKey]!,
          adapterId: targetKey,
        };
      }

      delete apiResponses[suffixedKey];
    }
  }

  // -----------------------------------------------------------------------
  // Fill missing required API fields using adapter prompt contexts
  // -----------------------------------------------------------------------

  /**
   * Use `promptContext.requiredFields` from each adapter to detect and fill
   * missing fields in expanded API response bodies. Acts as a deterministic
   * safety net regardless of LLM output quality.
   */
  private fillMissingApiRequiredFields(
    apiResponses: Record<string, ApiResponseSet>,
    promptContexts: Record<string, PromptContext>,
  ): void {
    for (const [adapterId, responseSet] of Object.entries(apiResponses)) {
      const ctx = promptContexts[adapterId];
      if (!ctx?.requiredFields) continue;

      for (const [resourceType, responses] of Object.entries(
        responseSet.responses,
      )) {
        const requiredFieldNames = ctx.requiredFields[resourceType];
        if (!requiredFieldNames || requiredFieldNames.length === 0) continue;

        let filledCount = 0;
        for (const response of responses) {
          const body = response.body as Record<string, unknown>;
          for (const fieldName of requiredFieldNames) {
            if (body[fieldName] !== undefined && body[fieldName] !== null) {
              continue;
            }
            body[fieldName] = inferApiFieldDefault(
              fieldName,
              body,
              ctx.amountFormat,
            );
            filledCount++;
          }
        }

        if (filledCount > 0) {
          logger.debug(
            `Filled ${filledCount} missing required field(s) in ${adapterId}.${resourceType}`,
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Volume parsing
// ---------------------------------------------------------------------------

const VOLUME_PATTERN = /^(\d+)\s*(day|week|month|year)s?$/i;

/**
 * Parse a volume string like "6 months" into a date range ending today.
 */
export function parseVolume(volume: string): TimeRange {
  const match = volume.trim().match(VOLUME_PATTERN);
  if (!match) {
    throw new Error(
      `Invalid volume format "${volume}".  Expected e.g. "6 months", "1 year", "30 days".`,
    );
  }

  const amount = parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();

  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const start = new Date(end);

  switch (unit) {
    case 'day':
      start.setDate(start.getDate() - amount);
      break;
    case 'week':
      start.setDate(start.getDate() - amount * 7);
      break;
    case 'month':
      start.setMonth(start.getMonth() - amount);
      break;
    case 'year':
      start.setFullYear(start.getFullYear() - amount);
      break;
  }

  start.setHours(0, 0, 0, 0);
  return { start, end };
}

// ---------------------------------------------------------------------------
// Schedule-based date generation
// ---------------------------------------------------------------------------

interface ScheduleConfig {
  frequency: string;
  dayOfMonth?: number;
  dayOfWeek?: number;
}

function generateScheduleDates(
  schedule: ScheduleConfig,
  range: TimeRange,
): Date[] {
  const dates: Date[] = [];
  const cursor = new Date(range.start);

  switch (schedule.frequency) {
    case 'daily':
      while (cursor <= range.end) {
        dates.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
      break;

    case 'weekly': {
      const dow = schedule.dayOfWeek ?? 1; // default Monday
      // Advance to first matching day
      while (cursor.getDay() !== dow && cursor <= range.end) {
        cursor.setDate(cursor.getDate() + 1);
      }
      while (cursor <= range.end) {
        dates.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 7);
      }
      break;
    }

    case 'biweekly': {
      const dow2 = schedule.dayOfWeek ?? 5; // default Friday
      while (cursor.getDay() !== dow2 && cursor <= range.end) {
        cursor.setDate(cursor.getDate() + 1);
      }
      while (cursor <= range.end) {
        dates.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 14);
      }
      break;
    }

    case 'monthly': {
      const dom = schedule.dayOfMonth ?? 1;
      cursor.setDate(dom);
      if (cursor < range.start) {
        cursor.setMonth(cursor.getMonth() + 1);
      }
      while (cursor <= range.end) {
        dates.push(new Date(cursor));
        cursor.setMonth(cursor.getMonth() + 1);
      }
      break;
    }

    case 'quarterly': {
      const dom3 = schedule.dayOfMonth ?? 1;
      cursor.setDate(dom3);
      if (cursor < range.start) {
        cursor.setMonth(cursor.getMonth() + 3);
      }
      while (cursor <= range.end) {
        dates.push(new Date(cursor));
        cursor.setMonth(cursor.getMonth() + 3);
      }
      break;
    }

    case 'yearly': {
      const dom4 = schedule.dayOfMonth ?? 1;
      cursor.setDate(dom4);
      if (cursor < range.start) {
        cursor.setFullYear(cursor.getFullYear() + 1);
      }
      while (cursor <= range.end) {
        dates.push(new Date(cursor));
        cursor.setFullYear(cursor.getFullYear() + 1);
      }
      break;
    }
  }

  return dates;
}

// ---------------------------------------------------------------------------
// Period splitting
// ---------------------------------------------------------------------------

function splitIntoPeriods(
  range: TimeRange,
  unit: 'day' | 'week' | 'month',
): TimeRange[] {
  const periods: TimeRange[] = [];
  const cursor = new Date(range.start);

  while (cursor < range.end) {
    const periodStart = new Date(cursor);
    let periodEnd: Date;

    switch (unit) {
      case 'day':
        periodEnd = new Date(cursor);
        periodEnd.setDate(periodEnd.getDate() + 1);
        periodEnd.setMilliseconds(periodEnd.getMilliseconds() - 1);
        cursor.setDate(cursor.getDate() + 1);
        break;

      case 'week':
        periodEnd = new Date(cursor);
        periodEnd.setDate(periodEnd.getDate() + 7);
        periodEnd.setMilliseconds(periodEnd.getMilliseconds() - 1);
        cursor.setDate(cursor.getDate() + 7);
        break;

      case 'month':
        periodEnd = new Date(cursor);
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        periodEnd.setMilliseconds(periodEnd.getMilliseconds() - 1);
        cursor.setMonth(cursor.getMonth() + 1);
        break;
    }

    // Clamp to the overall range end
    if (periodEnd! > range.end) {
      periodEnd = new Date(range.end);
    }

    periods.push({ start: periodStart, end: periodEnd! });
  }

  return periods;
}

// ---------------------------------------------------------------------------
// ID management
// ---------------------------------------------------------------------------

function createIdTracker(): IdTracker {
  return {
    counters: new Map(),
    lookup: new Map(),
    rows: new Map(),
  };
}

function assignAutoIncrementIds(
  row: Row,
  tableInfo: TableInfo | undefined,
  idTracker: IdTracker,
  tableName: string,
): void {
  if (!tableInfo) return;

  for (const col of tableInfo.columns) {
    if (col.isAutoIncrement && row[col.name] === undefined) {
      const counterKey = `${tableName}.${col.name}`;
      const current = idTracker.counters.get(counterKey) ?? 0;
      const next = current + 1;
      idTracker.counters.set(counterKey, next);
      row[col.name] = next;
    }
  }

  // Generate UUIDs for primary key columns that have a client-side UUID
  // default (e.g. Prisma @default(uuid())).  These are NOT auto-increment
  // but still need values before trackRow/resolveReferences can work.
  for (const pkColName of tableInfo.primaryKey) {
    if (row[pkColName] !== undefined) continue;
    const col = tableInfo.columns.find((c) => c.name === pkColName);
    if (!col) continue;
    if (col.hasDefault && isClientSideUuidDefault(col)) {
      row[pkColName] = crypto.randomUUID();
    }
  }
}

function trackRow(
  row: Row,
  tableInfo: TableInfo | undefined,
  idTracker: IdTracker,
  tableName: string,
): void {
  // Store the full row for correlated cross-column resolution
  if (!idTracker.rows.has(tableName)) {
    idTracker.rows.set(tableName, []);
  }
  idTracker.rows.get(tableName)!.push(row);

  if (tableInfo) {
    // Track the primary key value so FK references can resolve
    for (const pkCol of tableInfo.primaryKey) {
      const val = row[pkCol];
      if (val !== undefined) {
        const lookupKey = `${tableName}.${pkCol}`;
        if (!idTracker.lookup.has(lookupKey)) {
          idTracker.lookup.set(lookupKey, new Map());
        }
        const map = idTracker.lookup.get(lookupKey)!;
        map.set(val as string | number, val as number);
      }
    }
  } else {
    // No schema — track all fields as potential FK targets.
    // This handles API-only setups where archetype-expanded tables have
    // no schema but patterns still reference them via {{table.column}}.
    for (const [colName, val] of Object.entries(row)) {
      if (val === undefined || val === null) continue;
      const lookupKey = `${tableName}.${colName}`;
      if (!idTracker.lookup.has(lookupKey)) {
        idTracker.lookup.set(lookupKey, new Map());
      }
      const map = idTracker.lookup.get(lookupKey)!;
      map.set(val as string | number, val as number);
    }
  }
}

/**
 * Resolve `{{table_name.column_name}}` placeholder references in row values.
 *
 * Uses correlated resolution: when multiple fields in a row reference the same
 * parent table, ONE parent row is picked and ALL columns are read from it.
 * This ensures e.g. `{{customers.billing_platform}}` and `{{customers.id}}`
 * come from the same customer row.
 *
 * When `rng` is provided, references are resolved to a random parent row
 * (used during archetype expansion to distribute child rows across parents).
 * Without `rng`, the first parent row is used (original deterministic behaviour).
 */
/**
 * Known FieldVariation type strings — used to detect raw variation specs
 * that the LLM placed in `fields` or static entities instead of `vary`.
 */
const KNOWN_VARIATION_TYPES = new Set([
  'pick', 'range', 'decimal_range', 'sequence', 'uuid', 'derived',
  'timestamp', 'date', 'firstName', 'lastName', 'fullName', 'email', 'phone', 'companyName',
]);

/**
 * Detect and resolve raw FieldVariation objects left in a row.
 *
 * The LLM sometimes puts variation specs (e.g. `{ type: "sequence", prefix: "inv_p1_" }`)
 * directly in static entity fields or pattern fields instead of in `vary`.
 * This function finds them and resolves them using the FieldGenerator.
 */
function resolveInlineVariations(
  row: Row,
  tableName: string,
  fieldGen: FieldGenerator,
  index: number,
): void {
  for (const [fieldName, value] of Object.entries(row)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      'type' in (value as Record<string, unknown>) &&
      typeof (value as Record<string, unknown>).type === 'string' &&
      KNOWN_VARIATION_TYPES.has((value as Record<string, unknown>).type as string)
    ) {
      row[fieldName] = fieldGen.resolveVariation(
        value as unknown as FieldVariation,
        row,
        index,
        `${tableName}.${fieldName}`,
      );
    }
  }
}

const REF_PATTERN = /^\{\{(\w+)\.(\w+)\}\}$/;

function resolveReferences(row: Row, idTracker: IdTracker, rng?: SeededRandom): void {
  // First pass: collect all references grouped by table
  const refsByTable = new Map<string, { key: string; column: string }[]>();
  for (const [key, value] of Object.entries(row)) {
    if (typeof value !== 'string') continue;
    const match = value.match(REF_PATTERN);
    if (!match) continue;
    const refTable = match[1]!;
    const refColumn = match[2]!;
    if (!refsByTable.has(refTable)) refsByTable.set(refTable, []);
    refsByTable.get(refTable)!.push({ key, column: refColumn });
  }

  // Second pass: for each referenced table, pick ONE parent row and resolve all columns
  for (const [refTable, refs] of refsByTable) {
    const parentRows = idTracker.rows.get(refTable);
    if (parentRows && parentRows.length > 0) {
      // Pick one parent row (correlated resolution)
      const parentRow = rng ? rng.pick(parentRows) : parentRows[0]!;
      for (const ref of refs) {
        const val = parentRow[ref.column];
        if (val !== undefined && val !== null) {
          row[ref.key] = val;
        }
      }
    } else {
      // Fallback to old lookup-based resolution for non-PK columns
      // tracked without full row storage (e.g. no-schema tables)
      for (const ref of refs) {
        const lookupKey = `${refTable}.${ref.column}`;
        const lookupMap = idTracker.lookup.get(lookupKey);
        if (lookupMap && lookupMap.size > 0) {
          const values = [...lookupMap.values()];
          row[ref.key] = rng ? rng.pick(values) : values[0];
        }
      }
    }
  }
}

function reassignSequentialIds(
  rows: Row[],
  tableInfo: TableInfo | undefined,
  idTracker: IdTracker,
  tableName: string,
): void {
  if (!tableInfo) return;

  for (const col of tableInfo.columns) {
    if (!col.isAutoIncrement) continue;

    const counterKey = `${tableName}.${col.name}`;
    // Reset counter for clean sequential assignment
    let counter = idTracker.counters.get(counterKey) ?? 0;

    // Only reassign rows that were generated by patterns (not static entities)
    // Static entities already have IDs assigned
    for (const row of rows) {
      if (row[col.name] === undefined) {
        counter++;
        row[col.name] = counter;
      }
    }

    idTracker.counters.set(counterKey, counter);
  }
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/** Sort rows by the first date/timestamp column found in the table schema. */
function sortChronologically(
  rows: Row[],
  tableInfo: TableInfo | undefined,
): void {
  if (!tableInfo || rows.length < 2) return;

  const dateCol = tableInfo.columns.find((c) =>
    ['date', 'timestamp', 'timestamptz'].includes(c.type),
  );

  if (!dateCol) return;

  rows.sort((a, b) => {
    const aVal = a[dateCol.name];
    const bVal = b[dateCol.name];
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return -1;
    if (bVal == null) return 1;

    const aTime =
      aVal instanceof Date ? aVal.getTime() : new Date(String(aVal)).getTime();
    const bTime =
      bVal instanceof Date ? bVal.getTime() : new Date(String(bVal)).getTime();

    return aTime - bTime;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Distribute a total count across archetypes proportionally to their weights.
 * Handles rounding by adjusting the largest bucket.
 */
function distributeByWeight(
  archetypes: EntityArchetype[],
  totalCount: number,
): number[] {
  if (archetypes.length === 0) return [];
  if (archetypes.length === 1) return [totalCount];

  const totalWeight = archetypes.reduce((sum, a) => sum + a.weight, 0);
  const counts = archetypes.map((a) =>
    Math.round((a.weight / totalWeight) * totalCount),
  );

  // Adjust for rounding errors
  const diff = totalCount - counts.reduce((s, c) => s + c, 0);
  if (diff !== 0) {
    const maxIdx = counts.indexOf(Math.max(...counts));
    counts[maxIdx] += diff;
  }

  return counts;
}

function indexTables(schema: SchemaModel): Map<string, TableInfo> {
  const map = new Map<string, TableInfo>();
  for (const table of schema.tables) {
    map.set(table.name, table);
  }
  return map;
}

/**
 * Find the best date/timestamp column in a table and return an object
 * mapping it to the supplied date value (ISO string).
 */
function inferDateField(
  tableInfo: TableInfo | undefined,
  date: Date,
): Record<string, string> {
  if (!tableInfo) return {};

  const dateCol = tableInfo.columns.find((c) =>
    ['date', 'timestamp', 'timestamptz'].includes(c.type),
  );

  if (!dateCol) return {};

  if (dateCol.type === 'date') {
    return { [dateCol.name]: date.toISOString().split('T')[0]! };
  }

  return { [dateCol.name]: date.toISOString() };
}

// ---------------------------------------------------------------------------
// Missing required column fill
// ---------------------------------------------------------------------------

/**
 * After expansion, check every row against the schema. Any NOT NULL column
 * without a DB default that is missing from the data gets a generated value.
 * This handles LLM omissions (e.g. missing `balance`) and ORM-managed
 * columns like Prisma's `@updatedAt` which have no SQL default.
 */

// ---------------------------------------------------------------------------
// API field repair helpers
// ---------------------------------------------------------------------------

/**
 * Deserialize stringified JSON objects that the LLM sometimes produces.
 *
 * The LLM cannot express nested objects inside archetype `vary` blocks, so it
 * often serialises them via `derived` templates, producing string values like
 * `"{\"value\":\"29.00\",\"currency\":\"EUR\"}"`. This function parses them
 * back into real objects so adapters receive the correct types.
 */
function normalizeStringifiedObjects(body: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== 'string' || value.length < 2) continue;

    const trimmed = value.trim();
    const firstChar = trimmed[0];
    const lastChar = trimmed[trimmed.length - 1];

    if (
      (firstChar === '{' && lastChar === '}') ||
      (firstChar === '[' && lastChar === ']')
    ) {
      try {
        body[key] = JSON.parse(trimmed);
      } catch {
        // Not valid JSON — leave the string as-is
      }
    }
  }
}

/**
 * Infer a sensible default value for a missing API response field based on
 * the field name and the adapter's amount format convention.
 *
 * This is deliberately conservative — it produces structurally valid but
 * minimal placeholder values. The goal is to prevent adapter seeding from
 * crashing on missing required fields, not to generate rich synthetic data
 * (that is the LLM's job; this is the safety net).
 */
function inferApiFieldDefault(
  fieldName: string,
  body: Record<string, unknown>,
  amountFormat: string,
): unknown {
  const lower = fieldName.toLowerCase();

  // ── ID fields ──────────────────────────────────────────────────────────
  if (lower === 'id') {
    // Some resources use alternative PK names — alias from those
    return (
      body.pspReference ??
      body.token ??
      body.code ??
      `gen_${Math.random().toString(36).slice(2, 10)}`
    );
  }
  if (lower.endsWith('_id') || lower.endsWith('id')) {
    // FK reference — check if a matching field without suffix exists
    const base = fieldName.replace(/_?[Ii]d$/, '');
    if (base && body[base] !== undefined) return body[base];
    return `gen_${fieldName}_${Math.random().toString(36).slice(2, 10)}`;
  }

  // ── Number / identifier string fields ──────────────────────────────────
  if (lower.endsWith('number') || lower.endsWith('_number')) {
    const existingId = body.id ?? body.code;
    if (existingId) return String(existingId);
    return `NUM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }
  if (lower.endsWith('_reference') || lower === 'reference_id' || lower === 'external_id') {
    return `ref_${Math.random().toString(36).slice(2, 10)}`;
  }

  // ── Status / state fields ──────────────────────────────────────────────
  if (lower === 'status' || lower === 'state') return 'active';

  // ── Boolean fields ─────────────────────────────────────────────────────
  if (lower.startsWith('is_') || lower.startsWith('has_')) return false;
  if (lower === 'active' || lower === 'livemode' || lower === 'paid' || lower === 'approved') {
    return true;
  }

  // ── Timestamp / date fields ────────────────────────────────────────────
  if (
    lower.includes('created') ||
    lower.includes('date') ||
    lower.endsWith('_at') ||
    lower.endsWith('at') ||
    lower === 'first_seen' ||
    lower === 'last_seen' ||
    lower === 'create_time' ||
    lower === 'update_time'
  ) {
    // Prefer the record's own created timestamp for consistency
    const created = body.created ?? body.created_at ?? body.createdAt ?? body.createdDate;
    if (typeof created === 'number') return created;
    if (typeof created === 'string') return created;
    return Math.floor(Date.now() / 1000);
  }

  // ── Amount / monetary fields ───────────────────────────────────────────
  if (
    lower.includes('amount') ||
    lower === 'price' ||
    lower === 'total' ||
    lower === 'balance' ||
    lower === 'unit_amount' ||
    lower === 'unit_price' ||
    lower === 'transaction_amount'
  ) {
    return inferAmountDefault(amountFormat);
  }

  // ── Currency fields ────────────────────────────────────────────────────
  if (lower.includes('currency')) return 'USD';

  // ── Country fields ─────────────────────────────────────────────────────
  if (lower.includes('country')) return 'US';

  // ── Name / description fields ──────────────────────────────────────────
  if (lower === 'name' || lower === 'display_name') return 'Unknown';
  if (lower === 'description') return '';
  if (lower === 'given_name' || lower === 'first_name' || lower === 'firstname') return 'Jane';
  if (lower === 'family_name' || lower === 'last_name' || lower === 'lastname') return 'Doe';
  if (lower === 'full_name') return 'Jane Doe';

  // ── Email fields ───────────────────────────────────────────────────────
  if (lower === 'email' || lower === 'email_address') {
    const name = body.name ?? body.given_name ?? body.first_name;
    if (typeof name === 'string' && name.length > 0) {
      return `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`;
    }
    return 'user@example.com';
  }

  // ── Type / method / category fields ────────────────────────────────────
  if (lower === 'type') return 'default';
  if (lower === 'method' || lower === 'payment_method' || lower === 'payment_type') {
    return 'card';
  }
  if (lower === 'source_type') return 'CARD';
  if (lower === 'source') return { type: 'card' };
  if (lower === 'payment_method_type') return 'card';
  if (lower === 'scheme') return 'bacs';
  if (lower === 'interval_unit') return 'monthly';
  if (lower === 'store' || lower === 'store_identifier') return 'app_store';
  if (lower === 'kind') return 'chargeback';
  if (lower === 'reason') return 'general';
  if (lower === 'tax_category') return 'standard';

  // ── Token / reference string fields ────────────────────────────────────
  if (lower.endsWith('token') || lower.endsWith('_token')) {
    return `tok_${Math.random().toString(36).slice(2, 10)}`;
  }
  if (lower.endsWith('reference') || lower.endsWith('_reference')) {
    // FK reference — try to infer from the prefix (e.g. paymentPspReference)
    const refPrefix = fieldName.replace(/Reference$/, '').replace(/_reference$/, '');
    if (refPrefix && body[refPrefix] !== undefined) return body[refPrefix];
    return body.pspReference ?? body.id ?? `ref_${Math.random().toString(36).slice(2, 10)}`;
  }
  if (lower.endsWith('_code') || lower.endsWith('code')) {
    return body.id ? String(body.id) : 'default';
  }
  if (lower === 'status_detail') return 'accredited';

  // ── Nested object / array fields ───────────────────────────────────────
  if (
    lower === 'items' ||
    lower === 'order_lines' ||
    lower === 'line_items' ||
    lower === 'purchase_units' ||
    lower === 'billing_cycles' ||
    lower === 'packages' ||
    lower === 'currencies'
  ) {
    return [];
  }
  if (
    lower === 'subscriber' ||
    lower === 'subscriptions' ||
    lower === 'entitlements' ||
    lower === 'metadata' ||
    lower === 'details' ||
    lower === 'recurring' ||
    lower === 'current_billing_period' ||
    lower === 'billing_cycle' ||
    lower === 'amount_money' ||
    lower === 'payer'
  ) {
    return {};
  }
  // customer/merchant are string FK refs in Stripe/payment APIs, not objects
  if (lower === 'customer' || lower === 'merchant') {
    return `gen_${fieldName}_${Math.random().toString(36).slice(2, 10)}`;
  }
  if (lower.endsWith('_account') || lower.endsWith('_bank_account')) {
    return body.id ? String(body.id) : `ba_${Math.random().toString(36).slice(2, 10)}`;
  }

  // ── Identifier / code fields ───────────────────────────────────────────
  if (lower === 'identifier' || lower.endsWith('_identifier')) return fieldName;
  if (lower === 'object') return 'unknown';
  if (lower === 'token') {
    return `tok_${Math.random().toString(36).slice(2, 10)}`;
  }

  // ── Catch-all ──────────────────────────────────────────────────────────
  return null;
}

/**
 * Produce a zero-value amount in the correct format for the adapter.
 */
function inferAmountDefault(amountFormat: string): unknown {
  const fmt = amountFormat.toLowerCase();

  if (fmt.includes('object') || fmt.includes('{')) {
    // Object-based amounts: {value, currency} or {amount, currency}
    if (fmt.includes('currency_code')) {
      return { amount: '0', currency_code: 'USD' };
    }
    if (fmt.includes('amount')) {
      return { amount: 0, currency: 'USD' };
    }
    return { value: '0.00', currency: 'USD' };
  }

  if (fmt.includes('integer') || fmt.includes('cents') || fmt.includes('minor') || fmt.includes('paise') || fmt.includes('pence')) {
    return 0;
  }

  if (fmt.includes('decimal string')) {
    return '0.00';
  }

  // Default: decimal number
  return 0;
}

function fillMissingRequiredColumns(
  rows: Row[],
  tableInfo: TableInfo,
  rng: SeededRandom,
): void {
  // First pass: generate UUIDs for PK columns with client-side UUID defaults.
  // These have hasDefault=true (from Prisma @default(uuid())) but the actual
  // DB column has no DEFAULT — so we must generate values ourselves.
  for (const pkColName of tableInfo.primaryKey) {
    const col = tableInfo.columns.find((c) => c.name === pkColName);
    if (!col || !col.hasDefault || !isClientSideUuidDefault(col)) continue;

    const hasMissing = rows.some(
      (row) => row[col.name] === undefined || row[col.name] === null,
    );
    if (!hasMissing) continue;

    logger.debug(
      `Generating UUIDs for PK "${tableInfo.name}.${col.name}"`,
    );
    for (const row of rows) {
      if (row[col.name] === undefined || row[col.name] === null) {
        row[col.name] = crypto.randomUUID();
      }
    }
  }

  for (const col of tableInfo.columns) {
    // Skip columns that the DB handles: has default, nullable, auto-inc, generated
    if (col.hasDefault || col.isNullable || col.isAutoIncrement || col.isGenerated) {
      continue;
    }

    // Check if any row is missing this column
    const hasMissing = rows.some(
      (row) => row[col.name] === undefined || row[col.name] === null,
    );
    if (!hasMissing) continue;

    logger.debug(
      `Filling missing required column "${tableInfo.name}.${col.name}" (${col.type})`,
    );

    for (const row of rows) {
      if (row[col.name] !== undefined && row[col.name] !== null) continue;
      row[col.name] = generateColumnValue(col, rng);
    }
  }
}

/**
 * Generate a realistic value for a column based on its type.
 * Uses the seeded RNG for determinism.
 */
function generateColumnValue(col: ColumnInfo, rng: SeededRandom): unknown {
  // Check for enum columns first
  if (col.type === 'enum' && col.enumValues && col.enumValues.length > 0) {
    return rng.pick(col.enumValues);
  }

  switch (col.type) {
    case 'integer':
    case 'smallint':
      return rng.intBetween(0, 1000);
    case 'bigint':
      return rng.intBetween(0, 100000);
    case 'decimal':
    case 'float':
    case 'double':
      return rng.decimalBetween(1, 10000, col.scale ?? 2);
    case 'text':
    case 'varchar':
    case 'char':
      return '';
    case 'boolean':
      return rng.chance(0.5);
    case 'timestamptz':
    case 'timestamp':
      return new Date().toISOString();
    case 'date':
      return new Date().toISOString().split('T')[0];
    case 'time':
      return `${rng.intBetween(0, 23).toString().padStart(2, '0')}:${rng.intBetween(0, 59).toString().padStart(2, '0')}:00`;
    case 'uuid':
      return crypto.randomUUID();
    case 'json':
    case 'jsonb':
      return {};
    default:
      return null;
  }
}

/**
 * Remove rows that would violate unique constraints defined in the schema.
 * For each unique constraint (including PK), build a composite key from the
 * row values and keep only the first occurrence.  Works for any schema.
 */
function deduplicateByUniqueConstraints(
  rows: Row[],
  tableInfo: TableInfo,
): Row[] {
  // Collect all unique key sets: explicit unique constraints + primary key.
  // Skip PK if any PK column is missing from rows (e.g. UUID PKs that
  // haven't been generated yet — they'll be unique once assigned later).
  const uniqueKeySets: string[][] = [
    ...(tableInfo.uniqueConstraints ?? []),
  ];

  const pkCols = tableInfo.primaryKey;
  if (pkCols.length > 0) {
    const pkPresent = rows.length === 0 ||
      pkCols.every((c) => rows[0]![c] !== undefined);
    if (pkPresent) {
      uniqueKeySets.push(pkCols);
    }
  }

  if (uniqueKeySets.length === 0) return rows;

  // One Set per unique constraint to track seen composite keys
  const seenSets = uniqueKeySets.map(() => new Set<string>());
  const before = rows.length;

  const result = rows.filter((row) => {
    for (let i = 0; i < uniqueKeySets.length; i++) {
      const cols = uniqueKeySets[i]!;
      const key = cols.map((c) => String(row[c] ?? '')).join('\x00');
      if (seenSets[i]!.has(key)) return false;
      seenSets[i]!.add(key);
    }
    return true;
  });

  if (result.length < before) {
    logger.debug(
      `Deduped "${tableInfo.name}" by unique constraints: ${before} → ${result.length} rows`,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// API response post-processing helpers
// ---------------------------------------------------------------------------

/**
 * Identify the primary ID field for an API resource record.
 * Returns field name like 'id', 'order_id', 'session_id', etc.
 */
function findPrimaryIdField(
  body: Record<string, unknown>,
  resourceType: string,
): string | null {
  const SEQ = /^[a-z_]+p\d+_\d{3,}$/;

  // 1. Check 'id' field (Stripe, Chargebee convention)
  if (typeof body.id === 'string' && SEQ.test(body.id)) return 'id';

  // 2. Check singular resource type + '_id' (Klarna convention)
  // customer_tokens → customer_token_id, orders → order_id, etc.
  const singular = resourceType.endsWith('ses')
    ? resourceType                           // "usages" edge case
    : resourceType.endsWith('ies')
      ? resourceType.slice(0, -3) + 'y'     // entries → entry
      : resourceType.endsWith('es')
        ? resourceType.slice(0, -2)          // captures → captur... nah
        : resourceType.endsWith('s')
          ? resourceType.slice(0, -1)        // orders → order
          : resourceType;

  // Try exact match first, then underscored forms
  for (const candidate of [
    `${singular}_id`,
    `${resourceType.replace(/s$/, '')}_id`,
  ]) {
    if (
      typeof body[candidate] === 'string' &&
      SEQ.test(body[candidate] as string)
    ) {
      return candidate;
    }
  }

  // 3. Fallback: first field ending in _id with a sequence value,
  //    excluding common FK field names
  const fkFieldNames = new Set([
    'customer_id',
    'subscription_id',
    'invoice_id',
    'charge_id',
    'payment_intent_id',
    'item_id',
    'plan_id',
    'klarna_reference',
  ]);
  for (const [key, val] of Object.entries(body)) {
    if (fkFieldNames.has(key)) continue;
    if (
      typeof val === 'string' &&
      key.endsWith('_id') &&
      SEQ.test(val)
    ) {
      return key;
    }
  }

  return null;
}

/**
 * Known timestamp pairs: [startField, endField].
 * When both exist and end < start, swap them.
 */
const TIMESTAMP_PAIRS: [string, string][] = [
  ['current_period_start', 'current_period_end'],
  ['current_term_start', 'current_term_end'],
  ['start_date', 'end_date'],
  ['trial_start', 'trial_end'],
  ['created', 'expires_at'],
  ['created_at', 'expires_at'],
  ['created_at', 'updated_at'],
  ['created', 'updated_at'],
  ['started_at', 'expires_at'],
  ['captured_at', 'refunded_at'],
];

function fixTimestampOrdering(body: Record<string, unknown>): void {
  for (const [startKey, endKey] of TIMESTAMP_PAIRS) {
    const startVal = body[startKey];
    const endVal = body[endKey];
    if (startVal == null || endVal == null) continue;
    if (typeof startVal !== 'number' || typeof endVal !== 'number') continue;

    if (endVal < startVal) {
      // Swap so start < end
      body[startKey] = endVal;
      body[endKey] = startVal;
    }
  }
}

/**
 * Fix logically impossible field combinations.
 * Generic rules that apply across any payment/billing API.
 */
function fixLogicalConsistency(body: Record<string, unknown>): void {
  const status = body.status as string | undefined;
  if (!status) return;

  // ── paid boolean vs status ────────────────────────────────────────
  if ('paid' in body) {
    if (['failed', 'canceled', 'cancelled', 'pending', 'requires_payment_method'].includes(status)) {
      body.paid = false;
    } else if (['succeeded', 'paid'].includes(status)) {
      body.paid = true;
    }
  }

  // ── amount_due / amount_paid consistency ───────────────────────────
  const amountDue = body.amount_due as number | undefined;
  const amountPaid = body.amount_paid as number | undefined;

  if (amountDue !== undefined && amountPaid !== undefined) {
    if (['paid', 'succeeded'].includes(status)) {
      // Paid invoices: amount_paid should equal amount_due
      body.amount_paid = amountDue;
    } else if (['open', 'unpaid', 'not_paid', 'payment_due', 'void', 'voided'].includes(status)) {
      // Unpaid invoices: amount_paid should be 0
      body.amount_paid = 0;
    } else if (amountPaid > amountDue) {
      // General: amount_paid can't exceed amount_due
      body.amount_paid = amountDue;
    }
  }

  // ── total / amount_due consistency for invoices ────────────────────
  const total = body.total as number | undefined;
  if (total !== undefined && amountDue !== undefined) {
    if (amountDue > total && !['open', 'unpaid', 'not_paid'].includes(status)) {
      body.amount_due = total;
    }
  }
}

// ---------------------------------------------------------------------------
// Country → Currency mapping (ISO 3166-1 alpha-2 → ISO 4217)
// Covers the most common countries seen in payment/billing APIs.
// ---------------------------------------------------------------------------

const COUNTRY_CURRENCY: Record<string, string> = {
  US: 'USD', CA: 'CAD', MX: 'MXN',
  GB: 'GBP', IE: 'EUR', FR: 'EUR', DE: 'EUR', ES: 'EUR', IT: 'EUR',
  NL: 'EUR', BE: 'EUR', AT: 'EUR', PT: 'EUR', FI: 'EUR', GR: 'EUR',
  LU: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR', SK: 'EUR', SI: 'EUR',
  MT: 'EUR', CY: 'EUR',
  SE: 'SEK', NO: 'NOK', DK: 'DKK', CH: 'CHF',
  AU: 'AUD', NZ: 'NZD', JP: 'JPY', CN: 'CNY', HK: 'HKD', SG: 'SGD',
  KR: 'KRW', IN: 'INR', ID: 'IDR', MY: 'MYR', TH: 'THB', PH: 'PHP',
  VN: 'VND', TW: 'TWD',
  BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN',
  ZA: 'ZAR', NG: 'NGN', KE: 'KES', GH: 'GHS',
  AE: 'AED', SA: 'SAR', IL: 'ILS', TR: 'TRY',
  PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', HR: 'EUR',
  RU: 'RUB', UA: 'UAH',
};

// Build reverse map: currency → country (first match wins — used for fallback)
const CURRENCY_COUNTRY: Record<string, string> = {};
for (const [country, currency] of Object.entries(COUNTRY_CURRENCY)) {
  if (!CURRENCY_COUNTRY[currency]) CURRENCY_COUNTRY[currency] = country;
}

/**
 * Field name pairs to check: [countryField, currencyField].
 * We try several common naming conventions used across payment APIs.
 */
const COUNTRY_CURRENCY_FIELD_PAIRS: [string, string][] = [
  ['purchase_country', 'purchase_currency'],   // Klarna
  ['country', 'currency'],                     // Generic
  ['billing_country', 'billing_currency'],
  ['country_code', 'currency_code'],
];

/**
 * Fix country/currency mismatches by adjusting the currency to match the country.
 * If only currency exists (no country field), leave it alone.
 * If both exist and are inconsistent, currency is corrected to match the country.
 */
function fixCountryCurrencyConsistency(body: Record<string, unknown>): void {
  for (const [countryField, currencyField] of COUNTRY_CURRENCY_FIELD_PAIRS) {
    const country = body[countryField];
    const currency = body[currencyField];
    if (typeof country !== 'string' || typeof currency !== 'string') continue;

    const upperCountry = country.toUpperCase();
    const expectedCurrency = COUNTRY_CURRENCY[upperCountry];
    if (expectedCurrency && currency.toUpperCase() !== expectedCurrency) {
      // Preserve the original casing style (some APIs use lowercase, e.g. Klarna)
      const isLower = currency === currency.toLowerCase();
      body[currencyField] = isLower ? expectedCurrency.toLowerCase() : expectedCurrency;
    }
  }
}

/**
 * Clone a DataPattern with all `{{parentTable.column}}` references in its
 * field maps pre-resolved to values from a specific parent row.
 *
 * After this, the pattern can be expanded normally and `resolveReferences`
 * will only handle references to *other* tables.
 */
function resolveParentRefsInPattern(
  pattern: DataPattern,
  parentTableName: string,
  parentRow: Row,
): DataPattern {
  const clone: DataPattern = JSON.parse(JSON.stringify(pattern));

  const resolve = (fields: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value !== 'string') continue;
      fields[key] = value.replace(
        /\{\{(\w+)\.(\w+)\}\}/g,
        (match, table: string, column: string) => {
          if (table === parentTableName) {
            const val = parentRow[column];
            return val !== undefined && val !== null ? String(val) : match;
          }
          return match;
        },
      );
    }
  };

  if (clone.recurring) resolve(clone.recurring.fields);
  if (clone.variable) resolve(clone.variable.fields);
  if (clone.periodic) resolve(clone.periodic.fields);
  if (clone.event) resolve(clone.event.fields);

  return clone;
}

/**
 * Check if a column has a client-side UUID default.
 * Prisma @default(uuid()) / @default(cuid()) set hasDefault=true and
 * defaultValue to 'gen_random_uuid()' but the actual SQL column has NO
 * DEFAULT — so the application must generate values.
 */
function isClientSideUuidDefault(col: ColumnInfo): boolean {
  if (col.type === 'uuid') return true;
  if (col.defaultValue === 'gen_random_uuid()') return true;
  if (col.pgType === 'uuid') return true;
  return false;
}
