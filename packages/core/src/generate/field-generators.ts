import { faker } from '@faker-js/faker';
import type { FieldVariation, Row } from '../types/index.js';
import type { SeededRandom } from './seed-random.js';

const KNOWN_VARIATION_TYPES = new Set([
  'pick', 'range', 'decimal_range', 'sequence', 'uuid', 'derived',
  'timestamp', 'date', 'firstName', 'lastName', 'fullName', 'email', 'phone', 'companyName',
]);

// ---------------------------------------------------------------------------
// FieldGenerator
// ---------------------------------------------------------------------------

/**
 * Generates realistic field values using faker with deterministic seeding.
 *
 * The generator wraps faker and the project's SeededRandom to produce
 * consistent, reproducible values for archetype expansion. The `derived`
 * variation type preserves LLM intent by using templates with {{fieldName}}
 * placeholders — the LLM controls the pattern (e.g. email domain), while
 * faker fills in the variable parts.
 */
export class FieldGenerator {
  private readonly rng: SeededRandom;
  private sequenceCounters: Map<string, number> = new Map();
  /**
   * Per-(table.column) registry of values already emitted for `@unique` columns.
   * Populated only when `applyVariations` is called with a non-empty
   * `uniqueColumns` set. Acts as the first line of defence against duplicate
   * emails / handles / etc. produced by faker draws or `derived` templates.
   * If a generated value collides, `uniquifyValue` mutates it to a unique
   * variant before the row is returned — so the row never enters the
   * downstream pipeline with a unique-constraint violation.
   *
   * Keyed by `${tableName}.${columnName}`. Values stored as strings via
   * `String(...)` so numeric/boolean/UUID values compare correctly.
   */
  private uniquenessIndex: Map<string, Set<string>> = new Map();

  constructor(rng: SeededRandom, seed: number) {
    this.rng = rng;
    faker.seed(seed);
  }

  // -----------------------------------------------------------------------
  // Uniqueness helpers — used by applyVariations when the caller supplies
  // the table's single-column `@unique` constraint set.
  // -----------------------------------------------------------------------

  private uniquenessKey(table: string, column: string): string {
    return `${table}.${column}`;
  }

  private recordUniqueValue(table: string, column: string, value: unknown): void {
    const key = this.uniquenessKey(table, column);
    let seen = this.uniquenessIndex.get(key);
    if (!seen) {
      seen = new Set();
      this.uniquenessIndex.set(key, seen);
    }
    seen.add(String(value));
  }

  /**
   * Ensure `value` is unique for the given `(table, column)`. If it's already
   * unique, returns it unchanged. Otherwise returns a deterministic mutated
   * variant that doesn't collide with anything previously emitted. The
   * caller is expected to record the returned value back into the index.
   *
   * Email values get `+N` inserted before the `@` (RFC-5233 sub-addressing —
   * still routes to the same inbox in real mail systems, which keeps the data
   * shape believable). Other strings get a `-N` suffix. Numbers increment.
   * As a last-resort fallback (e.g. opaque object values), a short crypto
   * suffix is appended.
   */
  private uniquifyValue(value: unknown, table: string, column: string): unknown {
    if (value === null || value === undefined) return value;
    const seen = this.uniquenessIndex.get(this.uniquenessKey(table, column));
    if (!seen || !seen.has(String(value))) return value;

    if (typeof value === 'string' && value.includes('@')) {
      const at = value.indexOf('@');
      const local = value.slice(0, at);
      const domain = value.slice(at + 1);
      for (let n = 2; n < 100_000; n++) {
        const cand = `${local}+${n}@${domain}`;
        if (!seen.has(cand)) return cand;
      }
    }
    if (typeof value === 'string') {
      for (let n = 2; n < 100_000; n++) {
        const cand = `${value}-${n}`;
        if (!seen.has(cand)) return cand;
      }
    }
    if (typeof value === 'number') {
      let cand = value + 1;
      while (seen.has(String(cand))) cand++;
      return cand;
    }
    // Opaque or exotic value — append a short random suffix. Won't collide
    // since we draw fresh randomness; the suffix isn't pretty but the
    // alternative is a row drop that orphans children.
    return `${String(value)}-${faker.string.alphanumeric(6)}`;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Resolve a field variation into a concrete value.
   *
   * For `derived` variations, `currentRow` must already have the referenced
   * fields populated — call non-derived variations first, then derived ones
   * in a second pass.
   */
  resolveVariation(
    variation: FieldVariation,
    currentRow: Row,
    index: number,
    sequenceKey?: string,
  ): unknown {
    switch (variation.type) {
      case 'firstName':
        return faker.person.firstName();
      case 'lastName':
        return faker.person.lastName();
      case 'fullName':
        return faker.person.fullName();
      case 'email':
        return faker.internet.email();
      case 'phone':
        return faker.phone.number();
      case 'companyName':
        return faker.company.name();
      case 'pick': {
        if (!variation.values || variation.values.length === 0) return null;
        const picked = this.rng.pick(variation.values);
        // LLMs sometimes generate stringified JSON arrays/objects as pick values
        // (e.g. subscription items, order_lines). Parse them back into real objects.
        if (typeof picked === 'string' && picked.length > 1) {
          const trimmed = picked.trim();
          if (trimmed[0] === '[' || trimmed[0] === '{') {
            try {
              return JSON.parse(trimmed);
            } catch {
              // Not valid JSON — return as-is
            }
          }
        }
        return picked;
      }
      case 'range':
        return this.rng.intBetween(variation.min ?? 0, variation.max ?? 100);
      case 'decimal_range':
        return this.rng.decimalBetween(variation.min ?? 0, variation.max ?? 100, 2);
      case 'uuid':
        return faker.string.uuid();
      case 'timestamp': {
        // Random Unix timestamp within configured range (defaults to last 6 months)
        const now = Math.floor(Date.now() / 1000);
        const sixMonthsAgo = now - 6 * 30 * 24 * 3600;
        return this.rng.intBetween(variation.min ?? sixMonthsAgo, variation.max ?? now);
      }
      case 'date': {
        // Random ISO date string within last 6 months
        const nowMs = Date.now();
        const sixMonths = 6 * 30 * 24 * 3600 * 1000;
        const ts = this.rng.intBetween(nowMs - sixMonths, nowMs);
        return new Date(ts).toISOString().split('T')[0];
      }
      case 'derived':
        return this.resolveDerivedTemplate(variation.template ?? '', currentRow);
      case 'sequence': {
        // Use prefix as the counter key so each prefix namespace is independent.
        // e.g. "cus_p1_" and "chr_cus_p1_" get separate counters both starting at 001.
        const key = variation.prefix
          ? `__prefix__${variation.prefix}`
          : (sequenceKey ?? 'seq');
        const counter = (this.sequenceCounters.get(key) ?? 0) + 1;
        this.sequenceCounters.set(key, counter);
        return `${variation.prefix ?? ''}${String(counter).padStart(3, '0')}`;
      }
      default:
        return null;
    }
  }

  /**
   * Apply all field variations to a row, handling derived fields in a second
   * pass so they can reference values generated in the first pass.
   *
   * When `uniqueColumns` is provided, every value emitted on one of those
   * columns is checked against the per-(table, column) index and mutated
   * to a non-colliding variant if necessary. This prevents downstream
   * `@unique` violations without ever dropping a row — the row keeps its
   * PK and every FK reference pointing at it stays valid.
   */
  applyVariations(
    vary: Record<string, FieldVariation>,
    baseFields: Record<string, unknown>,
    index: number,
    tableName: string,
    uniqueColumns?: ReadonlySet<string>,
  ): Row {
    const row: Row = { ...baseFields };

    // Flatten nested `fields` key: the LLM sometimes generates
    // `fields: { fields: { "object": "customer" } }`, which after spreading
    // produces `row.fields = { "object": "customer" }` — a nested object.
    // Merge it into the top-level row so downstream consumers see flat data.
    if (
      'fields' in row &&
      row.fields !== null &&
      typeof row.fields === 'object' &&
      !Array.isArray(row.fields)
    ) {
      const nested = row.fields as Record<string, unknown>;
      const isVariation = 'type' in nested &&
        typeof nested.type === 'string' &&
        KNOWN_VARIATION_TYPES.has(nested.type as string);
      if (!isVariation) {
        delete row.fields;
        for (const [k, v] of Object.entries(nested)) {
          if (row[k] === undefined || row[k] === null || row[k] === 0 || row[k] === '') {
            row[k] = v;
          }
        }
      }
    }

    // Pre-pass: detect variation objects that the LLM accidentally placed in
    // `fields` instead of `vary` (e.g. { type: "pick", values: [...] }).
    // Move them into the vary map so they get resolved properly.
    const effectiveVary = { ...vary };
    for (const [fieldName, value] of Object.entries(row)) {
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        'type' in (value as Record<string, unknown>) &&
        typeof (value as Record<string, unknown>).type === 'string'
      ) {
        const candidate = value as Record<string, unknown>;
        if (KNOWN_VARIATION_TYPES.has(candidate.type as string)) {
          effectiveVary[fieldName] = candidate as unknown as FieldVariation;
          delete row[fieldName];
        }
      }
    }

    // First pass: non-derived fields. Skip any entries whose variation is
    // null/undefined or missing a `type` — a defensive guard. Patches that
    // clear a vary slot should remove the key outright (see
    // applySetField in blueprint-patch.ts), but a stray placeholder must
    // not crash expansion.
    for (const [fieldName, variation] of Object.entries(effectiveVary)) {
      if (!variation || typeof variation !== 'object' || typeof variation.type !== 'string') continue;
      if (variation.type === 'derived') continue;
      const seqKey = `${tableName}.${fieldName}`;
      row[fieldName] = this.resolveVariation(variation, row, index, seqKey);
    }

    // Second pass: derived fields (can reference values from first pass)
    for (const [fieldName, variation] of Object.entries(effectiveVary)) {
      if (!variation || typeof variation !== 'object' || typeof variation.type !== 'string') continue;
      if (variation.type !== 'derived') continue;
      row[fieldName] = this.resolveVariation(variation, row, index);
    }

    // Final pass: resolve {{...}} placeholders in plain string values that the
    // LLM placed directly in `fields` (e.g. "billing@{{name}}.com").
    for (const [fieldName, value] of Object.entries(row)) {
      if (typeof value === 'string' && /\{\{.+?\}\}/.test(value)) {
        row[fieldName] = this.resolveDerivedTemplate(value, row);
      }
    }

    // Uniqueness pass — runs AFTER everything else so it sees the final
    // resolved values (derived templates, etc.). For every `@unique` column
    // declared by the caller, check the per-(table, column) index and mutate
    // colliders to a unique variant. The row's PK is never touched here —
    // PK collisions are handled at the dedup safety net in expander.ts so
    // FK cascading happens in one place.
    if (uniqueColumns && uniqueColumns.size > 0) {
      for (const col of uniqueColumns) {
        const current = row[col];
        if (current === undefined || current === null) continue;
        const next = this.uniquifyValue(current, tableName, col);
        if (next !== current) row[col] = next;
        this.recordUniqueValue(tableName, col, row[col]);
      }
    }

    return row;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Replace `{{fieldName}}` placeholders in a template with values from the
   * current row. If the template contains `@` (email) or looks like a URL,
   * values are sanitized (lowercased, non-alphanumeric stripped). Otherwise
   * values are inserted as-is to preserve natural names/text.
   */
  private resolveDerivedTemplate(template: string, row: Row): string {
    const needsSanitize = template.includes('@') || /^https?:\/\//.test(template);

    // Match {{fieldName}} or {{fieldName | filters...}} — strip Jinja-style filters
    return template.replace(/\{\{(\w+)(?:\s*\|[^}]*)?\}\}/g, (_match, fieldName: string) => {
      const value = row[fieldName];
      if (value === undefined || value === null) return '';
      const str = String(value);
      if (!needsSanitize) return str;
      // Sanitize for use in emails/URLs:
      return str
        .toLowerCase()
        .replace(/[^a-z0-9.\-]/g, '')
        .replace(/[.\-]{2,}/g, '.')
        .replace(/^[.\-]+|[.\-]+$/g, '');
    });
  }
}
