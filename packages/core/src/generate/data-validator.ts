import type { ExpandedData } from '../types/dataset.js';
import type { DataSpec, PromptContext } from '../types/adapter.js';
import type { SchemaModel } from '../types/schema.js';
import { logger } from '../utils/logger.js';

// ─── Repair stats ────────────────────────────────────────────────────────

export interface RepairStats {
  variationsResolved: number;
  templatesResolved: number;
  requiredFieldsFilled: number;
  objectFieldsSet: number;
  amountsCoerced: number;
  timestampsCoerced: number;
  fksRepaired: number;
  idsRepaired: number;
}

// ─── FieldVariation detection ────────────────────────────────────────────

const VARIATION_TYPES = new Set([
  'sequence',
  'pick',
  'range',
  'derived',
  'faker',
  'constant',
]);

function isRawVariation(v: unknown): boolean {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const obj = v as Record<string, unknown>;
  if (typeof obj.type === 'string' && VARIATION_TYPES.has(obj.type)) return true;
  for (const key of VARIATION_TYPES) {
    if (key in obj && typeof obj[key] === 'object' && obj[key] !== null)
      return true;
  }
  return false;
}

function resolveVariation(
  v: Record<string, unknown>,
  counter: number,
): string {
  if (v.type === 'sequence') {
    const prefix = (v.prefix as string) ?? '';
    return `${prefix}${String(counter).padStart(3, '0')}`;
  }
  if (v.type === 'pick' && Array.isArray(v.values) && v.values.length > 0) {
    return String(v.values[counter % v.values.length]);
  }
  if (v.type === 'range') {
    const min = Number(v.min ?? 100);
    const max = Number(v.max ?? 10000);
    return String(min + ((counter * 137) % (max - min)));
  }
  if (v.type === 'constant' && v.value != null) {
    return String(v.value);
  }
  // Nested LLM form: { sequence: { prefix: "cus_" } }
  for (const key of VARIATION_TYPES) {
    if (key in v && typeof v[key] === 'object' && v[key] !== null) {
      return resolveVariation(
        { type: key, ...(v[key] as Record<string, unknown>) },
        counter,
      );
    }
  }
  return `gen_${counter}`;
}

// ─── Amount format parsing ───────────────────────────────────────────────

type AmountType = 'integer' | 'decimal_string' | 'currency_object';

function parseAmountFormat(format: string): AmountType {
  const lower = format.toLowerCase();
  if (lower.includes('currency') && lower.includes('object'))
    return 'currency_object';
  if (lower.includes('decimal') || lower.includes('string'))
    return 'decimal_string';
  return 'integer';
}

// ─── Timestamp format inference ──────────────────────────────────────────

function inferTimestampFormat(
  notes?: string,
): 'unix_seconds' | 'unix_ms' | 'iso8601' {
  if (!notes) return 'unix_seconds';
  const lower = notes.toLowerCase();
  if (lower.includes('iso 8601') || lower.includes('iso8601')) return 'iso8601';
  if (lower.includes('unix milliseconds') || lower.includes('unix ms'))
    return 'unix_ms';
  return 'unix_seconds';
}

// ─── Relationship parsing ────────────────────────────────────────────────

interface Relationship {
  child: string;
  parents: string[];
}

function parseRelationships(rels: string[]): Relationship[] {
  return rels.map((r) => {
    const parts = r.split('→').map((s) => s.trim());
    const child = parts[0] ?? '';
    const parents = (parts[1] ?? '').split(',').map((s) => s.trim());
    return { child, parents };
  });
}

// ─── Well-known field sets ───────────────────────────────────────────────

const DEFAULT_AMOUNT_FIELDS = new Set([
  'amount',
  'amount_due',
  'amount_paid',
  'amount_remaining',
  'amount_captured',
  'amount_refunded',
  'unit_amount',
  'total',
  'subtotal',
  'tax',
  'balance',
  'price',
  'plan_amount',
  'net_amount',
  'fee',
  'transfer_amount',
  'amount_off',
  'percent_off',
]);

const DEFAULT_TIMESTAMP_FIELDS = new Set([
  'created',
  'created_at',
  'updated_at',
  'date',
  'start_time',
  'end_time',
  'current_period_start',
  'current_period_end',
  'cancel_at',
  'canceled_at',
  'trial_start',
  'trial_end',
  'period_start',
  'period_end',
  'create_time',
  'update_time',
  'expiration_time',
]);

// ─── Helpers ─────────────────────────────────────────────────────────────

function singularize(resource: string): string {
  if (resource.endsWith('ies')) return resource.slice(0, -3) + 'y';
  if (resource.endsWith('ses') && !resource.endsWith('sses'))
    return resource.slice(0, -2);
  if (resource.endsWith('s') && !resource.endsWith('ss'))
    return resource.slice(0, -1);
  return resource;
}

function pluralize(name: string): string {
  if (name.endsWith('s')) return name;
  if (name.endsWith('y') && !name.endsWith('ey'))
    return name.slice(0, -1) + 'ies';
  return name + 's';
}

// ─── DataValidator ───────────────────────────────────────────────────────

export class DataValidator {
  private stats!: RepairStats;
  private variationCounter = 0;

  constructor(
    private promptContexts: Record<string, PromptContext>,
    private dataSpecs?: Record<string, DataSpec>,
  ) {}

  /**
   * Validate and repair expanded data in-place.
   * Returns statistics about what was fixed.
   */
  validateAndRepair(
    data: ExpandedData,
    schema?: SchemaModel,
  ): RepairStats {
    this.stats = {
      variationsResolved: 0,
      templatesResolved: 0,
      requiredFieldsFilled: 0,
      objectFieldsSet: 0,
      amountsCoerced: 0,
      timestampsCoerced: 0,
      fksRepaired: 0,
      idsRepaired: 0,
    };
    this.variationCounter = 0;

    this.repairTables(data, schema);
    this.repairApiResponses(data);

    const total = Object.values(this.stats).reduce((s, n) => s + n, 0);
    if (total > 0) {
      const parts: string[] = [];
      for (const [key, val] of Object.entries(this.stats)) {
        if (val > 0) parts.push(`${key}=${val}`);
      }
      logger.info(`DataValidator: ${total} repairs (${parts.join(', ')})`);
    } else {
      logger.debug('DataValidator: data clean — no repairs needed');
    }

    return this.stats;
  }

  // ── DB tables ──────────────────────────────────────────────────────────

  private repairTables(data: ExpandedData, schema?: SchemaModel): void {
    for (const [tableName, rows] of Object.entries(data.tables)) {
      for (const row of rows) {
        this.repairRecord(row);
        if (schema) {
          this.coerceDbTypes(row, tableName, schema);
        }
      }
    }
  }

  // ── API responses ──────────────────────────────────────────────────────

  private repairApiResponses(data: ExpandedData): void {
    for (const [adapterId, responseSet] of Object.entries(data.apiResponses)) {
      const ctx = this.promptContexts[adapterId];
      if (!ctx) continue;

      const spec = this.dataSpecs?.[adapterId];
      const amountType = parseAmountFormat(ctx.amountFormat);
      const tsFormat =
        spec?.timestampFormat ?? inferTimestampFormat(ctx.notes);
      const relationships = parseRelationships(ctx.relationships);

      const amountFieldNames = new Set([
        ...DEFAULT_AMOUNT_FIELDS,
        ...(spec?.amountFields ?? []),
      ]);
      const tsFieldNames = new Set([
        ...DEFAULT_TIMESTAMP_FIELDS,
        ...(spec?.timestampFields ?? []),
      ]);

      // Build ID index per resource for FK resolution
      const idIndex: Record<string, Set<string>> = {};
      for (const [resource, responses] of Object.entries(
        responseSet.responses,
      )) {
        const ids = new Set<string>();
        for (const resp of responses) {
          const body = resp.body as Record<string, unknown>;
          if (typeof body.id === 'string') ids.add(body.id);
        }
        idIndex[resource] = ids;
      }

      for (const [resource, responses] of Object.entries(
        responseSet.responses,
      )) {
        for (let i = 0; i < responses.length; i++) {
          const body = responses[i].body as Record<string, unknown>;

          this.repairRecord(body);
          this.ensureObjectField(body, resource);

          if (ctx.requiredFields[resource]) {
            this.ensureRequiredFields(body, resource, ctx, adapterId);
          }

          this.coerceAmounts(body, amountType, amountFieldNames);
          this.coerceTimestamps(body, tsFormat, tsFieldNames);
          this.repairForeignKeys(body, resource, relationships, idIndex, i);
          this.ensureStringId(body);

          if (spec?.statusEnums?.[resource]) {
            this.validateStatus(body, spec.statusEnums[resource]);
          }
        }
      }
    }
  }

  // ── Generic record repairs ─────────────────────────────────────────────

  private repairRecord(record: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(record)) {
      if (isRawVariation(value)) {
        this.variationCounter++;
        record[key] = resolveVariation(
          value as Record<string, unknown>,
          this.variationCounter,
        );
        this.stats.variationsResolved++;
        continue;
      }

      if (typeof value === 'string' && /\{\{[^}]+\}\}/.test(value)) {
        record[key] = this.resolveTemplate(key, value);
        this.stats.templatesResolved++;
        continue;
      }

      // Recurse into nested objects (skip arrays — they may contain valid data)
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        this.repairRecord(value as Record<string, unknown>);
      }
    }
  }

  private resolveTemplate(fieldName: string, _template: string): unknown {
    const lower = fieldName.toLowerCase();
    const now = Math.floor(Date.now() / 1000);

    if (
      DEFAULT_TIMESTAMP_FIELDS.has(lower) ||
      lower.includes('time') ||
      lower.includes('date')
    ) {
      return now - Math.floor(Math.random() * 86400 * 180);
    }
    if (
      DEFAULT_AMOUNT_FIELDS.has(lower) ||
      lower.includes('amount') ||
      lower.includes('price')
    ) {
      return 1000 + Math.floor(Math.random() * 9000);
    }
    if (lower.includes('period')) {
      const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
      return `2025-${month}-01`;
    }
    if (lower.includes('status')) {
      return 'active';
    }
    return null;
  }

  // ── API-specific repairs ───────────────────────────────────────────────

  private ensureObjectField(
    body: Record<string, unknown>,
    resource: string,
  ): void {
    const expected = singularize(resource);
    if (body.object !== expected) {
      body.object = expected;
      this.stats.objectFieldsSet++;
    }
  }

  private ensureRequiredFields(
    body: Record<string, unknown>,
    resource: string,
    ctx: PromptContext,
    adapterId: string,
  ): void {
    const required = ctx.requiredFields[resource];
    if (!required) return;

    for (const field of required) {
      if (
        body[field] === undefined ||
        body[field] === null ||
        body[field] === ''
      ) {
        body[field] = this.synthesizeDefault(field, resource, ctx, adapterId);
        this.stats.requiredFieldsFilled++;
      }
    }
  }

  private synthesizeDefault(
    field: string,
    resource: string,
    ctx: PromptContext,
    adapterId: string,
  ): unknown {
    const lower = field.toLowerCase();
    const spec = this.dataSpecs?.[adapterId];

    if (lower === 'object') return singularize(resource);
    if (lower === 'id') {
      const prefix = spec?.idPrefixes?.[resource] ?? ctx.idPrefix ?? '';
      return `${prefix}${Date.now().toString(36)}`;
    }
    if (
      DEFAULT_TIMESTAMP_FIELDS.has(lower) ||
      lower.includes('created') ||
      lower.includes('time')
    ) {
      const tsFormat =
        spec?.timestampFormat ?? inferTimestampFormat(ctx.notes);
      if (tsFormat === 'iso8601') return new Date().toISOString();
      return Math.floor(Date.now() / 1000);
    }
    if (lower === 'currency' || lower === 'currency_code') return 'usd';
    if (lower === 'status') return 'active';
    if (lower === 'email') return `user@example.com`;
    if (lower === 'name' || lower === 'first_name') return 'Test User';
    if (lower === 'last_name') return 'User';
    if (DEFAULT_AMOUNT_FIELDS.has(lower)) return 0;
    if (lower === 'active') return true;
    if (lower === 'type') return 'service';
    if (lower === 'paid') return false;
    return null;
  }

  private coerceAmounts(
    body: Record<string, unknown>,
    amountType: AmountType,
    amountFields: Set<string>,
  ): void {
    for (const [key, value] of Object.entries(body)) {
      if (!amountFields.has(key)) continue;
      if (value === null || value === undefined) continue;

      switch (amountType) {
        case 'integer': {
          if (typeof value !== 'number' || !Number.isInteger(value)) {
            const parsed = Number(value);
            if (!isNaN(parsed)) {
              body[key] = Math.round(parsed);
              this.stats.amountsCoerced++;
            }
          }
          break;
        }
        case 'decimal_string': {
          if (typeof value !== 'string') {
            const num = Number(value);
            if (!isNaN(num)) {
              body[key] = num.toFixed(2);
              this.stats.amountsCoerced++;
            }
          }
          break;
        }
        case 'currency_object': {
          if (typeof value !== 'object' || value === null) {
            const numVal = Number(value);
            body[key] = {
              value: isNaN(numVal) ? '0.00' : numVal.toFixed(2),
              currency_code:
                (body.currency_code as string) ??
                (body.currency as string) ??
                'USD',
            };
            this.stats.amountsCoerced++;
          }
          break;
        }
      }
    }
  }

  private coerceTimestamps(
    body: Record<string, unknown>,
    tsFormat: 'unix_seconds' | 'unix_ms' | 'iso8601',
    tsFields: Set<string>,
  ): void {
    for (const [key, value] of Object.entries(body)) {
      if (!tsFields.has(key)) continue;
      if (value === null || value === undefined) continue;

      switch (tsFormat) {
        case 'unix_seconds': {
          if (typeof value === 'string') {
            const date = new Date(value);
            if (!isNaN(date.getTime())) {
              body[key] = Math.floor(date.getTime() / 1000);
              this.stats.timestampsCoerced++;
            }
          } else if (typeof value === 'number' && value > 1e12) {
            body[key] = Math.floor(value / 1000);
            this.stats.timestampsCoerced++;
          }
          break;
        }
        case 'unix_ms': {
          if (typeof value === 'string') {
            const date = new Date(value);
            if (!isNaN(date.getTime())) {
              body[key] = date.getTime();
              this.stats.timestampsCoerced++;
            }
          } else if (typeof value === 'number' && value < 1e12) {
            body[key] = value * 1000;
            this.stats.timestampsCoerced++;
          }
          break;
        }
        case 'iso8601': {
          if (typeof value === 'number') {
            const ts = value > 1e12 ? value : value * 1000;
            body[key] = new Date(ts).toISOString();
            this.stats.timestampsCoerced++;
          }
          break;
        }
      }
    }
  }

  private repairForeignKeys(
    body: Record<string, unknown>,
    resource: string,
    relationships: Relationship[],
    idIndex: Record<string, Set<string>>,
    entityIndex: number,
  ): void {
    const singular = singularize(resource);
    const rel = relationships.find(
      (r) => r.child === singular || r.child === resource,
    );
    if (!rel) return;

    for (const parent of rel.parents) {
      const parentPlural = pluralize(parent);
      const parentIds = idIndex[parentPlural] ?? idIndex[parent];
      if (!parentIds || parentIds.size === 0) continue;

      const idArray = [...parentIds];

      // Check common FK field patterns: parent, parent_id
      const fkCandidates = [parent, `${parent}_id`];
      for (const fk of fkCandidates) {
        const value = body[fk];
        if (value === undefined) continue;

        const needsRepair =
          typeof value !== 'string' ||
          value.startsWith('gen_') ||
          value === '' ||
          !parentIds.has(value);

        if (needsRepair) {
          // Distribute across parents deterministically
          body[fk] = idArray[entityIndex % idArray.length];
          this.stats.fksRepaired++;
        }
      }
    }
  }

  private ensureStringId(body: Record<string, unknown>): void {
    if (body.id === undefined) return;

    if (isRawVariation(body.id)) {
      this.variationCounter++;
      body.id = resolveVariation(
        body.id as Record<string, unknown>,
        this.variationCounter,
      );
      this.stats.idsRepaired++;
    } else if (typeof body.id === 'number') {
      body.id = String(body.id);
      this.stats.idsRepaired++;
    } else if (typeof body.id !== 'string') {
      body.id = `id_${Date.now().toString(36)}_${this.variationCounter++}`;
      this.stats.idsRepaired++;
    }
  }

  private validateStatus(
    body: Record<string, unknown>,
    validStatuses: string[],
  ): void {
    if (
      typeof body.status !== 'string' ||
      body.status === '' ||
      (validStatuses.length > 0 && !validStatuses.includes(body.status))
    ) {
      body.status = validStatuses[0] ?? 'active';
      this.stats.requiredFieldsFilled++;
    }
  }

  // ── DB type coercion ───────────────────────────────────────────────────

  private coerceDbTypes(
    row: Record<string, unknown>,
    tableName: string,
    schema: SchemaModel,
  ): void {
    const table = schema.tables.find((t) => t.name === tableName);
    if (!table) return;

    for (const col of table.columns) {
      const value = row[col.name];
      if (value === null || value === undefined) continue;

      switch (col.type) {
        case 'integer':
        case 'bigint':
        case 'smallint': {
          if (typeof value !== 'number') {
            const parsed = Number(value);
            if (!isNaN(parsed)) {
              row[col.name] = Math.round(parsed);
              this.stats.amountsCoerced++;
            }
          }
          break;
        }
        case 'decimal':
        case 'float':
        case 'double': {
          if (typeof value !== 'number') {
            const parsed = parseFloat(String(value));
            if (!isNaN(parsed)) {
              row[col.name] = parsed;
              this.stats.amountsCoerced++;
            }
          }
          break;
        }
        case 'boolean': {
          if (typeof value !== 'boolean') {
            row[col.name] = value === 'true' || value === 't' || value === 1;
          }
          break;
        }
        case 'text':
        case 'varchar':
        case 'char': {
          if (typeof value === 'object' && value !== null) {
            row[col.name] = JSON.stringify(value);
            this.stats.variationsResolved++;
          }
          break;
        }
      }
    }
  }
}
