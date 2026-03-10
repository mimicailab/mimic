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

  constructor(rng: SeededRandom, seed: number) {
    this.rng = rng;
    faker.seed(seed);
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
   */
  applyVariations(
    vary: Record<string, FieldVariation>,
    baseFields: Record<string, unknown>,
    index: number,
    tableName: string,
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

    // First pass: non-derived fields
    for (const [fieldName, variation] of Object.entries(effectiveVary)) {
      if (variation.type === 'derived') continue;
      const seqKey = `${tableName}.${fieldName}`;
      row[fieldName] = this.resolveVariation(variation, row, index, seqKey);
    }

    // Second pass: derived fields (can reference values from first pass)
    for (const [fieldName, variation] of Object.entries(effectiveVary)) {
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
