import type {
  Anchor,
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
  AdapterResourceSpecs,
} from '../types/index.js';
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
    resourceSpecs?: Record<string, AdapterResourceSpecs>,
  ): ExpandedData {
    const range = parseVolume(volume);
    const tables: Record<string, Row[]> = {};
    const idTracker = createIdTracker();
    const tableIndex = indexTables(schema);

    // Auto-inject `{ type: "timestamp" }` vary rules on DB archetypes for any
    // `@default(now())` timestamp column that the LLM left unspecified. The
    // LLM is encouraged to omit these columns (the schema renders them as
    // `DEFAULT now()` so they appear "DB-handled"), but in practice the seeder
    // can't mix per-row DEFAULT with explicit values in a batched INSERT — it
    // drops the column entirely and every row's timestamp collapses to seed-
    // insertion time. By injecting a deterministic vary rule bound to the
    // configured volume range, the LLM does no extra work and the column is
    // populated with realistic timestamps. LLM intent always wins: an explicit
    // `vary` or `fields` entry for the column is never overwritten.
    injectNowDefaultVaryRules(blueprint, schema, range);

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

    // Anchor resolver — resolves persona-narrated events (e.g. "Klein Records
    // double-charge on 2026-04-29") against the customer rows the LLM emits,
    // so anchor-bound archetypes on payments/invoices/Stripe payment_intent
    // all agree on the customer FK and the date. Lazy + cached; holds a live
    // reference to `tables`, so customer rows that arrive during PHASE D are
    // still findable when downstream anchor-bound archetypes expand.
    const anchorResolver = new AnchorResolver(
      blueprint.data.anchors,
      tables,
      schema,
      classifications,
    );

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

    // Per-resource set of IDs emitted by `apiOnly: true` archetypes. The
    // identity-row derivation step skips these so the entities only ever
    // appear on the API side, producing the persona's declared asymmetry.
    // Keyed by `${adapterId}.${resourceType}`. Lives only during expansion;
    // never serialized.
    const apiOnlyIds = new Map<string, Set<string>>();

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
          apiOnlyIds,
          anchorResolver,
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
    this.resolveApiCrossReferences(apiResponses, resourceSpecs);

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
          anchorResolver,
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
          blueprint, schema, schemaMapping, apiOnlyIds,
        );
      }

      // Handle identity tables not in insertionOrder
      for (const tableName of identitySet) {
        if (schema.insertionOrder.includes(tableName)) continue;
        if (tables[tableName] && tables[tableName]!.length > 0) continue;
        const classification = classificationMap.get(tableName)!;

        this.deriveIdentityTableRows(
          tables, apiResponses, classification, tableIndex, idTracker,
          blueprint, schema, schemaMapping, apiOnlyIds,
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
          schema, blueprint, schemaMapping, modelingConfig, apiOnlyIds,
          anchorResolver,
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
          const archetypeRows = this.expandArchetypes(config, tableName, tableInfo, idTracker, anchorResolver);
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
          const archetypeRows = this.expandArchetypes(config, tableName, tableInfo, idTracker, anchorResolver);
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
    // Fill `@default(now())` timestamp columns missing on rows BEFORE sorting.
    // Without this, the LLM omits e.g. `created_at` (because the DB has a
    // default), the seeder drops the whole column (so Postgres applies the
    // default consistently), and every row's `created_at` collapses to seed
    // insertion time — destroying the historical spread the persona asked for.
    for (const [tableName, rows] of Object.entries(tables)) {
      const tableInfo = tableIndex.get(tableName);
      if (tableInfo && rows.length > 0) {
        fillNowDefaultTimestamps(rows, tableInfo, range, this.rng);
      }
    }

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

    // The LLM sometimes emits UUID-shaped strings that aren't valid hex
    // (e.g. "u1b2c3d4-..." starting with 'u') for `uuid` columns. Postgres
    // rejects those on insert. Coerce any non-conforming PK values to real
    // UUIDs and propagate the swap through every FK that points to them.
    coerceUuidColumns(tables, schema);

    // ==================================================================
    // PHASE F: Cross-reference API ↔ DB (bidirectional sync)
    // ==================================================================
    this.crossReferenceApiWithDb(tables, apiResponses);

    // ==================================================================
    // PHASE F.5: Backfill missing cross-surface API entities
    // ==================================================================
    // Referential-integrity guarantee for cross-surface FKs. The 3-role
    // mirror flow only covers archetype-shaped DB rows; static
    // `data.entities[]` rows and any other inline path bypass it. A DB
    // payments row with `stripe_payment_intent_id = "pi_p1_klein_001"`
    // referencing a Stripe `payment_intent` that doesn't exist would
    // break a recovery agent walking DB → Stripe. This pass scans every
    // cross-surface FK declared in `schemaMapping`, finds DB values that
    // have no API counterpart, and synthesizes an API entity from the
    // DB row + linked rows.
    backfillMissingCrossSurfaceEntities(
      tables,
      apiResponses,
      schema,
      schemaMapping,
      blueprint.personaId,
    );

    // ==================================================================
    // PHASE G: Pass through blueprint facts (legacy) — real facts are
    // generated post-expansion from actual data stats via LLM call
    // ==================================================================

    return {
      personaId: blueprint.personaId,
      blueprint,
      tables,
      documents: {},
      apiResponses,
      files: [],
      events: [],
      facts: blueprint.data.facts ?? [],
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
    anchorResolver?: AnchorResolver,
  ): Row[] {
    const { count, archetypes } = config;

    // Split into three buckets:
    //   - anchored: emit exactly `archetype.count` rows tied to a resolved
    //     anchor (cross-table coherence; bypasses weight distribution).
    //   - explicit-count plain: archetype declares an explicit `count` but
    //     no anchor. Emits exactly that many rows; reduces the budget left
    //     for weight-distributed archetypes. This is the mechanism the LLM
    //     uses for persona claims like "exactly 4 card_expired failures".
    //   - weighted: no explicit count, distributed by `weight` across the
    //     remaining budget (config.count minus explicit-count claims).
    const weighted: EntityArchetype[] = [];
    const explicitCount: EntityArchetype[] = [];
    const anchored: EntityArchetype[] = [];
    for (const a of archetypes) {
      if (a.anchor && anchorResolver?.has(a.anchor)) anchored.push(a);
      else if (typeof a.count === 'number' && a.count > 0) explicitCount.push(a);
      else weighted.push(a);
    }

    const explicitTotal = explicitCount.reduce((s, a) => s + (a.count ?? 0), 0);
    const remainingForWeighted = Math.max(0, count - explicitTotal);
    if (explicitTotal > count) {
      logger.warn(
        `Archetype "${tableName}": explicit-count archetypes claim ${explicitTotal} rows, ` +
          `exceeding the configured count of ${count}. Honoring explicit counts; weighted ` +
          `archetypes will emit 0 rows.`,
      );
    }

    const distribution =
      weighted.length > 0 ? distributeByWeight(weighted, remainingForWeighted) : [];
    const rows: Row[] = [];

    logger.debug(
      `Expanding entities for "${tableName}": ${count} target ` +
        `(${explicitTotal} explicit-count across ${explicitCount.length} archetype(s), ` +
        `${remainingForWeighted} weighted across ${weighted.length} archetype(s))` +
        (anchored.length > 0 ? `, ${anchored.length} anchor-bound archetype(s)` : ''),
    );

    const emitRow = (archetype: EntityArchetype, i: number): void => {
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
    };

    for (const archetype of explicitCount) {
      const archetypeCount = archetype.count ?? 0;
      for (let i = 0; i < archetypeCount; i++) emitRow(archetype, i);
    }

    for (let arcIdx = 0; arcIdx < weighted.length; arcIdx++) {
      const archetype = weighted[arcIdx]!;
      const archetypeCount = distribution[arcIdx]!;
      for (let i = 0; i < archetypeCount; i++) emitRow(archetype, i);
    }

    for (const archetype of anchored) {
      const resolved = anchorResolver!.resolve(archetype.anchor!, { surface: 'db' });
      if (!resolved) continue;
      rewriteAnchorVaryRules(archetype, resolved);
      const archetypeCount = archetype.count ?? 1;
      for (let i = 0; i < archetypeCount; i++) emitRow(archetype, i);
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
    apiOnlyIds: Map<string, Set<string>>,
    anchorResolver?: AnchorResolver,
  ): ApiResponseSet {
    const responses: Record<string, ApiResponse[]> = {};
    const startSec = Math.floor(range.start.getTime() / 1000);
    const endSec = Math.floor(range.end.getTime() / 1000);

    // Two-pass within an adapter so anchor-bound archetypes can resolve
    // against customer entities the LLM emits in this same adapter:
    //
    //   Pass 1 — non-anchor archetypes (matched + apiOnly), all resources
    //   Pass 1.5 — register the freshly-expanded customers with the resolver
    //   Pass 2 — anchor-bound archetypes, all resources
    //
    // Without this, an anchor on `payment_intent` referencing customer
    // "Klein Records" would find an empty pool because the customer
    // resource hasn't been expanded yet (the DB customer table also hasn't
    // been derived yet — API expansion runs first).

    interface Bucket {
      resourceType: string;
      config: EntityArchetypeConfig;
      matched: EntityArchetype[];
      matchedExplicit: EntityArchetype[];
      apiOnly: EntityArchetype[];
      anchored: EntityArchetype[];
      expanded: ApiResponse[];
      orphanIdSet?: Set<string>;
    }

    const buckets: Bucket[] = [];
    for (const [resourceType, config] of Object.entries(resources)) {
      const { archetypes } = config;
      const matched: EntityArchetype[] = [];
      const matchedExplicit: EntityArchetype[] = [];
      const apiOnly: EntityArchetype[] = [];
      const anchored: EntityArchetype[] = [];
      for (const a of archetypes) {
        if (a.anchor && anchorResolver?.has(a.anchor)) anchored.push(a);
        else if (a.apiOnly) apiOnly.push(a);
        else if (typeof a.count === 'number' && a.count > 0) matchedExplicit.push(a);
        else matched.push(a);
      }
      buckets.push({
        resourceType,
        config,
        matched,
        matchedExplicit,
        apiOnly,
        anchored,
        expanded: [],
      });
    }

    const emit = (
      bucket: Bucket,
      archetype: EntityArchetype,
      i: number,
      isApiOnly: boolean,
    ): void => {
      const row = this.fieldGen.applyVariations(
        archetype.vary,
        archetype.fields,
        i,
        `${adapterId}.${bucket.resourceType}`,
      );

      // Ensure created timestamp falls within the configured date range.
      // Anchor-rewritten rows already carry a deterministic value here, so
      // the in-range check is a no-op for them.
      const createdKey =
        row.created !== undefined ? 'created' : row.created_at !== undefined ? 'created_at' : null;
      if (createdKey) {
        const ts = row[createdKey] as number;
        if (typeof ts === 'number' && (ts < startSec || ts > endSec)) {
          row[createdKey] = startSec + Math.floor(this.rng.next() * (endSec - startSec));
        }
      } else {
        row.created = startSec + Math.floor(this.rng.next() * (endSec - startSec));
      }

      if (isApiOnly) {
        if (!bucket.orphanIdSet) bucket.orphanIdSet = new Set<string>();
        const id = row.id;
        if (typeof id === 'string') bucket.orphanIdSet.add(id);
      }

      bucket.expanded.push({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: row,
        personaId,
        stateKey: `${adapterId}_${bucket.resourceType}`,
      });
    };

    // ── Pass 1: matched + apiOnly archetypes for every resource ──────
    for (const bucket of buckets) {
      const { count } = bucket.config;

      // Same three-bucket split as DB expansion: explicit-count matched
      // archetypes claim their rows first, weighted matched archetypes
      // share the remainder. apiOnly archetypes are additive (separate
      // budget, never reduce the matched count).
      const matchedExplicitTotal = bucket.matchedExplicit.reduce(
        (s, a) => s + (a.count ?? 0),
        0,
      );
      const remainingForWeighted = Math.max(0, count - matchedExplicitTotal);
      if (matchedExplicitTotal > count) {
        logger.warn(
          `API archetype "${adapterId}.${bucket.resourceType}": explicit-count archetypes ` +
            `claim ${matchedExplicitTotal} rows, exceeding the configured count of ${count}. ` +
            `Honoring explicit counts; weighted archetypes will emit 0 rows.`,
        );
      }

      const matchedDistribution = bucket.matched.length > 0
        ? distributeByWeight(bucket.matched, remainingForWeighted)
        : [];

      const totalApiOnly = bucket.apiOnly.reduce(
        (s, a) => s + (a.count ?? Math.max(1, Math.round((a.weight ?? 0) * count))),
        0,
      );

      logger.debug(
        `Expanding "${adapterId}.${bucket.resourceType}": ${count} matched ` +
          `(${matchedExplicitTotal} explicit-count across ${bucket.matchedExplicit.length} archetype(s), ` +
          `${remainingForWeighted} weighted across ${bucket.matched.length} archetype(s)) ` +
          `+ ${totalApiOnly} apiOnly + ${bucket.anchored.length} anchor-bound archetype(s)`,
      );

      for (const archetype of bucket.matchedExplicit) {
        const archetypeCount = archetype.count ?? 0;
        for (let i = 0; i < archetypeCount; i++) emit(bucket, archetype, i, false);
      }

      for (let arcIdx = 0; arcIdx < bucket.matched.length; arcIdx++) {
        const archetype = bucket.matched[arcIdx]!;
        const archetypeCount = matchedDistribution[arcIdx]!;
        for (let i = 0; i < archetypeCount; i++) emit(bucket, archetype, i, false);
      }

      for (const archetype of bucket.apiOnly) {
        const explicit = archetype.count ?? Math.max(1, Math.round((archetype.weight ?? 0) * count));
        for (let i = 0; i < explicit; i++) emit(bucket, archetype, i, true);
      }
    }

    // ── Pass 1.5: register expanded customer entities with the resolver
    // so anchor-bound archetypes in pass 2 can match by name. We treat any
    // resource type whose name starts with "customer" as the customer pool
    // (covers `customer` on Stripe, `customers` on Plaid-style APIs, etc.).
    if (anchorResolver) {
      const customerBucket = buckets.find((b) =>
        b.resourceType.toLowerCase().startsWith('customer'),
      );
      if (customerBucket) {
        anchorResolver.registerApiCustomers(
          adapterId,
          customerBucket.expanded.map((r) => r.body as Row),
        );
      }
    }

    // ── Pass 2: anchor-bound archetypes ──────────────────────────────
    for (const bucket of buckets) {
      for (const archetype of bucket.anchored) {
        const resolved = anchorResolver!.resolve(archetype.anchor!, {
          surface: 'api',
          adapterId,
        });
        if (!resolved) continue;
        rewriteAnchorVaryRules(archetype, resolved);
        const archetypeCount = archetype.count ?? 1;
        for (let i = 0; i < archetypeCount; i++) emit(bucket, archetype, i, false);
      }
    }

    // ── Finalize: orphan tracking + chronological sort ───────────────
    for (const bucket of buckets) {
      if (bucket.orphanIdSet && bucket.orphanIdSet.size > 0) {
        apiOnlyIds.set(`${adapterId}.${bucket.resourceType}`, bucket.orphanIdSet);
      }
      bucket.expanded.sort((a, b) => {
        const ca = (a.body as Record<string, unknown>).created as number ?? 0;
        const cb = (b.body as Record<string, unknown>).created as number ?? 0;
        return ca - cb;
      });
      responses[bucket.resourceType] = bucket.expanded;
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
   * Resolve cross-resource ID references within each adapter to real IDs.
   *
   * Walks every API response body and for each FK-style field rewrites the
   * value to a real ID from the parent resource's pool when the current
   * value isn't already a member of that pool. This covers two failure
   * modes:
   *
   *   1. `gen_*` placeholder values the LLM was told to emit when it didn't
   *      know the real ID at generation time.
   *   2. LLM-invented semantic strings (e.g. `cus_klein_records`) that look
   *      shaped like a real Stripe ID but reference nothing.
   *
   * Without this, both classes of value flow through to the expander's FK
   * resolver and break downstream joins. The pool-membership check ensures
   * legitimate refs are preserved unchanged.
   */
  private resolveApiCrossReferences(
    apiResponses: Record<string, ApiResponseSet>,
    allResourceSpecs?: Record<string, AdapterResourceSpecs>,
  ): void {
    // Hardcoded fallback FK map for adapters without ResourceSpecs
    const FALLBACK_FK_MAP: Record<string, string> = {
      customer: 'customer', customer_id: 'customer', customerId: 'customer',
      plan_id: 'plan', planId: 'plan',
      product_id: 'product', productId: 'product',
      price_id: 'price', priceId: 'price',
      subscription_id: 'subscription', subscriptionId: 'subscription',
      invoice_id: 'invoice', invoiceId: 'invoice',
      charge_id: 'charge', chargeId: 'charge',
      payment_intent_id: 'payment_intent', payment_intent: 'payment_intent',
      payment_method_id: 'payment_method', payment_method: 'payment_method',
      accountId: 'account', account_id: 'account',
      merchantAccountId: 'merchant',
      mandate_id: 'mandate', mandate: 'mandate',
      order_id: 'order', orderId: 'order',
      refund_id: 'refund',
      payout_id: 'payout',
      item_id: 'item',
      source_id: 'source',
      transaction_id: 'transaction',
      user_id: 'user', userId: 'user',
      team_id: 'team', teamId: 'team',
      channel_id: 'channel', channelId: 'channel',
    };

    for (const responseSet of Object.values(apiResponses)) {
      // Build the FK map: field name → target resource key.
      // Prefer ResourceSpecs (explicit ref declarations) over the hardcoded fallback.
      const fkMap = new Map<string, string>();
      const adapterSpecs = allResourceSpecs?.[responseSet.adapterId];

      if (adapterSpecs) {
        // Build from ResourceSpecs — each field with a `ref` property tells us
        // exactly which resource it references
        for (const [, spec] of Object.entries(adapterSpecs.resources)) {
          for (const [fieldName, fieldSpec] of Object.entries(spec.fields)) {
            if (fieldSpec.ref && !fkMap.has(fieldName)) {
              fkMap.set(fieldName, fieldSpec.ref);
            }
          }
        }
      }

      // Merge hardcoded fallback for any fields not already covered
      for (const [field, target] of Object.entries(FALLBACK_FK_MAP)) {
        if (!fkMap.has(field)) {
          fkMap.set(field, target);
        }
      }

      // Build ID pools per resource type within this adapter.
      // Register under both singular and plural forms so lookups
      // work regardless of whether the adapter uses "customer" or "customers".
      // Each pool also gets a Set for O(1) membership checks.
      const idPools = new Map<string, string[]>();
      const idPoolSets = new Map<string, Set<string>>();
      for (const [resourceType, responses] of Object.entries(responseSet.responses)) {
        const ids: string[] = [];
        for (const r of responses) {
          const body = r.body as Record<string, unknown>;
          if (typeof body.id === 'string') ids.push(body.id);
        }
        if (ids.length > 0) {
          const set = new Set(ids);
          idPools.set(resourceType, ids);
          idPoolSets.set(resourceType, set);
          const plural = resourceType.endsWith('s') ? resourceType : resourceType + 's';
          const singular = resourceType.endsWith('s') ? resourceType.slice(0, -1) : resourceType;
          if (!idPools.has(plural)) { idPools.set(plural, ids); idPoolSets.set(plural, set); }
          if (!idPools.has(singular)) { idPools.set(singular, ids); idPoolSets.set(singular, set); }
        }
      }

      if (idPools.size === 0) continue;

      // Rewrite any FK-style field whose value isn't in the resolved id pool.
      // This catches both `gen_xyz` placeholders (LLM was told to use them)
      // AND LLM-invented semantic ids ("cus_klein_records") that don't match
      // the actual entity ids the system generated. Out-of-pool values would
      // otherwise break cross-surface joins downstream.
      let resolvedCount = 0;
      let nulledCount = 0;
      for (const responses of Object.values(responseSet.responses)) {
        for (const r of responses) {
          const body = r.body as Record<string, unknown>;
          for (const [field, parentResource] of fkMap) {
            const val = body[field];
            if (typeof val !== 'string') continue;
            const pool = idPools.get(parentResource);
            const poolSet = idPoolSets.get(parentResource);
            if (!pool || pool.length === 0) {
              // No pool to rewrite to. Only null out `gen_` placeholders so
              // we don't clobber values that might be meaningful elsewhere.
              if (val.startsWith('gen_')) {
                body[field] = null;
                nulledCount++;
              }
              continue;
            }
            if (poolSet!.has(val)) continue;  // valid ref, leave it
            body[field] = this.rng.pick(pool);
            resolvedCount++;
          }
        }
      }

      if (resolvedCount > 0 || nulledCount > 0) {
        logger.debug(
          `Cross-ref resolution in ${responseSet.adapterId}: ${resolvedCount} resolved, ${nulledCount} nulled (no pool)`,
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
    blueprint: Blueprint,
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
    apiOnlyIds?: Map<string, Set<string>>,
    anchorResolver?: AnchorResolver,
  ): void {
    const tableName = classification.table;
    const tableInfo = tableIndex.get(tableName);
    let allRows: Row[] = [];

    if (!classification.sources || classification.sources.length === 0) return;

    // Flat union of all apiOnly entity IDs across every adapter+resource.
    // Used to drop mirrored rows whose FK refs point at apiOnly identities —
    // orphan-ness propagates transitively (an invoice for an orphan customer
    // lives on the API side only and never mirrors to DB).
    const allApiOnlyIds = new Set<string>();
    if (apiOnlyIds) {
      for (const set of apiOnlyIds.values()) {
        for (const id of set) allApiOnlyIds.add(id);
      }
    }

    // Build field mappings from schema mapping + config overrides.
    // Both bridge-table entries (legacy) and non-bridge id entries (IDENTITY
    // CONTRACT pattern) contribute. For non-bridge entries, the LLM only
    // produced one mapping per cross-surface column (apiField === 'id'); other
    // body fields fall through to API_TO_DB_MAP / configFieldMap below.
    const fieldMappings = new Map<string, SchemaMappingEntry[]>();
    if (schemaMapping) {
      for (const entry of schemaMapping.mappings) {
        if (entry.dbTable !== tableName) continue;
        const key = `${entry.adapterId}:${entry.apiResource}`;
        const group = fieldMappings.get(key) ?? [];
        group.push(entry);
        fieldMappings.set(key, group);
      }
    }

    const hasBillingPlatformCol = tableInfo?.columns.some(c => c.name === 'billing_platform');
    const hasExternalIdCol = tableInfo?.columns.some(c => c.name === 'external_id');

    // Cross-surface FK columns this table uses (driven by schema mapping).
    // We use these to:
    //   1. Skip derivation for IDs already claimed by a static narrative entity.
    //   2. Dedup statics + derived in deduplicateByUniqueConstraints below.
    const fkColumnsForTable = new Set<string>();
    if (schemaMapping && tableInfo) {
      const tableColumnNames = new Set(tableInfo.columns.map(c => c.name));
      for (const entry of schemaMapping.mappings) {
        if (entry.dbTable !== tableName) continue;
        if (entry.isBridgeTable) continue;
        if (entry.apiField !== 'id') continue;
        if (!tableColumnNames.has(entry.dbColumn)) continue;
        fkColumnsForTable.add(entry.dbColumn);
      }
    }

    // Process narrative-named static entities FIRST so their hand-coded
    // auto-increment ids land before derived rows take adjacent ids.
    // assignAutoIncrementIds bumps the counter to max(current, hand-coded id),
    // so subsequent derive-loop ids skip past the static-claimed range.
    const staticRows = blueprint.data.entities?.[tableName] ?? [];
    const staticClaimedCrossSurfaceIds = new Set<string>();
    for (const ent of staticRows) {
      for (const fkCol of fkColumnsForTable) {
        const v = (ent as Row)[fkCol];
        if (typeof v === 'string') staticClaimedCrossSurfaceIds.add(v);
      }
    }
    if (staticRows.length > 0) {
      for (let i = 0; i < staticRows.length; i++) {
        const row = { ...staticRows[i]! } as Row;
        resolveInlineVariations(row, tableName, this.fieldGen, i);
        assignAutoIncrementIds(row, tableInfo, idTracker, tableName);
        resolveReferences(row, idTracker);
        allRows.push(row);
        trackRow(row, tableInfo, idTracker, tableName);
      }
    }

    // Expand DB archetypes that emit dedicated rows for this mirrored table.
    // Two cases trigger emission (and only these):
    //
    //   1. Anchor-bound archetypes targeting a persona event (Klein
    //      double-charge, Larkspur drift). The LLM uses these to pin a
    //      specific customer + date(s) on the DB side. When the archetype
    //      hardcodes its cross-surface id column in `fields` (e.g.
    //      `stripe_subscription_id: "sub_lark_drift_001"`), the row is
    //      added to `staticClaimedCrossSurfaceIds` so the API mirror loop
    //      below skips the matching API entity — DB and API end up with
    //      one row each, sharing the id but free to diverge on body
    //      fields (the DRIFT pattern). When the archetype uses a
    //      `sequence` vary rule for the cross-surface id instead, the
    //      mirror loop won't be able to dedupe (different ids); the
    //      backfill pass in PHASE F.5 synthesizes a matching API entity.
    //
    //   2. Explicit-count plain archetypes (no anchor, no apiOnly,
    //      `count > 0`). These give the LLM a way to land an exact
    //      number of rows on a mirrored DB table without declaring an
    //      anchor — e.g. "exactly 4 historical card_expired failures
    //      with backdated timestamps." Same id-claim mechanic as anchor
    //      rows.
    //
    // Both flows go through assignAutoIncrementIds / trackRow so PK
    // counters and FK lookups stay coherent with mirror-derived rows.
    const dbArchetypes = blueprint.data.entityArchetypes?.[tableName];
    if (dbArchetypes && tableInfo) {
      for (const archetype of dbArchetypes.archetypes) {
        const isAnchorBound =
          !!archetype.anchor && !!anchorResolver?.has(archetype.anchor);
        const isExplicitCountPlain =
          !archetype.anchor &&
          !archetype.apiOnly &&
          typeof archetype.count === 'number' &&
          archetype.count > 0;
        if (!isAnchorBound && !isExplicitCountPlain) continue;

        let archetypeCount: number;
        if (isAnchorBound) {
          const resolved = anchorResolver!.resolve(archetype.anchor!, {
            surface: 'db',
          });
          if (!resolved) continue;
          rewriteAnchorVaryRules(archetype, resolved);
          archetypeCount = archetype.count ?? 1;
        } else {
          archetypeCount = archetype.count!;
        }

        for (let i = 0; i < archetypeCount; i++) {
          const row = this.fieldGen.applyVariations(
            archetype.vary,
            archetype.fields,
            i,
            tableName,
          );
          assignAutoIncrementIds(row, tableInfo, idTracker, tableName);
          resolveReferences(row, idTracker, this.rng);

          // Claim every cross-surface id this row owns so the mirror loop
          // below skips a matching API entity (drift) and the backfill
          // pass synthesizes whatever's still missing.
          for (const fkCol of fkColumnsForTable) {
            const v = row[fkCol];
            if (typeof v === 'string') staticClaimedCrossSurfaceIds.add(v);
          }

          allRows.push(row);
          trackRow(row, tableInfo, idTracker, tableName);
        }
      }
    }

    for (const source of classification.sources) {
      const sourceKey = `${source.adapter}.${source.resource}`;
      const responseSet = apiResponses[source.adapter];
      if (!responseSet) continue;

      const responses = responseSet.responses[source.resource];
      if (!responses || responses.length === 0) continue;

      // Get field mappings for this source (both bridge and non-bridge entries)
      const mappings = fieldMappings.get(`${source.adapter}:${source.resource}`) ?? [];

      // Get config-level field mapping overrides
      const configFieldMap = modelingConfig?.fieldMappings?.[tableName];
      const sourceFieldMap = configFieldMap?.[sourceKey] ?? configFieldMap?.['*'] ?? {};

      const sourceRows: Row[] = [];

      // apiOnly entities for this exact source (e.g. apiOnly invoices) skip
      // mirroring directly. These IDs are also in `allApiOnlyIds` for the
      // transitive ref check below, but a same-resource skip is clearer.
      const sourceApiOnlyIds = apiOnlyIds?.get(`${source.adapter}.${source.resource}`);
      let mirroredSkippedDueToOrphanRef = 0;
      let mirroredSkippedDueToApiOnly = 0;

      for (const apiResponse of responses) {
        const body = apiResponse.body as Record<string, unknown>;

        // Skip derivation for IDs already claimed by a static narrative entity
        // (the static row carries persona content this generic row would lose).
        if (typeof body.id === 'string' && staticClaimedCrossSurfaceIds.has(body.id)) continue;

        // Skip if this entity itself was emitted by an apiOnly archetype.
        if (sourceApiOnlyIds && typeof body.id === 'string' && sourceApiOnlyIds.has(body.id)) {
          mirroredSkippedDueToApiOnly++;
          continue;
        }

        // Transitive skip: if the row's identity-FK ref points at an apiOnly
        // identity (e.g. an invoice whose `customer` is a Stripe-only orphan),
        // skip it. The API mock still serves the entity, but it has no DB row.
        if (allApiOnlyIds.size > 0 && classification.identityFks) {
          let pointsAtOrphan = false;
          for (const fkRule of classification.identityFks) {
            let refValue: unknown = body[fkRule.apiField];
            if (typeof refValue === 'object' && refValue !== null && 'id' in refValue) {
              refValue = (refValue as Record<string, unknown>).id;
            }
            if (typeof refValue === 'string' && allApiOnlyIds.has(refValue)) {
              pointsAtOrphan = true;
              break;
            }
          }
          if (pointsAtOrphan) {
            mirroredSkippedDueToOrphanRef++;
            continue;
          }
        }

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

        // Secondary cross-surface FK columns: a single DB table may have
        // multiple cross-surface ID columns pointing at DIFFERENT API resources
        // — e.g. payments.stripe_payment_id ← stripe.charge.id AND
        // payments.stripe_payment_intent_id ← stripe.payment_intent.id. The
        // current source covers only one of them; the other resource's ID is
        // typically present on the body as a ref field named after the
        // resource (Stripe convention: charge.payment_intent = "pi_..."). Use
        // that to populate the secondary FK column without needing to derive
        // a second set of rows.
        if (schemaMapping) {
          for (const entry of schemaMapping.mappings) {
            if (entry.dbTable !== tableName) continue;
            if (entry.isBridgeTable) continue;
            if (entry.apiField !== 'id') continue;
            if (entry.adapterId !== source.adapter) continue;
            if (entry.apiResource === source.resource) continue;
            if (row[entry.dbColumn] !== undefined) continue;
            const refValue = body[entry.apiResource];
            if (typeof refValue === 'string') {
              row[entry.dbColumn] = refValue;
            } else if (
              typeof refValue === 'object' && refValue !== null &&
              'id' in (refValue as Record<string, unknown>)
            ) {
              const id = (refValue as Record<string, unknown>).id;
              if (typeof id === 'string') row[entry.dbColumn] = id;
            }
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

      if (mirroredSkippedDueToApiOnly > 0 || mirroredSkippedDueToOrphanRef > 0) {
        logger.debug(
          `Mirrored "${tableName}" from ${sourceKey}: skipped ${mirroredSkippedDueToApiOnly} apiOnly entit${mirroredSkippedDueToApiOnly === 1 ? 'y' : 'ies'} ` +
          `+ ${mirroredSkippedDueToOrphanRef} entit${mirroredSkippedDueToOrphanRef === 1 ? 'y' : 'ies'} referencing apiOnly identities`,
        );
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

    // (Static entities were already processed before the source loop above.)

    // Apply DB archetype enrichment to mirrored rows. The mirror flow only
    // copies fields the schema mapping declared; DB-only columns the LLM
    // described in `entityArchetypes` (e.g. `vary.failure_reason: pick` on a
    // "failed" archetype, or persona-shaped `fields.payment_method`) were
    // previously discarded because mirrored tables skip `expandArchetypes`.
    //
    // For each mirrored row, find the archetype whose constant `fields` agree
    // with the row's already-populated values (so a row with `status=failed`
    // matches `historical-failed` but not `*-succeeded`), then fill any
    // columns the row hasn't already set from that archetype's `fields` and
    // `vary` rules. Sequence/uuid variations are skipped so we don't overwrite
    // mirrored IDs the mirror flow already produced.
    if (allRows.length > 0 && tableInfo) {
      this.enrichMirroredRowsFromArchetypes(allRows, blueprint, tableName, tableInfo);
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

  /**
   * Apply DB-archetype enrichment to a set of mirrored rows. For each row,
   * pick the archetype whose `fields` constants are non-conflicting with the
   * row (a status="failed" row matches the "historical-failed" archetype, not
   * the "*-succeeded" ones), and fill any unset columns from that archetype's
   * `fields` and `vary`. Sequence/uuid variations are skipped to avoid
   * overwriting IDs the mirror flow already populated.
   */
  private enrichMirroredRowsFromArchetypes(
    rows: Row[],
    blueprint: Blueprint,
    tableName: string,
    tableInfo: TableInfo,
  ): void {
    const dbArchetypes = blueprint.data.entityArchetypes?.[tableName];
    const all = dbArchetypes?.archetypes ?? [];
    // Skip anchor-bound archetypes — they're meant to emit dedicated rows, not
    // enrich mirrored ones.
    const candidates = all.filter((a) => !a.anchor);
    if (candidates.length === 0) return;

    const dbColumnNames = new Set(tableInfo.columns.map((c) => c.name));
    let enriched = 0;
    let rowsTouched = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;

      // An archetype "matches" the row when, for every constant the archetype
      // declares in `fields`, the row either hasn't set that field yet or has
      // the same value. A conflicting value (row.status="failed" vs
      // archetype.fields.status="succeeded") disqualifies the archetype.
      const matching = candidates.filter((a) =>
        Object.entries(a.fields).every(([k, v]) => {
          const rv = row[k];
          if (rv === undefined || rv === null) return true;
          return rv === v;
        }),
      );
      if (matching.length === 0) continue;

      // Round-robin among matching archetypes for variety. Deterministic
      // because the row order is deterministic (driven by API response order
      // which is itself driven by the seeded archetype expansion).
      const archetype = matching[i % matching.length]!;

      let touched = false;

      // Constant fields: apply only when the row hasn't already set this
      // column. The schema mapping wins when it produced a value; the
      // archetype fills the gap.
      for (const [field, value] of Object.entries(archetype.fields)) {
        if (row[field] !== undefined && row[field] !== null) continue;
        if (!dbColumnNames.has(field)) continue;
        row[field] = value;
        enriched++;
        touched = true;
      }

      // Variations: apply only when the row hasn't already set this column.
      // Skip sequence/uuid — those generate fresh IDs that would collide with
      // mirror-populated cross-surface columns.
      for (const [field, variation] of Object.entries(archetype.vary)) {
        if (row[field] !== undefined && row[field] !== null) continue;
        if (!dbColumnNames.has(field)) continue;
        if (variation.type === 'sequence' || variation.type === 'uuid') continue;
        row[field] = this.fieldGen.resolveVariation(
          variation, row, i, `${tableName}.${field}`,
        );
        enriched++;
        touched = true;
      }

      if (touched) rowsTouched++;
    }

    if (enriched > 0) {
      logger.debug(
        `Mirrored table "${tableName}": archetype-enriched ${enriched} value(s) across ${rowsTouched} row(s)`,
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
    schemaMapping?: SchemaMapping,
    apiOnlyIds?: Map<string, Set<string>>,
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

    // Per-source cross-surface FK column lookup (the IDENTITY CONTRACT pattern).
    // For tables that DON'T have `external_id` but DO have a column like
    // `stripe_customer_id` mapping to `stripe.customer.id`, we derive the FK
    // column from the schema mapping and populate it with `body.id`. Without
    // this, derived rows would have NULL in that column and DB↔API joins fail.
    const fkColumnByAdapterResource = new Map<string, string>();
    if (schemaMapping && tableInfo) {
      const tableColumnNames = new Set(tableInfo.columns.map(c => c.name));
      for (const entry of schemaMapping.mappings) {
        if (entry.dbTable !== tableName) continue;
        if (entry.isBridgeTable) continue;
        if (entry.apiField !== 'id') continue;
        if (!tableColumnNames.has(entry.dbColumn)) continue;
        fkColumnByAdapterResource.set(`${entry.adapterId}.${entry.apiResource}`, entry.dbColumn);
      }
    }

    // Collect IDs claimed by narrative-named static entities so we can skip
    // those during API derivation. The static entity wins because it carries
    // persona-specific content (name, plan, mrr_cents, support narrative)
    // that the generic derived row would lose.
    const staticClaimedIds = new Set<string>();
    const fkColumns = Array.from(new Set(fkColumnByAdapterResource.values()));
    const staticEntityRows = blueprint.data.entities[tableName] ?? [];
    for (const ent of staticEntityRows) {
      const ext = (ent as Row).external_id;
      if (typeof ext === 'string') staticClaimedIds.add(ext);
      for (const fkCol of fkColumns) {
        const v = (ent as Row)[fkCol];
        if (typeof v === 'string') staticClaimedIds.add(v);
      }
    }

    // Process static narrative-named entities FIRST so their hand-coded auto-
    // increment ids (e.g. `id: 1` for Klein Records) land cleanly. The
    // counter-bumping in `assignAutoIncrementIds` ensures derived rows in the
    // loop below skip past these ids and don't collide on the PK.
    if (staticEntityRows.length > 0) {
      for (let i = 0; i < staticEntityRows.length; i++) {
        const row = { ...staticEntityRows[i]! } as Row;
        resolveInlineVariations(row, tableName, this.fieldGen, i);
        assignAutoIncrementIds(row, tableInfo, idTracker, tableName);
        resolveReferences(row, idTracker);
        allRows.push(row);
        trackRow(row, tableInfo, idTracker, tableName);
      }
    }

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

      // IDs emitted by `apiOnly: true` archetypes for this resource. These
      // entities exist on the API side only — skipping derivation here is
      // what produces the persona's declared cross-platform asymmetry.
      const orphanIds = apiOnlyIds?.get(`${source.adapter}.${source.resource}`);

      const matchedCount = orphanIds ? responses.length - orphanIds.size : responses.length;
      logger.debug(
        `Deriving identity table "${tableName}" rows from ${source.adapter}.${source.resource}: ` +
        `${matchedCount} matched + ${orphanIds?.size ?? 0} apiOnly (skipped) of ${responses.length} entities`,
      );

      // Build a per-row archetype assignment that respects each archetype's
      // explicit `count`. Archetypes with `count > 0` (persona-named singletons
      // like `klein-records: count: 1`) are applied to exactly that many rows
      // and never spread further; archetypes that rely on `weight` distribute
      // across the remaining row budget proportionally. Without this, simple
      // round-robin (`templatePool[i % len]`) cycles each archetype across
      // ~rows/len rows — so a `klein-records` archetype with `count: 1` would
      // tag ~8 customers as "Klein Records," which Phase 2b of
      // crossReferenceApiWithDb then propagates back to the API side.
      const platformArchetypes = archetypeTemplates.filter(
        a => a.fields.billing_platform === source.adapter ||
             a.fields.billing_platform === source.discriminator?.value,
      );
      const templatePool = platformArchetypes.length > 0 ? platformArchetypes : archetypeTemplates;

      const assignments = buildIdentityTemplateAssignments(
        templatePool,
        responses.length,
      );

      for (let i = 0; i < responses.length; i++) {
        const apiResponse = responses[i]!;
        const body = apiResponse.body as Record<string, unknown>;

        // Skip derivation for IDs already claimed by a static narrative-named
        // entity — the static entity carries persona content this generic row
        // would lose.
        if (typeof body.id === 'string' && staticClaimedIds.has(body.id)) continue;

        // Skip apiOnly entities — they live only on the API side.
        if (orphanIds && typeof body.id === 'string' && orphanIds.has(body.id)) continue;

        const row: Row = {};

        // 1. Set billing_platform
        if (hasBillingPlatformCol) {
          if (source.discriminator) {
            row[source.discriminator.column] = source.discriminator.value;
          } else {
            row.billing_platform = source.adapter;
          }
        }

        // 2. Set external_id from API entity ID (bridge-table pattern)
        if (hasExternalIdCol && typeof body.id === 'string') {
          row.external_id = body.id;
        }

        // 2b. Set cross-surface FK column from API entity ID (IDENTITY CONTRACT
        // pattern: tables without `external_id` use a column like
        // `stripe_customer_id` to store the API ID).
        const fkColumn = fkColumnByAdapterResource.get(`${source.adapter}.${source.resource}`);
        if (fkColumn && typeof body.id === 'string') {
          row[fkColumn] = body.id;
        }

        // 3. Map common fields from API → DB
        for (const [apiField, dbCol] of API_TO_DB_MAP) {
          const apiValue = body[apiField];
          if (apiValue !== undefined && apiValue !== null) {
            row[dbCol] = apiValue;
          }
        }

        // 4. Apply DB-only columns from the per-row archetype assignment.
        // Honors archetype.count for persona-named singletons; otherwise
        // distributes by weight across remaining rows.
        if (templatePool.length > 0) {
          const template = assignments[i] ?? templatePool[i % templatePool.length]!;
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

    // (Static entities were already prepended above so their hand-coded
    // auto-increment ids land cleanly before derived rows take their slots.)

    // Expand DB archetypes for non-API-linked entities (e.g., free-tier users
    // with no billing_platform). In 3-role flow, identity rows are derived from
    // API entities, but archetypes that don't reference any billing platform
    // still need to be expanded independently.
    if (dbArchetypes && hasBillingPlatformCol) {
      const sourceAdapters = new Set(
        (classification.sources ?? []).map(s => s.discriminator?.value ?? s.adapter),
      );
      const nonApiArchetypes = archetypeTemplates.filter(a => {
        const bp = a.fields.billing_platform;
        // Include archetypes with no billing_platform or null/empty
        if (bp === undefined || bp === null || bp === '' || bp === 'none') return true;
        // Exclude archetypes already covered by API derivation
        if (sourceAdapters.has(bp as string)) return false;
        return true;
      });
      if (nonApiArchetypes.length > 0) {
        const totalNonApiWeight = nonApiArchetypes.reduce((s, a) => s + a.weight, 0);
        const nonApiCount = Math.round(dbArchetypes.count * totalNonApiWeight);
        if (nonApiCount > 0) {
          const nonApiConfig = { count: nonApiCount, archetypes: nonApiArchetypes };
          const dbOnlyRows = this.expandArchetypes(
            nonApiConfig, tableName, tableInfo, idTracker,
          );
          allRows.push(...dbOnlyRows);
          logger.debug(
            `Identity table "${tableName}": expanded ${dbOnlyRows.length} non-API-linked rows from ${nonApiArchetypes.length} archetype(s)`,
          );
        }
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
    if (!col.isAutoIncrement) continue;
    const counterKey = `${tableName}.${col.name}`;
    if (row[col.name] === undefined) {
      const current = idTracker.counters.get(counterKey) ?? 0;
      const next = current + 1;
      idTracker.counters.set(counterKey, next);
      row[col.name] = next;
    } else {
      // Pre-set (e.g. a hand-coded static entity with `id: 5`). Bump the
      // counter to max(current, this id) so subsequent auto-assigns don't
      // collide with values the static rows already claimed.
      const v = row[col.name];
      if (typeof v === 'number') {
        const current = idTracker.counters.get(counterKey) ?? 0;
        if (v > current) idTracker.counters.set(counterKey, v);
      }
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

/**
 * Pre-compute the per-row archetype assignment for `deriveIdentityTableRows`,
 * honoring `archetype.count` for persona-named singletons.
 *
 * The original identity-derive code used `templatePool[i % len]` round-robin —
 * a simple variety mechanism that ignored `count`. With explicit-count
 * archetypes (e.g. `klein-records: count: 1`) the LLM expects exactly N rows
 * to receive that archetype's fields/vary, but round-robin spreads it across
 * `rows / len` rows (~8 of 100 for 13 templates), bleeding "Klein Records"
 * across multiple customers and then propagating back to the API via
 * `crossReferenceApiWithDb`. This function fixes the spread.
 *
 * Algorithm:
 *   1. Archetypes with `count > 0` claim their exact slots first.
 *   2. Remaining rows are distributed across weight-only archetypes by
 *      their relative weight.
 *   3. If every archetype declared `count` and the total is short of
 *      `totalRows`, the leftover rows fall back to round-robin among
 *      explicit archetypes — leaves nothing unassigned.
 */
function buildIdentityTemplateAssignments(
  templatePool: EntityArchetype[],
  totalRows: number,
): EntityArchetype[] {
  if (templatePool.length === 0 || totalRows <= 0) return [];

  const explicit = templatePool.filter(
    (a) => typeof a.count === 'number' && a.count > 0,
  );
  const weighted = templatePool.filter(
    (a) => !(typeof a.count === 'number' && a.count > 0),
  );

  const assignments: EntityArchetype[] = [];

  for (const a of explicit) {
    const c = Math.min(a.count!, Math.max(0, totalRows - assignments.length));
    for (let k = 0; k < c; k++) assignments.push(a);
    if (assignments.length >= totalRows) break;
  }

  const remaining = Math.max(0, totalRows - assignments.length);
  if (remaining > 0 && weighted.length > 0) {
    const dist = distributeByWeight(weighted, remaining);
    for (let j = 0; j < weighted.length; j++) {
      const archetype = weighted[j]!;
      const c = dist[j] ?? 0;
      for (let k = 0; k < c; k++) assignments.push(archetype);
    }
  }

  // Pad any leftover slots from round-robin among the pool. Happens only when
  // every archetype set explicit count and the totals undershoot totalRows.
  while (assignments.length < totalRows) {
    assignments.push(templatePool[assignments.length % templatePool.length]!);
  }

  return assignments;
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

// ---------------------------------------------------------------------------
// Anchors — cross-table coherence for persona-narrated events
// ---------------------------------------------------------------------------

/**
 * An anchor resolved against the actual expanded customer rows. The
 * `customerRow` is the row whose `name` (or `company`) matched the anchor's
 * customer specification — picked deterministically — and `dates` are the
 * anchor's named ISO strings normalized to epoch seconds.
 */
interface ResolvedAnchor {
  id: string;
  customerRow: Row | undefined;
  dates: Record<string, number>;
}

/**
 * Resolves anchors lazily, with surface-specific projections of the matched
 * customer. The DB projection looks at `tables[customerTableName]`; the API
 * projection looks at registered API customer entities (per adapter). Both
 * caches are populated as expansion progresses — the resolver is constructed
 * once at the top of expand() and called from both expandApiArchetypes and
 * expandArchetypes.
 *
 * Why two surfaces: DB and API customers carry different ID shapes (DB
 * autoincrement int vs Stripe-style "cus_xxx" string), so an anchor_field
 * rule with `key: "id"` must return different values depending on whether
 * the enclosing archetype targets a DB table or an API resource.
 */
class AnchorResolver {
  private readonly anchors: Map<string, Anchor>;
  private readonly tables: Record<string, Row[]>;
  private readonly customerTableName: string | undefined;
  /** Surface-keyed cache; the same anchor may be resolved differently for DB vs API. */
  private readonly cache = new Map<string, ResolvedAnchor>();
  /** Registered API customer entities, keyed by adapter id. */
  private readonly apiCustomers = new Map<string, Row[]>();

  constructor(
    anchors: Anchor[] | undefined,
    tables: Record<string, Row[]>,
    schema: SchemaModel,
    classifications: TableClassification[],
  ) {
    this.anchors = new Map((anchors ?? []).map((a) => [a.id, a]));
    this.tables = tables;
    this.customerTableName =
      classifications.find((c) => c.role === 'identity')?.table ??
      schema.tables.find((t) => t.name === 'customers')?.name ??
      schema.tables.find((t) => t.name === 'customer')?.name;
  }

  has(id: string): boolean {
    return this.anchors.has(id);
  }

  /**
   * Register API customer entities for an adapter. Called by
   * expandApiArchetypes between its non-anchor and anchor-bound passes so
   * that pass-2 anchor lookups can find the customer on the API side.
   */
  registerApiCustomers(adapterId: string, entities: Row[]): void {
    this.apiCustomers.set(adapterId, entities);
    // Invalidate cached API resolutions for this adapter so a re-resolve
    // picks up the freshly registered entities.
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(`api:${adapterId}:`)) this.cache.delete(key);
    }
  }

  resolve(
    id: string,
    options: { surface: 'db' } | { surface: 'api'; adapterId: string } = { surface: 'db' },
  ): ResolvedAnchor | undefined {
    const cacheKey =
      options.surface === 'db' ? `db:${id}` : `api:${options.adapterId}:${id}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const anchor = this.anchors.get(id);
    if (!anchor) return undefined;

    const customerRow =
      options.surface === 'db'
        ? this.findDbCustomer(anchor)
        : this.findApiCustomer(anchor, options.adapterId);

    const dates: Record<string, number> = {};
    for (const [key, value] of Object.entries(anchor.dates)) {
      const ms = Date.parse(value);
      if (!Number.isNaN(ms)) dates[key] = Math.floor(ms / 1000);
    }

    const resolved: ResolvedAnchor = { id, customerRow, dates };
    this.cache.set(cacheKey, resolved);

    if (anchor.customer && !customerRow) {
      logger.warn(
        `Anchor "${id}" (${options.surface}): no customer matching "${anchor.customer.match}" was found ` +
          (options.surface === 'db'
            ? `in ${this.customerTableName ?? '<unknown table>'}.`
            : `in API responses for adapter "${options.adapterId}".`),
      );
    }
    return resolved;
  }

  private findDbCustomer(anchor: Anchor): Row | undefined {
    if (!anchor.customer || !this.customerTableName) return undefined;
    const rows = this.tables[this.customerTableName] ?? [];
    return matchCustomer(rows, anchor.customer.match);
  }

  private findApiCustomer(anchor: Anchor, adapterId: string): Row | undefined {
    if (!anchor.customer) return undefined;
    const entities = this.apiCustomers.get(adapterId) ?? [];
    return matchCustomer(entities, anchor.customer.match);
  }
}

/** Case-insensitive name/company match against a row collection. */
function matchCustomer(rows: Row[], match: string): Row | undefined {
  const target = match.toLowerCase();
  return rows.find((r) => {
    const name = String(r.name ?? '').toLowerCase();
    const company = String(r.company ?? '').toLowerCase();
    return (
      name === target ||
      company === target ||
      (name !== '' && (name.includes(target) || target.includes(name))) ||
      (company !== '' && (company.includes(target) || target.includes(company)))
    );
  });
}

/**
 * Rewrite an anchor-bound archetype's `anchor_date` / `anchor_field` vary
 * rules into plain `pick` rules carrying the resolved value. After this
 * step the FieldGenerator can expand the archetype with no anchor awareness.
 *
 * Mutation is intentional and one-shot per archetype — same pattern as
 * `injectNowDefaultVaryRules`.
 */
function rewriteAnchorVaryRules(
  archetype: EntityArchetype,
  resolved: ResolvedAnchor,
): void {
  for (const [colName, rule] of Object.entries(archetype.vary)) {
    if (rule.type === 'anchor_date') {
      const dateKey = rule.key ?? 'event';
      const ts = resolved.dates[dateKey];
      if (ts === undefined) continue;
      const value =
        rule.format === 'epoch_seconds'
          ? ts
          : new Date(ts * 1000).toISOString();
      archetype.vary[colName] = { type: 'pick', values: [value] };
    } else if (rule.type === 'anchor_field') {
      const path = rule.key ?? 'id';
      const value = resolved.customerRow?.[path];
      if (value === undefined || value === null) continue;
      archetype.vary[colName] = { type: 'pick', values: [value] };
    }
  }
}

// ---------------------------------------------------------------------------
// Cross-surface backfill — referential integrity for DB-side FK references
// ---------------------------------------------------------------------------

/**
 * Walk every DB column declared as a cross-surface FK in the schema mapping
 * (e.g. `payments.stripe_payment_intent_id` → `stripe.payment_intent.id`).
 * For each DB value that has no matching entity in the API responses,
 * synthesize one from the DB row + linked rows.
 *
 * Why this exists: the 3-role mirror flow guarantees ID coherence only for
 * archetype-shaped rows derived from API entities. Static `data.entities[]`
 * rows (commonly used by the LLM for persona-pinned events like a specific
 * customer's double-charge) bypass that derivation entirely — they go
 * straight into the DB table with whatever IDs the LLM emits, but no
 * matching API entity is created. A reconciliation agent walking DB→API
 * would then 404. This pass closes that gap as a referential-integrity
 * invariant: every DB cross-surface FK that's declared in the schema
 * mapping must resolve to an API entity at expansion end.
 *
 * Synthesis strategy: copy primitives that share the column name (status,
 * currency, etc.); rename obvious `_cents` → bare amount and `_at` → bare
 * created/updated/etc.; resolve FK columns by looking up the linked row's
 * cross-surface id and emitting it under the API field name (which equals
 * the referenced resource type by Stripe-style convention). Anything not
 * derivable from the DB row is omitted — downstream consumers must accept
 * sparser entities than the LLM-authored ones.
 */
function backfillMissingCrossSurfaceEntities(
  tables: Record<string, Row[]>,
  apiResponses: Record<string, ApiResponseSet>,
  schema: SchemaModel,
  schemaMapping: SchemaMapping | undefined,
  personaId: string,
): void {
  if (!schemaMapping) return;

  for (const mapping of schemaMapping.mappings) {
    if (mapping.isBridgeTable) continue;
    if (mapping.apiField !== 'id') continue;

    const dbRows = tables[mapping.dbTable] ?? [];
    if (dbRows.length === 0) continue;

    const apiSet = apiResponses[mapping.adapterId];
    if (!apiSet) continue;

    const apiEntities = apiSet.responses[mapping.apiResource] ?? [];
    const existingIds = new Set<string>();
    for (const e of apiEntities) {
      const id = (e.body as Record<string, unknown>).id;
      if (typeof id === 'string') existingIds.add(id);
    }

    const synthesized: ApiResponse[] = [];
    const seenIds = new Set<string>();
    for (const dbRow of dbRows) {
      const externalId = dbRow[mapping.dbColumn];
      if (typeof externalId !== 'string' || externalId.length === 0) continue;
      if (existingIds.has(externalId) || seenIds.has(externalId)) continue;
      seenIds.add(externalId);

      const body = synthesizeApiEntityFromDbRow(
        dbRow,
        mapping,
        schema,
        tables,
        schemaMapping,
      );
      if (!body) continue;

      synthesized.push({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body,
        personaId,
        stateKey: `${mapping.adapterId}_${mapping.apiResource}`,
      });
    }

    if (synthesized.length === 0) continue;

    logger.warn(
      `Backfilled ${synthesized.length} ${mapping.adapterId}.${mapping.apiResource} ` +
        `entit${synthesized.length === 1 ? 'y' : 'ies'} for cross-surface FK references ` +
        `from "${mapping.dbTable}.${mapping.dbColumn}" that had no API counterpart. ` +
        `Likely cause: persona-pinned rows emitted as static \`entities\` instead of ` +
        `as anchor-bound archetypes — see prompt rule 2.`,
    );

    apiSet.responses[mapping.apiResource] = [...apiEntities, ...synthesized];
    apiSet.responses[mapping.apiResource].sort((a, b) => {
      const ca = (a.body as Record<string, unknown>).created as number ?? 0;
      const cb = (b.body as Record<string, unknown>).created as number ?? 0;
      return ca - cb;
    });
  }
}

function synthesizeApiEntityFromDbRow(
  dbRow: Row,
  mapping: SchemaMappingEntry,
  schema: SchemaModel,
  tables: Record<string, Row[]>,
  schemaMapping: SchemaMapping,
): Record<string, unknown> | undefined {
  const externalId = dbRow[mapping.dbColumn];
  if (typeof externalId !== 'string') return undefined;

  const body: Record<string, unknown> = {
    id: externalId,
    object: mapping.apiResource,
  };

  // Pass 1: primitives + cents/at renaming
  for (const [key, value] of Object.entries(dbRow)) {
    if (key === 'id') continue;
    if (key === mapping.dbColumn) continue;
    if (key.endsWith('_id')) continue; // FKs handled in pass 2
    if (value === undefined || value === null) continue;

    if (key.endsWith('_at')) {
      const ts = parseTimestampToSec(value);
      if (ts === null) continue;
      const apiField = key === 'created_at' ? 'created' : key.slice(0, -3);
      body[apiField] = ts;
      continue;
    }

    if (key.endsWith('_cents')) {
      body[key.slice(0, -'_cents'.length)] = value;
      continue;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      body[key] = value;
    }
  }

  // Pass 2: resolve FK columns to cross-surface IDs on the linked rows
  const tableInfo = schema.tables.find((t) => t.name === mapping.dbTable);
  if (tableInfo) {
    for (const fk of tableInfo.foreignKeys) {
      for (let i = 0; i < fk.columns.length; i++) {
        const fkCol = fk.columns[i]!;
        const fkVal = dbRow[fkCol];
        if (fkVal === undefined || fkVal === null) continue;

        const refTable = fk.referencedTable;
        const refCol = fk.referencedColumns[i]!;
        const refRow = (tables[refTable] ?? []).find((r) => r[refCol] === fkVal);
        if (!refRow) continue;

        const refMapping = schemaMapping.mappings.find(
          (m) =>
            m.dbTable === refTable &&
            m.adapterId === mapping.adapterId &&
            m.apiField === 'id' &&
            !m.isBridgeTable,
        );
        if (!refMapping) continue;

        const refExternalId = refRow[refMapping.dbColumn];
        if (typeof refExternalId !== 'string') continue;

        // API field name follows Stripe-style convention: the referenced
        // resource type singular (`customer`, `subscription`, `invoice`).
        // refMapping.apiResource is already singular for adapters that
        // follow this convention; if not, downstream consumers may need
        // additional adapter-specific normalization.
        body[refMapping.apiResource] = refExternalId;
      }
    }
  }

  return body;
}

/**
 * Auto-inject `{ type: "timestamp" }` vary rules for `@default(now())`
 * timestamp columns that DB archetypes haven't covered explicitly.
 *
 * Why this layer exists: the LLM is told (correctly) that the persona's
 * REQUIRED columns are the ones with `!hasDefault`. So `created_at @default(now())`
 * is rendered as just `DEFAULT now()` and the LLM omits it from `fields`/`vary`,
 * assuming the DB will fill it. In practice the seeder drops the whole column
 * (because it can't mix per-row DEFAULT with explicit values in one batched
 * INSERT) and Postgres applies `now()` to every row, collapsing the historical
 * spread the persona narrative asked for.
 *
 * By injecting a deterministic vary rule whose min/max match the configured
 * generation range, we get O(rules) LLM cost for O(rows) timestamps. The LLM
 * remains free to override per-archetype — any existing entry in `vary` or
 * `fields` for the column is left untouched, so persona-pinned dates and
 * anchor-bound rules continue to win.
 */
function injectNowDefaultVaryRules(
  blueprint: Blueprint,
  schema: SchemaModel,
  range: TimeRange,
): void {
  const archetypes = blueprint.data.entityArchetypes;
  if (!archetypes) return;

  const startSec = Math.floor(range.start.getTime() / 1000);
  const endSec = Math.floor(range.end.getTime() / 1000);
  if (endSec <= startSec) return;

  for (const [tableName, config] of Object.entries(archetypes)) {
    const tableInfo = schema.tables.find((t) => t.name === tableName);
    if (!tableInfo) continue;

    const targets = tableInfo.columns.filter(
      (c) =>
        c.defaultValue === 'now()' &&
        (c.type === 'timestamp' || c.type === 'timestamptz'),
    );
    if (targets.length === 0) continue;

    for (const archetype of config.archetypes) {
      for (const col of targets) {
        if (archetype.vary[col.name]) continue;
        if (col.name in archetype.fields) continue;
        archetype.vary[col.name] = {
          type: 'timestamp',
          min: startSec,
          max: endSec,
        };
      }
    }
  }
}

/**
 * Fill missing `@default(now())` timestamp columns with values inside the
 * configured generation date range.
 *
 * Why this exists: when a Prisma model declares e.g.
 * `created_at DateTime @default(now())`, the LLM is implicitly encouraged to
 * leave the column out (the DB will fill it). The Postgres seeder then sees
 * a column with a DB default that is missing on at least one row and drops
 * the whole column from the INSERT so Postgres applies the default
 * consistently — which means every row's `created_at` collapses to seed
 * insertion time. The 12 weeks of "history" the persona asked for becomes
 * a single timestamp on `now()`. By populating these columns up front with
 * realistic timestamps inside the configured range, the seeder keeps the
 * column and our values reach the database intact.
 *
 * Anchoring: when the row already carries other timestamp values (e.g.
 * `paid_at`, `current_period_start`, `due_date`), the chosen `created_at`
 * is constrained to be ≤ the earliest of them so that
 * "creation precedes everything else" remains true on the row.
 */
function fillNowDefaultTimestamps(
  rows: Row[],
  tableInfo: TableInfo,
  range: TimeRange,
  rng: SeededRandom,
): void {
  const startSec = Math.floor(range.start.getTime() / 1000);
  const endSec = Math.floor(range.end.getTime() / 1000);
  if (endSec <= startSec) return;

  const nowDefaultCols = tableInfo.columns.filter(
    (c) =>
      c.defaultValue === 'now()' &&
      (c.type === 'timestamp' || c.type === 'timestamptz' || c.type === 'date'),
  );
  if (nowDefaultCols.length === 0) return;

  const nowDefaultNames = new Set(nowDefaultCols.map((c) => c.name));
  const siblingTsCols = tableInfo.columns.filter(
    (c) =>
      !nowDefaultNames.has(c.name) &&
      (c.type === 'timestamp' || c.type === 'timestamptz' || c.type === 'date'),
  );

  for (const col of nowDefaultCols) {
    const hasMissing = rows.some(
      (row) => row[col.name] === undefined || row[col.name] === null,
    );
    if (!hasMissing) continue;

    logger.debug(
      `Filling @default(now()) "${tableInfo.name}.${col.name}" with timestamps in [${range.start.toISOString()}, ${range.end.toISOString()}]`,
    );

    for (const row of rows) {
      if (row[col.name] !== undefined && row[col.name] !== null) continue;

      let upperSec = endSec;
      for (const sib of siblingTsCols) {
        const v = parseTimestampToSec(row[sib.name]);
        if (v !== null && v < upperSec) upperSec = v;
      }
      const upper = Math.max(upperSec, startSec);
      const tsSec =
        upper > startSec
          ? startSec + Math.floor(rng.next() * (upper - startSec))
          : startSec;

      const iso = new Date(tsSec * 1000).toISOString();
      row[col.name] = col.type === 'date' ? iso.split('T')[0]! : iso;
    }
  }
}

function parseTimestampToSec(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') {
    return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
  }
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    if (Number.isNaN(ms)) return null;
    return Math.floor(ms / 1000);
  }
  if (v instanceof Date) {
    return Math.floor(v.getTime() / 1000);
  }
  return null;
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
      // SQL semantics: NULL doesn't equal NULL, so a row with any NULL in the
      // unique key doesn't conflict with anything (Postgres, MySQL, SQLite all
      // behave this way). Without this, e.g. 100 rows with NULL `stripe_pi_id`
      // would collapse to 1 here even though Postgres would happily accept all.
      const hasNull = cols.some(c => row[c] === undefined || row[c] === null);
      if (hasNull) continue;
      const key = cols.map((c) => String(row[c])).join('\x00');
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

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isValidUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID_REGEX.test(s);
}

/**
 * For every `uuid` PK column, replace any non-UUID values with crypto-generated
 * UUIDs and propagate the swap to every FK column pointing at it. Also catches
 * non-PK uuid columns (defensive).
 *
 * The LLM sometimes emits UUID-shaped strings with non-hex characters
 * (e.g. "u1b2c3d4-...") for memorability. Postgres rejects those — this fixes
 * them before insert without losing FK consistency.
 */
function coerceUuidColumns(
  tables: Record<string, Row[]>,
  schema: SchemaModel,
): void {
  // tableName.colName → (oldValue → newUuid)
  const remap = new Map<string, Map<string, string>>();

  // Phase 1: replace invalid UUIDs in PK columns only and remember the swap.
  // Touching FK columns here would break the PK→FK chain in phase 2 (a fresh
  // random UUID on the FK side wouldn't match the PK's remapped value).
  for (const tableInfo of schema.tables) {
    const rows = tables[tableInfo.name];
    if (!rows || rows.length === 0) continue;
    const pkSet = new Set(tableInfo.primaryKey);

    for (const col of tableInfo.columns) {
      if (col.pgType !== 'uuid') continue;
      if (!pkSet.has(col.name)) continue;
      const colMap = new Map<string, string>();

      for (const row of rows) {
        const v = row[col.name];
        if (v === null || v === undefined) continue;
        if (isValidUuid(v)) continue;
        const key = String(v);
        let next = colMap.get(key);
        if (!next) {
          next = crypto.randomUUID();
          colMap.set(key, next);
        }
        row[col.name] = next;
      }

      if (colMap.size > 0) {
        remap.set(`${tableInfo.name}.${col.name}`, colMap);
      }
    }
  }

  if (remap.size === 0) return;

  // Phase 2: rewrite FK columns that point at remapped PKs.
  for (const tableInfo of schema.tables) {
    const rows = tables[tableInfo.name];
    if (!rows || rows.length === 0) continue;

    for (const fk of tableInfo.foreignKeys) {
      for (let i = 0; i < fk.columns.length; i++) {
        const fkCol = fk.columns[i];
        const refCol = fk.referencedColumns[i];
        if (!fkCol || !refCol) continue;
        const colMap = remap.get(`${fk.referencedTable}.${refCol}`);
        if (!colMap) continue;

        for (const row of rows) {
          const v = row[fkCol];
          if (typeof v !== 'string') continue;
          const next = colMap.get(v);
          if (next) row[fkCol] = next;
        }
      }
    }
  }

  // Phase 3: any remaining non-UUID values in non-PK uuid columns must be
  // bogus FK references that didn't match a remapped PK. Replace them with
  // crypto UUIDs — they'll fail FK constraints downstream, but at least
  // they pass the column-type check so postgres surfaces the FK violation
  // rather than the cryptic "invalid input syntax for type uuid" error.
  for (const tableInfo of schema.tables) {
    const rows = tables[tableInfo.name];
    if (!rows || rows.length === 0) continue;
    const pkSet = new Set(tableInfo.primaryKey);

    for (const col of tableInfo.columns) {
      if (col.pgType !== 'uuid') continue;
      if (pkSet.has(col.name)) continue;

      for (const row of rows) {
        const v = row[col.name];
        if (v === null || v === undefined) continue;
        if (isValidUuid(v)) continue;
        row[col.name] = crypto.randomUUID();
      }
    }
  }
}
