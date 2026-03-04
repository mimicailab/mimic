import { faker } from '@faker-js/faker';
import type { FieldVariation, Row } from '../types/index.js';
import type { SeededRandom } from './seed-random.js';

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
      case 'pick':
        if (!variation.values || variation.values.length === 0) return null;
        return this.rng.pick(variation.values);
      case 'range':
        return this.rng.intBetween(variation.min ?? 0, variation.max ?? 100);
      case 'decimal_range':
        return this.rng.decimalBetween(variation.min ?? 0, variation.max ?? 100, 2);
      case 'uuid':
        return faker.string.uuid();
      case 'derived':
        return this.resolveDerivedTemplate(variation.template ?? '', currentRow);
      case 'sequence': {
        const key = sequenceKey ?? variation.prefix ?? 'seq';
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

    // First pass: non-derived fields
    for (const [fieldName, variation] of Object.entries(vary)) {
      if (variation.type === 'derived') continue;
      const seqKey = `${tableName}.${fieldName}`;
      row[fieldName] = this.resolveVariation(variation, row, index, seqKey);
    }

    // Second pass: derived fields (can reference values from first pass)
    for (const [fieldName, variation] of Object.entries(vary)) {
      if (variation.type !== 'derived') continue;
      row[fieldName] = this.resolveVariation(variation, row, index);
    }

    return row;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Replace `{{fieldName}}` placeholders in a template with values from the
   * current row. Values are sanitized for common use cases:
   * - Lowercased
   * - Spaces replaced with dots (for email-style templates)
   */
  private resolveDerivedTemplate(template: string, row: Row): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_match, fieldName: string) => {
      const value = row[fieldName];
      if (value === undefined || value === null) return '';
      const str = String(value);
      // Sanitize for use in emails/usernames:
      // - lowercase
      // - strip non-alphanumeric chars (except dots and hyphens)
      // - collapse multiple dots/hyphens
      // - trim leading/trailing dots/hyphens
      return str
        .toLowerCase()
        .replace(/[^a-z0-9.\-]/g, '')
        .replace(/[.\-]{2,}/g, '.')
        .replace(/^[.\-]+|[.\-]+$/g, '');
    });
  }
}
