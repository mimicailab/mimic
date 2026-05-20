/**
 * Persona-fact conformance checker.
 *
 * Compares the *expanded* dataset against the *persona description* and
 * reports per-assertion pass/fail. The check is the missing layer between
 * "the LLM said it produced X" and "the data actually contains X".
 *
 * Pipeline position:
 *   distribution LLM → expander → validator → CONFORMANCE CHECK → fact-gen
 *
 * Stages:
 *   1. Build a data-shape summary (tables, columns, api resources).
 *   2. Call the LLM ONCE to extract structured assertions from the persona
 *      free-text. The LLM only writes JSON predicates; it does not see the
 *      data and cannot invent results.
 *   3. Evaluate each assertion deterministically against the expanded data.
 *   4. Return a structured report; caller decides what to do (warn / fail).
 */
import { z } from 'zod';
import type { ILLMClient } from '../llm/client.js';
import type { ExpandedData, Row, ApiResponse } from '../types/dataset.js';
import { logger, debugFile } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ConformanceReport {
  persona: string;
  domain: string;
  generated: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: AssertionResult[];
}

export interface AssertionResult {
  id: string;
  description: string;
  source: AssertionSource;
  predicate: Predicate;
  status: 'pass' | 'fail' | 'skip';
  expected: unknown;
  actual: unknown;
  message?: string;
}

// ---------------------------------------------------------------------------
// Assertion schema (LLM-emitted)
// ---------------------------------------------------------------------------

const FilterSchema = z.object({
  field: z.string().describe('Field path on the record. Dot-paths allowed for nested API bodies (e.g. "unit_price.amount").'),
  op: z.enum(['eq', 'ne', 'in', 'gt', 'lt', 'gte', 'lte', 'is_null', 'is_not_null', 'before', 'after']),
  value: z.unknown().optional().describe('Value to compare against. Omitted for is_null / is_not_null. Use the exact pinned value from the persona (numbers in pence/cents, dates as ISO strings).'),
});
type Filter = z.infer<typeof FilterSchema>;

const SourceTableSchema = z.object({
  kind: z.literal('table'),
  table: z.string(),
});
const SourceApiSchema = z.object({
  kind: z.literal('api'),
  platform: z.string(),
  resource: z.string(),
});
const SourceSchema = z.discriminatedUnion('kind', [SourceTableSchema, SourceApiSchema]);
type AssertionSource = z.infer<typeof SourceSchema>;

const PredicateCountSchema = z.object({
  kind: z.literal('count'),
  equals: z.number().int().nonnegative(),
  where: z.array(FilterSchema).optional(),
});
const PredicateSumSchema = z.object({
  kind: z.literal('sum'),
  field: z.string(),
  equals: z.number(),
  where: z.array(FilterSchema).optional(),
  tolerance: z.number().nonnegative().optional().describe('Optional absolute tolerance for floating sums. Default 0.'),
});
const PredicateEveryFieldEqualsSchema = z.object({
  kind: z.literal('every_field_equals'),
  field: z.string(),
  value: z.unknown(),
});
const PredicateEveryFieldInSchema = z.object({
  kind: z.literal('every_field_in'),
  field: z.string(),
  allowed: z.array(z.unknown()),
});
const PredicateDistinctValuesSchema = z.object({
  kind: z.literal('distinct_values'),
  field: z.string(),
  expected: z.array(z.unknown()).describe('Multiset of values. Order does not matter; duplicates count.'),
  where: z.array(FilterSchema).optional(),
});
const PredicateMinEqSchema = z.object({
  kind: z.literal('min_eq'),
  field: z.string(),
  equals: z.union([z.number(), z.string()]),
  where: z.array(FilterSchema).optional(),
});
const PredicateMaxEqSchema = z.object({
  kind: z.literal('max_eq'),
  field: z.string(),
  equals: z.union([z.number(), z.string()]),
  where: z.array(FilterSchema).optional(),
});
const PredicateFieldInvariantSchema = z.object({
  kind: z.literal('field_invariant'),
  left: z.string().describe('Field path A'),
  op: z.enum(['le', 'lt', 'ge', 'gt', 'eq', 'ne']),
  right: z.string().describe('Field path B'),
  where: z.array(FilterSchema).optional(),
});

const PredicateSchema = z.discriminatedUnion('kind', [
  PredicateCountSchema,
  PredicateSumSchema,
  PredicateEveryFieldEqualsSchema,
  PredicateEveryFieldInSchema,
  PredicateDistinctValuesSchema,
  PredicateMinEqSchema,
  PredicateMaxEqSchema,
  PredicateFieldInvariantSchema,
]);
type Predicate = z.infer<typeof PredicateSchema>;

const AssertionSchema = z.object({
  id: z.string().describe('Stable kebab-case slug derived from the claim.'),
  description: z.string().describe('Short paraphrase of the persona claim being tested.'),
  source: SourceSchema,
  predicate: PredicateSchema,
});
export type Assertion = z.infer<typeof AssertionSchema>;

const AssertionListSchema = z.object({
  assertions: z.array(AssertionSchema).describe('All testable persona claims. Skip vague/qualitative statements.'),
});

// ---------------------------------------------------------------------------
// LLM extraction
// ---------------------------------------------------------------------------

const EXTRACTION_SYSTEM = `You are a conformance-test extractor. You read a persona description and produce JSON assertions that can be evaluated deterministically against generated data.

## Output contract

Return { "assertions": [Assertion, ...] } where each Assertion targets a *specific, exact* claim from the persona. Vague/qualitative statements ("growth-stage", "B2B", "indie segment") are not testable — SKIP them.

## What counts as testable

Extract one assertion per concrete claim the persona makes:
- Exact counts:                "Exactly 1,200 customers"  →  count == 1200
- Exact sums:                  "MRR is exactly £77,200"   →  sum == 7720000  (pence)
- Tier breakdowns:             "856 starter customers"    →  count where unit_amount=2900 == 856
- Pinned status counts:        "3 invoices payment_due"   →  count where status='payment_due' == 3
- Per-row global invariants:   "Every row has status='active'"  →  every_field_equals('status','active')
- Per-row enum allowlists:     "plan in {free, starter, pro, enterprise}"  →  every_field_in
- Exact value sets:            "totals are £4,800, £4,200, £3,400"   →  distinct_values [480000, 420000, 340000]
- Pinned dates:                "oldest dated 2026-04-11"  →  min_eq('date', '2026-04-11', where status='payment_due')
- Cross-field invariants:      "amount_refunded ≤ amount" →  field_invariant le

## Predicate semantics

- count        — number of records matching optional \`where\`
- sum          — sum of \`field\` across matching records (use pence/cents for currency)
- every_field_equals — for ALL records in the source, the field equals the value
- every_field_in — for ALL records, the field's value is in the allowed set
- distinct_values — the multiset of \`field\` values across matching records equals the expected multiset (duplicates count, order doesn't)
- min_eq / max_eq — extremum of \`field\` across matching records equals the expected value
- field_invariant — for every record, left <op> right holds

## Field paths

For API sources, records are the response BODY. Dot-paths allowed:
  body field "status" → field: "status"
  nested "unit_price.amount" → field: "unit_price.amount"
  array elements not supported — instead, point the assertion at the array as a separate sub-resource if available, or skip.

For table sources, records are the DB rows.

## Currency

Persona narratives use £/$/€ + decimal. Generated data uses INTEGER pence/cents on every monetary field. Always convert: £77,200 → 7720000. £4,800 → 480000.

## Coverage

Produce as many assertions as the persona supports — typically 20-60 for a rich persona. Each persona-stated fact gets at least one assertion. Cover every platform/resource that has pinned numerics. Skip statements that name a thing but no exact value.

## Output rules

- Output ONLY valid JSON matching the schema. No markdown, no commentary.
- Each id must be unique kebab-case (e.g. "stripe-customer-count", "chargebee-overdue-total-sum").
- Never invent numbers not present in the persona. If a claim is approximate ("around 50", "~30%"), skip it.`;

interface FieldShape {
  /** Field name. */
  name: string;
  /** Fraction of sampled records where this field is null/undefined (0..1). */
  nullRate: number;
}

interface TableShape {
  rowCount: number;
  fields: FieldShape[];
}

interface ApiResourceShape {
  recordCount: number;
  /** Field names sampled from response BODY (one level deep). */
  fields: FieldShape[];
}

interface DataShape {
  tables: Record<string, TableShape>;
  apis: Record<string, Record<string, ApiResourceShape>>;
}

/**
 * Inspect the expanded data and produce a structured shape describing what
 * the conformance LLM can reference. We sample up to 50 records per source
 * to compute null-rate per field so the LLM knows when to add an
 * `is_not_null` filter on assertions covering nullable columns.
 */
function buildDataShape(expanded: ExpandedData): DataShape {
  const tables: Record<string, TableShape> = {};
  for (const [name, rows] of Object.entries(expanded.tables)) {
    if (rows.length === 0) continue;
    tables[name] = computeShapeFromRows(rows as Row[]);
  }
  const apis: Record<string, Record<string, ApiResourceShape>> = {};
  for (const [platform, set] of Object.entries(expanded.apiResponses)) {
    apis[platform] = {};
    for (const [resource, responses] of Object.entries(set.responses)) {
      if (responses.length === 0) continue;
      const bodies = responses.map((r) => r.body as Record<string, unknown>);
      apis[platform][resource] = {
        recordCount: responses.length,
        fields: computeShapeFromRows(bodies).fields,
      };
    }
  }
  return { tables, apis };
}

function computeShapeFromRows(rows: Record<string, unknown>[]): TableShape {
  const sample = rows.slice(0, 50);
  const nullCounts = new Map<string, number>();
  const presentCounts = new Map<string, number>();
  for (const r of sample) {
    if (!r || typeof r !== 'object') continue;
    for (const [k, v] of Object.entries(r)) {
      presentCounts.set(k, (presentCounts.get(k) ?? 0) + 1);
      if (v == null) nullCounts.set(k, (nullCounts.get(k) ?? 0) + 1);
    }
  }
  const fields: FieldShape[] = [];
  for (const [name, present] of presentCounts) {
    const nulls = nullCounts.get(name) ?? 0;
    fields.push({ name, nullRate: present === 0 ? 0 : nulls / present });
  }
  fields.sort((a, b) => a.name.localeCompare(b.name));
  return { rowCount: rows.length, fields };
}

function renderDataShape(shape: DataShape): string {
  const lines: string[] = ['## Available sources', ''];
  const fmtField = (f: FieldShape): string =>
    f.nullRate > 0.05 ? `${f.name}(nullable)` : f.name;

  if (Object.keys(shape.tables).length > 0) {
    lines.push('### Tables (DB rows)');
    for (const [name, t] of Object.entries(shape.tables)) {
      lines.push(`- ${name} (${t.rowCount} rows): ${t.fields.map(fmtField).join(', ')}`);
    }
    lines.push('');
  }
  if (Object.keys(shape.apis).length > 0) {
    lines.push('### API platforms (records are response BODY — listed fields are top-level body keys)');
    for (const [platform, resources] of Object.entries(shape.apis)) {
      for (const [resource, r] of Object.entries(resources)) {
        lines.push(
          `- ${platform}.${resource} (${r.recordCount} records): ${r.fields.map(fmtField).join(', ')}`,
        );
      }
    }
    lines.push('');
  }
  lines.push(
    '`nullable` after a field name means the field is null on >5% of sampled records — ' +
      "if you write an `every_field_*` assertion over that field, you MUST also include a " +
      '`where: [{ field: "<that field>", op: "is_not_null" }]` filter, otherwise null rows ' +
      'will be counted as offenders even when the assertion only meant non-null rows.',
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Assertion validation
// ---------------------------------------------------------------------------

interface AssertionValidationIssue {
  id: string;
  code: 'path_unresolved' | 'missing_null_filter' | 'bad_count_target';
  message: string;
}

/**
 * Validate extracted assertions against the data shape BEFORE running them.
 *
 * Catches the common LLM extraction mistakes from observed failures:
 *
 *  - Path's first segment doesn't exist on the source — usually the LLM
 *    hallucinated a field name (`monthlyRecurringRevenue` on a record that
 *    doesn't have it).
 *  - `every_field_*` over a nullable field WITHOUT an `is_not_null` filter —
 *    null rows get counted as offenders even when the assertion meant the
 *    populated subset (e.g. "every non-null billing_platform is one of {8}").
 *  - `count` predicate against a source that the filter can't possibly
 *    match because the filter field doesn't exist on the source's records.
 */
export function validateAssertions(
  assertions: Assertion[],
  shape: DataShape,
): AssertionValidationIssue[] {
  const issues: AssertionValidationIssue[] = [];

  for (const a of assertions) {
    // Resolve the source's field shape.
    let fields: FieldShape[] | null = null;
    if (a.source.kind === 'table') {
      fields = shape.tables[a.source.table]?.fields ?? null;
    } else {
      fields = shape.apis[a.source.platform]?.[a.source.resource]?.fields ?? null;
    }
    if (!fields) continue; // The runtime evaluator already reports skip on unknown sources.

    const fieldMap = new Map(fields.map((f) => [f.name, f]));

    // 1. First-segment path validation across every field referenced by
    //    the predicate (`field`, `left`, `right`) and by each `where` entry.
    const referenced: string[] = [];
    const p = a.predicate;
    if ('field' in p && typeof p.field === 'string') referenced.push(p.field);
    if (p.kind === 'field_invariant') {
      referenced.push(p.left, p.right);
    }
    if ('where' in p && p.where) {
      for (const f of p.where) referenced.push(f.field);
    }
    for (const path of referenced) {
      const firstSeg = path.split(/[.[]/)[0];
      if (firstSeg && !fieldMap.has(firstSeg)) {
        issues.push({
          id: a.id,
          code: 'path_unresolved',
          message:
            `Field path "${path}" begins with "${firstSeg}" which is not present on ` +
            `${a.source.kind === 'table' ? a.source.table : `${a.source.platform}.${a.source.resource}`}'s records.`,
        });
      }
    }

    // 2. every_field_* over nullable field without is_not_null filter.
    if (p.kind === 'every_field_equals' || p.kind === 'every_field_in') {
      const f = fieldMap.get(p.field.split(/[.[]/)[0]!);
      if (f && f.nullRate > 0.05) {
        const hasNullFilter = false; // every_field_* doesn't take `where` today
        if (!hasNullFilter) {
          issues.push({
            id: a.id,
            code: 'missing_null_filter',
            message:
              `every_field_* over nullable field "${p.field}" (${(f.nullRate * 100).toFixed(0)}% null) ` +
              `— wrap the rule with a count + where: [{ field: "${p.field}", op: "is_not_null" }] ` +
              'predicate instead, OR add a non-null guard via a distinct_values+where assertion.',
          });
        }
      }
    }
  }

  return issues;
}

/**
 * Format validation issues into a structured retry prompt fragment.
 */
function formatAssertionIssuesForRetry(issues: AssertionValidationIssue[]): string {
  const lines = [
    'The previous assertion list had these problems. Re-emit the COMPLETE list, fixing each:',
    '',
  ];
  for (const i of issues) {
    lines.push(`  - [${i.code}] ${i.id}: ${i.message}`);
  }
  lines.push(
    '',
    'For `path_unresolved`: check the data-shape summary above; only use field names that appear there.',
    'For `missing_null_filter`: convert the `every_field_*` assertion into a `count` with a `where: is_not_null` ' +
      'filter, or skip it.',
  );
  return lines.join('\n');
}

async function extractAssertions(
  llm: ILLMClient,
  persona: { name: string; description: string },
  domain: string,
  shape: DataShape,
): Promise<Assertion[]> {
  const baseUserPrompt = [
    `Domain: ${domain}`,
    `Persona: "${persona.name}"`,
    '',
    persona.description,
    '',
    renderDataShape(shape),
  ].join('\n');

  // First attempt.
  let assertions: Assertion[];
  try {
    const result = await llm.generateObject({
      schema: AssertionListSchema,
      schemaName: 'ConformanceAssertions',
      schemaDescription: 'Extracted testable assertions from persona description.',
      system: EXTRACTION_SYSTEM,
      prompt: baseUserPrompt + '\n\nExtract all testable assertions. Return JSON.',
      label: `conformance-extract:${persona.name}`,
      category: 'evaluation',
      temperature: 0.1,
    });
    assertions = result.object.assertions;
  } catch (err) {
    logger.warn(
      `Conformance extraction failed: ${err instanceof Error ? err.message : String(err)}. ` +
      `Skipping conformance check for ${persona.name}.`,
    );
    return [];
  }

  // Validate. If clean, return as-is. If not, retry ONCE with the issues
  // injected as a corrections block — same pattern as schema-mapping repair.
  const issues = validateAssertions(assertions, shape);
  if (issues.length === 0) return assertions;

  logger.warn(
    `Conformance extraction had ${issues.length} validation issue(s); retrying once with corrections.`,
  );
  try {
    const retryPrompt =
      baseUserPrompt +
      '\n\n' +
      formatAssertionIssuesForRetry(issues) +
      '\n\nRe-emit the COMPLETE assertions list with corrections applied. Return JSON.';
    const result = await llm.generateObject({
      schema: AssertionListSchema,
      schemaName: 'ConformanceAssertions',
      schemaDescription: 'Extracted testable assertions from persona description (corrected).',
      system: EXTRACTION_SYSTEM,
      prompt: retryPrompt,
      label: `conformance-extract:${persona.name}:repair`,
      category: 'evaluation',
      temperature: 0.1,
    });
    return result.object.assertions;
  } catch (err) {
    logger.warn(
      `Conformance extraction repair failed: ${err instanceof Error ? err.message : String(err)}. ` +
      `Falling back to the unvalidated first-attempt assertions.`,
    );
    return assertions;
  }
}

// ---------------------------------------------------------------------------
// Deterministic evaluator
// ---------------------------------------------------------------------------

function getPath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function recordsFor(source: AssertionSource, expanded: ExpandedData): unknown[] | null {
  if (source.kind === 'table') {
    const rows = expanded.tables[source.table];
    return rows ? rows.slice() : null;
  }
  const platform = expanded.apiResponses[source.platform];
  if (!platform) return null;
  const responses = platform.responses[source.resource];
  if (!responses) return null;
  // Unwrap response envelope — assertions target the body.
  return responses.map((r: ApiResponse) => r.body);
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function compareDateOrNumber(a: unknown, b: unknown, op: 'gt' | 'lt' | 'gte' | 'lte'): boolean {
  // Try numeric first, then ISO-date string compare.
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na != null && nb != null) {
    if (op === 'gt') return na > nb;
    if (op === 'lt') return na < nb;
    if (op === 'gte') return na >= nb;
    return na <= nb;
  }
  const sa = typeof a === 'string' ? a : String(a);
  const sb = typeof b === 'string' ? b : String(b);
  if (op === 'gt') return sa > sb;
  if (op === 'lt') return sa < sb;
  if (op === 'gte') return sa >= sb;
  return sa <= sb;
}

function matchesFilter(record: unknown, filter: Filter): boolean {
  const v = getPath(record, filter.field);
  const target = filter.value;
  switch (filter.op) {
    case 'eq':  return v === target || String(v) === String(target);
    case 'ne':  return v !== target && String(v) !== String(target);
    case 'is_null':     return v == null;
    case 'is_not_null': return v != null;
    case 'in': {
      if (!Array.isArray(target)) return false;
      return target.some((t) => t === v || String(t) === String(v));
    }
    case 'gt':  return compareDateOrNumber(v, target, 'gt');
    case 'lt':  return compareDateOrNumber(v, target, 'lt');
    case 'gte': return compareDateOrNumber(v, target, 'gte');
    case 'lte': return compareDateOrNumber(v, target, 'lte');
    case 'before': return compareDateOrNumber(v, target, 'lt');
    case 'after':  return compareDateOrNumber(v, target, 'gt');
  }
}

function applyFilters(records: unknown[], filters?: Filter[]): unknown[] {
  if (!filters || filters.length === 0) return records;
  return records.filter((r) => filters.every((f) => matchesFilter(r, f)));
}

function evalAssertion(a: Assertion, expanded: ExpandedData): AssertionResult {
  const base: Omit<AssertionResult, 'status' | 'actual' | 'expected' | 'message'> = {
    id: a.id,
    description: a.description,
    source: a.source,
    predicate: a.predicate,
  };
  const records = recordsFor(a.source, expanded);
  if (records == null) {
    return {
      ...base,
      status: 'skip',
      expected: null,
      actual: null,
      message: `Source not found: ${a.source.kind === 'table' ? a.source.table : `${a.source.platform}.${a.source.resource}`}`,
    };
  }

  const p = a.predicate;

  if (p.kind === 'count') {
    const filtered = applyFilters(records, p.where);
    const actual = filtered.length;
    return { ...base, status: actual === p.equals ? 'pass' : 'fail', expected: p.equals, actual };
  }

  if (p.kind === 'sum') {
    const filtered = applyFilters(records, p.where);
    let sum = 0;
    let missing = 0;
    for (const r of filtered) {
      const v = getPath(r, p.field);
      const n = toNumber(v);
      if (n == null) missing += 1;
      else sum += n;
    }
    const tol = p.tolerance ?? 0;
    const pass = Math.abs(sum - p.equals) <= tol;
    return {
      ...base,
      status: pass ? 'pass' : 'fail',
      expected: p.equals,
      actual: sum,
      message: missing > 0 ? `${missing}/${filtered.length} records had non-numeric ${p.field}` : undefined,
    };
  }

  if (p.kind === 'every_field_equals') {
    const offenders = [] as { idx: number; value: unknown }[];
    for (let i = 0; i < records.length; i++) {
      const v = getPath(records[i], p.field);
      const ok = v === p.value || String(v) === String(p.value);
      if (!ok) offenders.push({ idx: i, value: v });
    }
    return {
      ...base,
      status: offenders.length === 0 ? 'pass' : 'fail',
      expected: p.value,
      actual: offenders.length === 0 ? p.value : { offenderCount: offenders.length, sample: offenders.slice(0, 3) },
    };
  }

  if (p.kind === 'every_field_in') {
    const allowSet = new Set(p.allowed.map((x) => String(x)));
    const offenders: unknown[] = [];
    for (const r of records) {
      const v = getPath(r, p.field);
      if (!allowSet.has(String(v))) offenders.push(v);
    }
    return {
      ...base,
      status: offenders.length === 0 ? 'pass' : 'fail',
      expected: p.allowed,
      actual: offenders.length === 0 ? '∀ in allowed' : { offenderCount: offenders.length, sample: offenders.slice(0, 5) },
    };
  }

  if (p.kind === 'distinct_values') {
    const filtered = applyFilters(records, p.where);
    const actual = filtered.map((r) => getPath(r, p.field));
    const sortKey = (v: unknown) => (typeof v === 'number' ? v : String(v ?? ''));
    const a1 = [...actual].sort((x, y) => (sortKey(x) > sortKey(y) ? 1 : -1));
    const a2 = [...p.expected].sort((x, y) => (sortKey(x) > sortKey(y) ? 1 : -1));
    const pass = a1.length === a2.length && a1.every((v, i) => String(v) === String(a2[i]));
    return { ...base, status: pass ? 'pass' : 'fail', expected: p.expected, actual };
  }

  if (p.kind === 'min_eq' || p.kind === 'max_eq') {
    const filtered = applyFilters(records, p.where);
    const values = filtered.map((r) => getPath(r, p.field)).filter((v) => v != null);
    if (values.length === 0) {
      return { ...base, status: 'fail', expected: p.equals, actual: null, message: 'No matching records' };
    }
    const wantLt = p.kind === 'min_eq';
    let extremum: unknown = values[0];
    for (let i = 1; i < values.length; i++) {
      const v = values[i];
      if (compareDateOrNumber(v, extremum, wantLt ? 'lt' : 'gt')) extremum = v;
    }
    const pass = String(extremum) === String(p.equals) || toNumber(extremum) === toNumber(p.equals);
    return { ...base, status: pass ? 'pass' : 'fail', expected: p.equals, actual: extremum };
  }

  if (p.kind === 'field_invariant') {
    const filtered = applyFilters(records, p.where);
    const offenders: { idx: number; left: unknown; right: unknown }[] = [];
    for (let i = 0; i < filtered.length; i++) {
      const l = getPath(filtered[i], p.left);
      const r = getPath(filtered[i], p.right);
      let ok: boolean;
      switch (p.op) {
        case 'eq': ok = String(l) === String(r) || toNumber(l) === toNumber(r); break;
        case 'ne': ok = !(String(l) === String(r) || toNumber(l) === toNumber(r)); break;
        case 'le': ok = compareDateOrNumber(l, r, 'lte'); break;
        case 'lt': ok = compareDateOrNumber(l, r, 'lt'); break;
        case 'ge': ok = compareDateOrNumber(l, r, 'gte'); break;
        case 'gt': ok = compareDateOrNumber(l, r, 'gt'); break;
      }
      if (!ok) offenders.push({ idx: i, left: l, right: r });
    }
    return {
      ...base,
      status: offenders.length === 0 ? 'pass' : 'fail',
      expected: `${p.left} ${p.op} ${p.right}`,
      actual: offenders.length === 0 ? '∀ holds' : { offenderCount: offenders.length, sample: offenders.slice(0, 3) },
    };
  }

  // Exhaustive — TS should narrow here, but be safe at runtime.
  return { ...base, status: 'skip', expected: null, actual: null, message: 'Unknown predicate' };
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export async function checkConformance(
  llm: ILLMClient,
  expanded: ExpandedData,
  persona: { name: string; description: string },
  domain: string,
): Promise<ConformanceReport> {
  logger.step(`Checking persona conformance for ${persona.name}...`);

  const shape = buildDataShape(expanded);
  const assertions = await extractAssertions(llm, persona, domain, shape);

  const results: AssertionResult[] = assertions.map((a) => evalAssertion(a, expanded));

  const report: ConformanceReport = {
    persona: persona.name,
    domain,
    generated: new Date().toISOString(),
    total: results.length,
    passed: results.filter((r) => r.status === 'pass').length,
    failed: results.filter((r) => r.status === 'fail').length,
    skipped: results.filter((r) => r.status === 'skip').length,
    results,
  };

  debugFile(`CONFORMANCE REPORT [${persona.name}]`, {
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    skipped: report.skipped,
    failures: results.filter((r) => r.status === 'fail').map((r) => ({
      id: r.id,
      description: r.description,
      expected: r.expected,
      actual: r.actual,
    })),
  });

  return report;
}

export function summarizeReport(report: ConformanceReport): string {
  const lines: string[] = [];
  lines.push(`Conformance: ${report.passed}/${report.total} passed, ${report.failed} failed, ${report.skipped} skipped`);
  if (report.failed === 0) return lines.join('\n');
  lines.push('Failures:');
  for (const r of report.results) {
    if (r.status !== 'fail') continue;
    const src = r.source.kind === 'table' ? r.source.table : `${r.source.platform}.${r.source.resource}`;
    lines.push(`  ✗ [${src}] ${r.description}`);
    lines.push(`      expected=${JSON.stringify(r.expected)} actual=${JSON.stringify(r.actual)}${r.message ? ' (' + r.message + ')' : ''}`);
  }
  return lines.join('\n');
}
