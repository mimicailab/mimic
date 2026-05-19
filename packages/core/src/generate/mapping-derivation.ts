/**
 * Mapping derivation — runtime and validation for SchemaMappingEntry.derivation.
 *
 * The schema-mapping LLM emits three mapping forms (see SchemaMappingEntry):
 *   1. Blind copy        — no `derivation` field, mirror does `row[col] = body[apiField]`
 *   2. `derive`          — `{ from, cases, default? }` — value-transformation via case lookup
 *   3. `constant`        — `{ value }` — flat constant
 *
 * This module supplies:
 *   - resolvePath(body, path) — read a dot/index path off an API body
 *   - applyDerivation(body, derivation) — compute the destination value
 *   - validateMappings(mappings, schema, resourceSpecs) — pre-mirror checks
 */
import type { SchemaMapping, SchemaMappingEntry, MappingDerivation } from '../types/blueprint.js';
import type { SchemaModel } from '../types/schema.js';
import type { AdapterResourceSpecs, ResourceFieldSpec } from '../types/adapter.js';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Parse a dot/index path into ordered segments. Supports:
 *   "items.data[0].price.unit_amount"
 *   "items.data.0.price.unit_amount"   (equivalent — digit segment is an array index)
 *   "address.country"
 *
 * Returns an array of segments. Segments are strings; numeric ones still
 * stringify (consumers decide indexing semantics).
 */
export function parsePath(path: string): string[] {
  // Replace bracket-index form `[N]` with `.N` so we can split on dots uniformly.
  const normalized = path.replace(/\[(\d+)\]/g, '.$1');
  return normalized.split('.').filter((s) => s.length > 0);
}

/**
 * Walk `body` along `path`. Returns the value at the end, or `undefined` if
 * any segment is missing.
 */
export function resolvePath(body: unknown, path: string): unknown {
  const segments = parsePath(path);
  let cur: unknown = body;
  for (const seg of segments) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isFinite(idx)) return undefined;
      cur = cur[idx];
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Derivation runtime
// ---------------------------------------------------------------------------

export interface DerivationResult {
  ok: boolean;
  value?: unknown;
  reason?: string;
}

/**
 * Compute the value a derivation produces for a given API body.
 *
 *   - constant      → always { ok: true, value: derivation.value }
 *   - derive        → resolve `from`, look up the stringified value in `cases`,
 *                     fall back to `default` if absent. Returns `ok: false` (with
 *                     a reason) when neither `cases` nor `default` resolves —
 *                     the mirror caller decides whether that's fatal.
 */
export function applyDerivation(
  body: unknown,
  derivation: MappingDerivation,
): DerivationResult {
  if (derivation.kind === 'constant') {
    return { ok: true, value: derivation.value };
  }
  const raw = resolvePath(body, derivation.from);
  if (raw === undefined || raw === null) {
    if (derivation.default !== undefined) {
      return { ok: true, value: derivation.default };
    }
    return { ok: false, reason: `path "${derivation.from}" missing on body and no default set` };
  }
  const key = String(raw);
  if (Object.prototype.hasOwnProperty.call(derivation.cases, key)) {
    return { ok: true, value: derivation.cases[key] };
  }
  if (derivation.default !== undefined) {
    return { ok: true, value: derivation.default };
  }
  return {
    ok: false,
    reason: `value ${JSON.stringify(raw)} at "${derivation.from}" has no case and no default`,
  };
}

// ---------------------------------------------------------------------------
// Pre-mirror validation
// ---------------------------------------------------------------------------

export interface MappingValidationError {
  /** Which mapping entry the error is about — copied so error messages can cite specifics. */
  entry: SchemaMappingEntry;
  /** Short machine-readable category. */
  code:
    | 'enum_violation_in_cases'
    | 'enum_violation_in_default'
    | 'enum_violation_in_constant'
    | 'enum_violation_in_copy'
    | 'path_unresolved_in_spec'
    | 'unknown_db_column'
    | 'unknown_api_resource';
  /** Human-readable explanation. */
  message: string;
}

/**
 * Walk every mapping entry and verify it can produce values the destination
 * column accepts.
 *
 * Validation rules:
 *   1. If the destination column declares an enum, EVERY destination value
 *      the mapping can produce must be in that enum.
 *      - For `derive`: every value in `cases` and `default` (if set).
 *      - For `constant`: the `value`.
 *      - For blind `copy`: we can't know the source value space, so we
 *        emit a warning (not a hard error) only when the source field is
 *        also enum-shaped on the spec and the enums don't overlap.
 *   2. If the destination column is unknown to the schema → error.
 *   3. If the apiResource is unknown to the adapter spec → error.
 *   4. (When specs are available) For `derive.from`, the first path segment
 *      must be a real field on the apiResource. Deep traversal isn't
 *      enforced — list envelopes, nested embeds, and array indices make
 *      static path validation brittle past one segment.
 */
export function validateMappings(
  mapping: SchemaMapping,
  schema: SchemaModel,
  resourceSpecs?: Record<string, AdapterResourceSpecs>,
): MappingValidationError[] {
  const errors: MappingValidationError[] = [];

  const tableIndex = new Map<string, Map<string, { enumValues?: string[] }>>();
  for (const table of schema.tables) {
    const cols = new Map<string, { enumValues?: string[] }>();
    for (const col of table.columns) {
      cols.set(col.name, { enumValues: col.enumValues });
    }
    tableIndex.set(table.name, cols);
  }

  for (const entry of mapping.mappings) {
    const tableCols = tableIndex.get(entry.dbTable);
    if (!tableCols) continue; // an unknown table is reported elsewhere if at all
    const col = tableCols.get(entry.dbColumn);
    if (!col) {
      errors.push({
        entry,
        code: 'unknown_db_column',
        message: `Mapping target ${entry.dbTable}.${entry.dbColumn} does not exist in the schema.`,
      });
      continue;
    }

    // Spec lookup — used both for path validation and (potentially) source
    // enum sniffing. We tolerate missing specs gracefully — the new
    // derivation forms validate independently of spec availability.
    const adapterSpec = resourceSpecs?.[entry.adapterId];
    const resourceSpec = adapterSpec?.resources?.[entry.apiResource];
    if (adapterSpec && !resourceSpec) {
      errors.push({
        entry,
        code: 'unknown_api_resource',
        message: `Mapping references ${entry.adapterId}.${entry.apiResource} which is not in the adapter spec.`,
      });
      // Don't continue — also validate enum membership below if possible.
    }

    // Enum membership: check what each form can produce.
    const enumSet =
      col.enumValues && col.enumValues.length > 0 ? new Set(col.enumValues) : null;

    if (entry.derivation) {
      if (entry.derivation.kind === 'constant') {
        if (enumSet && !enumSet.has(String(entry.derivation.value))) {
          errors.push({
            entry,
            code: 'enum_violation_in_constant',
            message:
              `Constant value ${JSON.stringify(entry.derivation.value)} for ` +
              `${entry.dbTable}.${entry.dbColumn} is not in enum {${col.enumValues!.join(', ')}}.`,
          });
        }
      } else {
        if (enumSet) {
          const offenders: string[] = [];
          for (const v of Object.values(entry.derivation.cases)) {
            if (!enumSet.has(String(v))) offenders.push(String(v));
          }
          if (offenders.length > 0) {
            errors.push({
              entry,
              code: 'enum_violation_in_cases',
              message:
                `Derive cases for ${entry.dbTable}.${entry.dbColumn} produce ` +
                `${JSON.stringify([...new Set(offenders)])} which are not in enum ` +
                `{${col.enumValues!.join(', ')}}.`,
            });
          }
          if (
            entry.derivation.default !== undefined &&
            !enumSet.has(String(entry.derivation.default))
          ) {
            errors.push({
              entry,
              code: 'enum_violation_in_default',
              message:
                `Derive default ${JSON.stringify(entry.derivation.default)} for ` +
                `${entry.dbTable}.${entry.dbColumn} is not in enum ` +
                `{${col.enumValues!.join(', ')}}.`,
            });
          }
        }

        // Path first-segment check — best-effort. Full path resolution
        // can't be done against the spec for nested arrays / embedded
        // objects, so we only verify the first segment exists.
        if (resourceSpec) {
          const firstSeg = parsePath(entry.derivation.from)[0];
          if (firstSeg && !(firstSeg in resourceSpec.fields)) {
            errors.push({
              entry,
              code: 'path_unresolved_in_spec',
              message:
                `Derive path "${entry.derivation.from}" begins with "${firstSeg}" ` +
                `which is not a field on ${entry.adapterId}.${entry.apiResource}.`,
            });
          }
        }
      }
    } else if (enumSet && resourceSpec) {
      // Blind copy — warn (as error) when the source field is itself enum-shaped
      // AND the two enums have empty intersection. This is the classic
      // "users.plan ← paddle.subscription.collection_mode" mistake — both
      // are enums, but disjoint.
      const sourceField: ResourceFieldSpec | undefined =
        resourceSpec.fields[entry.apiField];
      if (sourceField?.enum && sourceField.enum.length > 0) {
        const sourceEnumSet = new Set(
          sourceField.enum.map((v) => String(v)),
        );
        let hasOverlap = false;
        for (const v of sourceEnumSet) {
          if (enumSet.has(v)) {
            hasOverlap = true;
            break;
          }
        }
        if (!hasOverlap) {
          errors.push({
            entry,
            code: 'enum_violation_in_copy',
            message:
              `Blind copy ${entry.adapterId}.${entry.apiResource}.${entry.apiField} → ` +
              `${entry.dbTable}.${entry.dbColumn} maps disjoint enums: ` +
              `source {${sourceField.enum.join(', ')}} vs destination {${col.enumValues!.join(', ')}}. ` +
              `Use a 'derive' mapping with explicit cases instead.`,
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Format a list of validation errors for the LLM retry path.
 *
 * The output is a structured prompt fragment the caller can append to the
 * original schema-mapping request to ask for a corrected version.
 */
export function formatValidationErrorsForRetry(
  errors: MappingValidationError[],
): string {
  if (errors.length === 0) return '';
  const lines: string[] = [
    'Your previous schema-mapping output had the following problems. ' +
      'Re-emit the COMPLETE mappings array, fixing each:',
    '',
  ];
  for (const err of errors) {
    lines.push(
      `  - [${err.code}] ${err.entry.adapterId}.${err.entry.apiResource} → ` +
        `${err.entry.dbTable}.${err.entry.dbColumn}: ${err.message}`,
    );
  }
  lines.push(
    '',
    'Use `derivation: { kind: "derive", from, cases, default? }` when the source ' +
      'value space differs from the destination. Use `derivation: { kind: "constant", value }` ' +
      'when no API field encodes the destination column. EVERY destination value ' +
      "MUST be in the destination column's enum.",
  );
  return lines.join('\n');
}
