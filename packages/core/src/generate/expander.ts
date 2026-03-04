import type {
  Blueprint,
  DataPattern,
  RandomSpec,
  FrequencySpec,
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
} from '../types/index.js';
import { SeededRandom } from './seed-random.js';
import { FieldGenerator } from './field-generators.js';
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
   */
  expand(
    blueprint: Blueprint,
    schema: SchemaModel,
    volume: string,
  ): ExpandedData {
    const range = parseVolume(volume);
    const tables: Record<string, Row[]> = {};
    const idTracker = createIdTracker();
    const tableIndex = indexTables(schema);

    logger.debug(
      `Expanding blueprint "${blueprint.personaId}" over ${volume} ` +
        `(${range.start.toISOString()} → ${range.end.toISOString()})`,
    );

    // ------------------------------------------------------------------
    // 1. Static entities — insert in topological (insertion) order
    // ------------------------------------------------------------------
    for (const tableName of schema.insertionOrder) {
      const entityRows = blueprint.data.entities[tableName];
      if (!entityRows || entityRows.length === 0) continue;

      const tableInfo = tableIndex.get(tableName);
      const rows: Row[] = [];

      for (const raw of entityRows) {
        const row = { ...raw } as Row;
        assignAutoIncrementIds(row, tableInfo, idTracker, tableName);
        resolveReferences(row, idTracker);
        rows.push(row);
        trackRow(row, tableInfo, idTracker, tableName);
      }

      tables[tableName] = rows;
    }

    // ------------------------------------------------------------------
    // 1b. Archetype expansion — scale entities from compact templates
    // ------------------------------------------------------------------
    if (blueprint.data.entityArchetypes) {
      for (const tableName of schema.insertionOrder) {
        const config = blueprint.data.entityArchetypes[tableName];
        if (!config) continue;

        const tableInfo = tableIndex.get(tableName);
        const existingRows = tables[tableName] ?? [];
        const archetypeRows = this.expandArchetypes(
          config,
          tableName,
          tableInfo,
          idTracker,
        );
        tables[tableName] = [...existingRows, ...archetypeRows];
      }

      // Also expand archetype tables not in insertionOrder
      for (const [tableName, config] of Object.entries(blueprint.data.entityArchetypes)) {
        if (schema.insertionOrder.includes(tableName)) continue;
        const tableInfo = tableIndex.get(tableName);
        const existingRows = tables[tableName] ?? [];
        const archetypeRows = this.expandArchetypes(
          config,
          tableName,
          tableInfo,
          idTracker,
        );
        tables[tableName] = [...existingRows, ...archetypeRows];
      }
    }

    // ------------------------------------------------------------------
    // 2. Patterns — expand into transactional rows
    // ------------------------------------------------------------------
    for (const pattern of blueprint.data.patterns) {
      const existing = tables[pattern.targetTable] ?? [];
      const tableInfo = tableIndex.get(pattern.targetTable);

      const generated = this.expandPattern(
        pattern,
        range,
        tableInfo,
        idTracker,
      );

      tables[pattern.targetTable] = [...existing, ...generated];
    }

    // ------------------------------------------------------------------
    // 3. Post-processing: assign IDs & sort chronologically
    // ------------------------------------------------------------------
    for (const [tableName, rows] of Object.entries(tables)) {
      const tableInfo = tableIndex.get(tableName);
      sortChronologically(rows, tableInfo);
      reassignSequentialIds(rows, tableInfo, idTracker, tableName);
    }

    // ------------------------------------------------------------------
    // 4. Fill missing required columns with generated values
    // ------------------------------------------------------------------
    for (const [tableName, rows] of Object.entries(tables)) {
      const tableInfo = tableIndex.get(tableName);
      if (tableInfo && rows.length > 0) {
        fillMissingRequiredColumns(rows, tableInfo, this.rng);
      }
    }

    // ------------------------------------------------------------------
    // 5. API entities → apiResponses
    // ------------------------------------------------------------------
    const apiResponses: Record<string, ApiResponseSet> = {};

    // 5a. Expand apiEntityArchetypes (scalable)
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

    // 5b. Pass through static apiEntities (small reference data)
    if (blueprint.data.apiEntities) {
      for (const [adapterId, resources] of Object.entries(
        blueprint.data.apiEntities,
      )) {
        const staticSet = this.expandApiEntities(
          adapterId,
          resources,
          blueprint.personaId,
        );

        // Merge with any archetype-expanded responses for this adapter
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

    return {
      personaId: blueprint.personaId,
      blueprint,
      tables,
      documents: {},
      apiResponses,
      files: [],
      events: [],
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

    for (const date of dates) {
      const row: Row = {
        ...config.fields,
        ...inferDateField(tableInfo, date),
      };
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

    for (const date of dates) {
      const row: Row = {
        ...config.fields,
        ...inferDateField(tableInfo, date),
      };
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

      let globalIdx = 0;
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
          globalIdx++;
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
}

function trackRow(
  row: Row,
  tableInfo: TableInfo | undefined,
  idTracker: IdTracker,
  tableName: string,
): void {
  if (!tableInfo) return;

  // Track the primary key value so FK references can resolve
  for (const pkCol of tableInfo.primaryKey) {
    const val = row[pkCol];
    if (val !== undefined) {
      const lookupKey = `${tableName}.${pkCol}`;
      if (!idTracker.lookup.has(lookupKey)) {
        idTracker.lookup.set(lookupKey, new Map());
      }
      const map = idTracker.lookup.get(lookupKey)!;
      // Store by original value (from the blueprint) → assigned ID
      map.set(val as string | number, val as number);
    }
  }
}

/**
 * Resolve `{{table_name.column_name}}` placeholder references in row values.
 *
 * When `rng` is provided, references are resolved to a random matching ID
 * (used during archetype expansion to distribute child rows across parents).
 * Without `rng`, the first matching ID is used (original deterministic behaviour).
 */
const REF_PATTERN = /^\{\{(\w+)\.(\w+)\}\}$/;

function resolveReferences(row: Row, idTracker: IdTracker, rng?: SeededRandom): void {
  for (const [key, value] of Object.entries(row)) {
    if (typeof value !== 'string') continue;

    const match = value.match(REF_PATTERN);
    if (!match) continue;

    const refTable = match[1]!;
    const refColumn = match[2]!;
    const lookupKey = `${refTable}.${refColumn}`;
    const lookupMap = idTracker.lookup.get(lookupKey);

    if (lookupMap && lookupMap.size > 0) {
      const values = [...lookupMap.values()];
      row[key] = rng ? rng.pick(values) : values[0];
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
function fillMissingRequiredColumns(
  rows: Row[],
  tableInfo: TableInfo,
  rng: SeededRandom,
): void {
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
