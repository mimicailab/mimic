import { z } from 'zod';
import type { LLMClient } from '../llm/client.js';
import type { ExpandedData, Row } from '../types/dataset.js';
import type { Fact } from '../types/fact-manifest.js';
import { logger, debugFile } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// DataStats — comprehensive, deterministic stats document
//
// Every number that can ever appear in a generated fact must come from this
// document. The LLM is given a flattened view as "path = value" lines and is
// only allowed to cite paths; it never types digits.
// ---------------------------------------------------------------------------

export interface DataStats {
  tables: Record<string, TableStats>;
  apis: Record<string, Record<string, ResourceStats>>;
  /** Cross-surface comparisons: when a DB table maps to an API resource (by
   * convention: table singular ≈ resource name), drift between the two is
   * pre-computed so the LLM can cite it without doing arithmetic. */
  crossSurface: Record<string, CrossSurfaceStat>;
}

interface TableStats {
  rowCount: number;
  /** Categorical column → value → count */
  distributions: Record<string, Record<string, number>>;
  /** Categorical column → value → percentage (0-100, two decimals) */
  percentages: Record<string, Record<string, number>>;
  /** Numeric column → {min, max, sum, avg} */
  numerics: Record<string, { min: number; max: number; sum: number; avg: number }>;
  /** Date column → age bucket → count */
  dateBuckets: Record<string, Record<string, number>>;
}

interface ResourceStats {
  count: number;
  statusDistribution: Record<string, number>;
  statusPercentages: Record<string, number>;
  /** Numeric field sums across all entity bodies (amount, balance, etc.) */
  numerics: Record<string, { sum: number; min: number; max: number; avg: number }>;
}

interface CrossSurfaceStat {
  dbCount: number;
  apiCount: number;
  drift: number;
  /** "matches" if drift === 0, otherwise "differs" — for narrative use. */
  match: string;
}

// Today's date in ms — derived from CURRENT_DATE_ISO env or now()
function nowMs(): number {
  const iso = process.env.CURRENT_DATE_ISO;
  return iso ? new Date(iso).getTime() : Date.now();
}

const CATEGORICAL_COLUMNS = new Set([
  'status', 'plan', 'tier', 'type', 'role', 'billing_platform',
  'platform', 'provider', 'source_platform', 'payment_provider',
  'currency', 'interval', 'state', 'category', 'severity',
  'flag_type', 'failure_reason', 'cancellation_reason',
]);

const NUMERIC_COLUMN_PATTERNS = [
  'amount', 'price', 'total', 'balance', 'mrr', 'revenue', 'cost',
  'quantity', 'count', 'rate',
];

const NUMERIC_API_FIELDS = [
  'amount', 'amount_due', 'amount_paid', 'amount_refunded', 'amount_remaining',
  'balance', 'total', 'subtotal', 'unit_amount', 'unit_amount_decimal',
];

const AGE_BUCKET_KEYS = ['last_7_days', '7_to_30_days', '30_to_90_days', 'over_90_days', 'null'] as const;

function ageBucket(diffMs: number): typeof AGE_BUCKET_KEYS[number] {
  const days = diffMs / (24 * 3600 * 1000);
  if (days < 7) return 'last_7_days';
  if (days < 30) return '7_to_30_days';
  if (days < 90) return '30_to_90_days';
  return 'over_90_days';
}

// ---------------------------------------------------------------------------
// Stats builder
// ---------------------------------------------------------------------------

export function buildDataStats(expanded: ExpandedData): DataStats {
  const tables: Record<string, TableStats> = {};
  const apis: Record<string, Record<string, ResourceStats>> = {};
  const crossSurface: Record<string, CrossSurfaceStat> = {};

  for (const [tableName, rows] of Object.entries(expanded.tables)) {
    if (rows.length === 0) continue;
    tables[tableName] = buildTableStats(rows);
  }

  for (const [adapterId, responseSet] of Object.entries(expanded.apiResponses)) {
    apis[adapterId] = {};
    for (const [resource, responses] of Object.entries(responseSet.responses)) {
      if (responses.length === 0) continue;
      const bodies = responses.map(r => r.body as Record<string, unknown>);
      apis[adapterId][resource] = buildResourceStats(bodies);
    }
  }

  // Cross-surface drift: pair each API resource with its likely DB table by
  // simple naming heuristic (resource name ↔ table singular/plural). Code does
  // the math; LLM only references the result.
  for (const [adapterId, resources] of Object.entries(apis)) {
    for (const [resource, rs] of Object.entries(resources)) {
      const candidate = matchTableForResource(resource, Object.keys(tables));
      if (!candidate) continue;
      const dbCount = tables[candidate]!.rowCount;
      const apiCount = rs.count;
      crossSurface[`${adapterId}.${resource}_vs_${candidate}`] = {
        dbCount,
        apiCount,
        drift: apiCount - dbCount,
        match: apiCount === dbCount ? 'matches' : 'differs',
      };
    }
  }

  return { tables, apis, crossSurface };
}

function matchTableForResource(resource: string, tables: string[]): string | null {
  // exact, plural, or "resource_X" → table
  const candidates = [resource, `${resource}s`, resource.endsWith('y') ? `${resource.slice(0, -1)}ies` : null]
    .filter((s): s is string => s !== null);
  for (const c of candidates) {
    if (tables.includes(c)) return c;
  }
  return null;
}

function buildTableStats(rows: Row[]): TableStats {
  const distributions: Record<string, Record<string, number>> = {};
  const percentages: Record<string, Record<string, number>> = {};
  const numerics: Record<string, { min: number; max: number; sum: number; avg: number }> = {};
  const dateBuckets: Record<string, Record<string, number>> = {};

  const sampleRow = rows[0]!;
  const columns = Object.keys(sampleRow);

  for (const col of columns) {
    if (CATEGORICAL_COLUMNS.has(col)) {
      const dist: Record<string, number> = {};
      for (const row of rows) {
        const val = String(row[col] ?? 'null');
        dist[val] = (dist[val] ?? 0) + 1;
      }
      distributions[col] = dist;
      const total = rows.length;
      const pct: Record<string, number> = {};
      for (const [v, c] of Object.entries(dist)) {
        pct[v] = Math.round((c / total) * 10000) / 100;
      }
      percentages[col] = pct;
      continue;
    }

    if (NUMERIC_COLUMN_PATTERNS.some(p => col.includes(p))) {
      let min = Infinity, max = -Infinity, sum = 0, count = 0;
      for (const row of rows) {
        const val = Number(row[col]);
        if (!Number.isNaN(val)) {
          min = Math.min(min, val);
          max = Math.max(max, val);
          sum += val;
          count++;
        }
      }
      if (count > 0) {
        numerics[col] = { min, max, sum, avg: Math.round((sum / count) * 100) / 100 };
      }
    }
  }

  const dateColumns = columns.filter(c =>
    c.includes('_at') || c.includes('_date') || c.includes('login'),
  );
  const now = nowMs();
  for (const col of dateColumns) {
    if (distributions[col] || numerics[col]) continue;
    const buckets: Record<string, number> = {};
    for (const k of AGE_BUCKET_KEYS) buckets[k] = 0;
    let any = false;
    for (const row of rows) {
      const val = row[col];
      if (val == null) { buckets.null!++; any = true; continue; }
      const t = new Date(val as string).getTime();
      if (Number.isNaN(t)) continue;
      buckets[ageBucket(now - t)]!++;
      any = true;
    }
    if (any) dateBuckets[col] = buckets;
  }

  return { rowCount: rows.length, distributions, percentages, numerics, dateBuckets };
}

function buildResourceStats(bodies: Record<string, unknown>[]): ResourceStats {
  const statusDistribution: Record<string, number> = {};
  for (const body of bodies) {
    const s = body.status;
    if (typeof s === 'string') {
      statusDistribution[s] = (statusDistribution[s] ?? 0) + 1;
    }
  }
  const statusPercentages: Record<string, number> = {};
  for (const [k, v] of Object.entries(statusDistribution)) {
    statusPercentages[k] = Math.round((v / bodies.length) * 10000) / 100;
  }

  const numerics: ResourceStats['numerics'] = {};
  for (const field of NUMERIC_API_FIELDS) {
    let sum = 0, min = Infinity, max = -Infinity, count = 0;
    for (const body of bodies) {
      const v = Number(body[field]);
      if (!Number.isNaN(v) && Number.isFinite(v)) {
        sum += v; min = Math.min(min, v); max = Math.max(max, v); count++;
      }
    }
    if (count > 0) {
      numerics[field] = { sum, min, max, avg: Math.round((sum / count) * 100) / 100 };
    }
  }

  return { count: bodies.length, statusDistribution, statusPercentages, numerics };
}

// ---------------------------------------------------------------------------
// Flatten DataStats → { path: value } for path-ref resolution and prompt
// rendering. Paths use dot-notation; categorical values are URI-encoded in
// case they contain dots themselves.
// ---------------------------------------------------------------------------

export function flattenStats(stats: DataStats): Record<string, number | string> {
  const flat: Record<string, number | string> = {};

  for (const [tname, ts] of Object.entries(stats.tables)) {
    flat[`tables.${tname}.rowCount`] = ts.rowCount;
    for (const [col, dist] of Object.entries(ts.distributions)) {
      for (const [val, n] of Object.entries(dist)) {
        flat[`tables.${tname}.distributions.${col}.${safeKey(val)}`] = n;
      }
    }
    for (const [col, pct] of Object.entries(ts.percentages)) {
      for (const [val, p] of Object.entries(pct)) {
        flat[`tables.${tname}.percentages.${col}.${safeKey(val)}`] = p;
      }
    }
    for (const [col, n] of Object.entries(ts.numerics)) {
      flat[`tables.${tname}.numerics.${col}.min`] = n.min;
      flat[`tables.${tname}.numerics.${col}.max`] = n.max;
      flat[`tables.${tname}.numerics.${col}.sum`] = n.sum;
      flat[`tables.${tname}.numerics.${col}.avg`] = n.avg;
    }
    for (const [col, buckets] of Object.entries(ts.dateBuckets)) {
      for (const [bucket, n] of Object.entries(buckets)) {
        flat[`tables.${tname}.dateBuckets.${col}.${bucket}`] = n;
      }
    }
  }

  for (const [adapter, resources] of Object.entries(stats.apis)) {
    for (const [resource, rs] of Object.entries(resources)) {
      flat[`apis.${adapter}.${resource}.count`] = rs.count;
      for (const [status, n] of Object.entries(rs.statusDistribution)) {
        flat[`apis.${adapter}.${resource}.status.${safeKey(status)}`] = n;
      }
      for (const [status, p] of Object.entries(rs.statusPercentages)) {
        flat[`apis.${adapter}.${resource}.statusPct.${safeKey(status)}`] = p;
      }
      for (const [field, n] of Object.entries(rs.numerics)) {
        flat[`apis.${adapter}.${resource}.numerics.${field}.sum`] = n.sum;
        flat[`apis.${adapter}.${resource}.numerics.${field}.min`] = n.min;
        flat[`apis.${adapter}.${resource}.numerics.${field}.max`] = n.max;
        flat[`apis.${adapter}.${resource}.numerics.${field}.avg`] = n.avg;
      }
    }
  }

  for (const [pair, cs] of Object.entries(stats.crossSurface)) {
    flat[`crossSurface.${pair}.dbCount`] = cs.dbCount;
    flat[`crossSurface.${pair}.apiCount`] = cs.apiCount;
    flat[`crossSurface.${pair}.drift`] = cs.drift;
    flat[`crossSurface.${pair}.match`] = cs.match;
  }

  return flat;
}

function safeKey(s: string): string {
  // Replace dots and whitespace so the path remains parseable
  return s.replace(/\./g, '_').replace(/\s+/g, '_');
}

// ---------------------------------------------------------------------------
// LLM output schema — fact TEMPLATES with placeholder refs, no raw numbers
// ---------------------------------------------------------------------------

const FactTemplateSchema = z.object({
  facts: z.array(z.object({
    id: z.string().describe('Unique fact ID, e.g. "fact_001"'),
    type: z.enum([
      'anomaly', 'overdue', 'pending', 'integrity', 'growth', 'risk',
      'dispute', 'churn', 'fraud', 'compliance', 'refund', 'upgrade',
      'downgrade', 'payment', 'cancellation',
    ]),
    platform: z.string().describe('Source platform name or "database"'),
    severity: z.enum(['info', 'warn', 'critical']),
    detail_template: z.string().describe(
      'Human-readable prose with {placeholder} substitutions. Every numeric value MUST be inside {placeholder}; bare digits are forbidden.',
    ),
    data_refs: z.record(z.string()).describe(
      'Map from placeholder name (used in detail_template) to a stat path (e.g. "tables.customers.distributions.plan.pro"). Every placeholder in detail_template must have a corresponding data_refs entry.',
    ),
  })),
});

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const FACT_GENERATION_SYSTEM = `You are a data analyst examining a synthetic dataset generated for testing AI agents.

Your job: produce **testable facts** that describe what actually exists in the data. Each fact has a developer-readable narrative AND a machine-readable data block — both must be grounded in real stat values.

## Architectural contract — NUMBERS ONLY COME FROM STATS

You MUST NOT type any digit in detail_template directly. Every number — every count, sum, percentage, drift, threshold, age — must appear as a {placeholder} whose value is resolved by code from a stat path you cite in data_refs.

For example:
  CORRECT:
    detail_template: "Postgres customers split across plans: {pro} on Pro, {starter} on Starter, {enterprise} on Enterprise — out of {total} total."
    data_refs: {
      pro:         "tables.customers.distributions.plan.pro",
      starter:     "tables.customers.distributions.plan.starter",
      enterprise:  "tables.customers.distributions.plan.enterprise",
      total:       "tables.customers.rowCount"
    }

  REJECTED (bare numeral "100" in template):
    detail_template: "100 customers across plans: {pro} Pro, {starter} Starter, ..."

  REJECTED (fuzzy quantifier):
    detail_template: "Approximately {pro} customers on Pro..."

  REJECTED (placeholder with no data_refs entry):
    detail_template: "{pro} Pro, {starter} Starter, {missing} Other"
    data_refs: { pro: "...", starter: "..." }   // no "missing" key

Comparative claims ("matches", "differs", "drifts", "equals") MUST use a crossSurface match path — do not assert equality from intuition.

## Rules
1. Cite only paths that appear in the provided stat table. Paths not in the table will fail resolution and the fact will be dropped.
2. Every numeric in detail_template must be a placeholder — bare digits / percent values / dollar amounts are forbidden.
3. Quantifier words like "approximately", "roughly", "about N", "around N", "~N", "≈N" are forbidden — be precise via placeholders.
4. Each fact should be useful for testing an agent (count, distribution, anomaly, drift, totals).
5. Mix severities:
   - info — basic counts/distributions the agent should recognize
   - warn — patterns that require reasoning (drifts, overdue, churn rates)
   - critical — edge cases the agent must not hallucinate (zero of X, single refund, etc.)
6. Cover both the database and every API platform. Include cross-surface facts using crossSurface.* paths.
7. Quality over quantity: 10–20 facts. Each fact must add unique value.
8. Narrative voice is yours — write developer-facing prose around the placeholders. The placeholders are bookmarks, not the whole sentence.

## Fact types to consider
overdue, churn, risk, integrity, growth, dispute, pending, anomaly, payment, refund, upgrade, downgrade, cancellation, compliance, fraud`;

// ---------------------------------------------------------------------------
// Template policing — reject hallucinations before they ship
// ---------------------------------------------------------------------------

const FORBIDDEN_QUALIFIERS = [
  /\bapprox(?:imately)?\b/i,
  /\broughly\b/i,
  /\bnearly\b/i,
  /\baround\s+\d/i,
  /\babout\s+\d/i,
  /~\s*\d/,
  /≈\s*\d/,
];

const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

// Bare-numeral allowances. These describe contexts where a literal small
// integer is a stable narrative reference (a time window, ISO date, named
// entity id) rather than a data assertion. The audit pass strips these
// before scanning for bare digits, so a template like "in the last 7 days"
// passes while "100 customers" is still flagged.
//
// Each entry is applied via String.prototype.replace, so order doesn't
// matter — but more specific patterns should come first to avoid leaking.
const NARRATIVE_NUMERAL_ALLOWANCES: RegExp[] = [
  // ISO dates and date-like fragments: "2026-04-29", "2026-04-29T14:22:00Z"
  /\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?/g,
  // Persona-stable id tokens like "cus_p1_038", "pi_p1_223", "sub_p1_103".
  // `<prefix>_p<persona>_<seq>` is mimic's namespacing convention; allow it
  // so facts can mention specific IDs verbatim.
  /\b[a-z]+(?:_[a-z]+)*_p\d+(?:_[a-z0-9]+)+\b/gi,
  // Time-window references with any common separator combination between
  // the digit(s) and the time unit:
  //   "7 days", "12 weeks", "6 months", "2 years"
  //   "7-30 days", "7–30 days", "7—30 days" (hyphen / en / em)
  //   "7 to 30 days", "7-to-30 days", "7-to-30-day", "7_to_30_days"
  //   "last_7_days", "30_to_90_days", "over_90_days"
  // The character class between the leading digit and the trailing time
  // unit accepts space/underscore/hyphen and the literal token "to" in
  // either word or punctuated form, so the LLM can use whichever style
  // matches the surrounding narrative.
  /\b\d+(?:[\s\-–—_]+(?:to[\s\-_]+)?\d+)?[\s\-_]*(?:days?|weeks?|months?|years?|hours?|minutes?|seconds?)\b/gi,
];

interface TemplateAudit {
  ok: boolean;
  reasons: string[];
}

function auditTemplate(template: string, data_refs: Record<string, string>): TemplateAudit {
  const reasons: string[] = [];

  // 1. No bare numerals outside placeholders. Strip placeholders first so
  // their numeric values don't trip the audit, then strip the narrative
  // allowance patterns above (time windows, ISO dates, persona-stable ids).
  // Anything that's still a bare digit at this point is a data assertion
  // the LLM should have placed inside a {placeholder}.
  let stripped = template.replace(PLACEHOLDER_RE, '');
  for (const re of NARRATIVE_NUMERAL_ALLOWANCES) {
    stripped = stripped.replace(re, '');
  }
  const bareNumeral = stripped.match(/\d/);
  if (bareNumeral) {
    reasons.push(`bare numeral "${bareNumeral[0]}" outside placeholder — context: "${stripped.slice(Math.max(0, bareNumeral.index! - 30), bareNumeral.index! + 30)}"`);
  }

  // 2. No fuzzy quantifiers
  for (const re of FORBIDDEN_QUALIFIERS) {
    const m = template.match(re);
    if (m) reasons.push(`forbidden quantifier "${m[0]}"`);
  }

  // 3. Every placeholder must have a data_refs entry
  const placeholders = [...template.matchAll(PLACEHOLDER_RE)].map(m => m[1]!);
  for (const p of placeholders) {
    if (!(p in data_refs)) reasons.push(`placeholder {${p}} has no data_refs entry`);
  }

  // 4. Every data_refs entry must be cited by some placeholder (no dangling)
  const placeholderSet = new Set(placeholders);
  for (const k of Object.keys(data_refs)) {
    if (!placeholderSet.has(k)) reasons.push(`data_refs.${k} not used in detail_template`);
  }

  return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Resolve refs → numbers, substitute → final fact
// ---------------------------------------------------------------------------

interface ResolveResult {
  ok: boolean;
  data: Record<string, number | string>;
  detail: string;
  reasons: string[];
}

function resolveFact(
  template: string,
  data_refs: Record<string, string>,
  flat: Record<string, number | string>,
): ResolveResult {
  const data: Record<string, number | string> = {};
  const reasons: string[] = [];

  for (const [key, path] of Object.entries(data_refs)) {
    if (!(path in flat)) {
      reasons.push(`path "${path}" (for {${key}}) not found in stats`);
      continue;
    }
    data[key] = flat[path]!;
  }
  if (reasons.length > 0) return { ok: false, data, detail: '', reasons };

  // Substitute placeholders → values. Numbers stringify naturally;
  // string values (match/differs) pass through.
  const detail = template.replace(PLACEHOLDER_RE, (_, key) => String(data[key] ?? `{${key}}`));
  return { ok: true, data, detail, reasons };
}

// ---------------------------------------------------------------------------
// Public entry: generateFacts
// ---------------------------------------------------------------------------

export async function generateFacts(
  llmClient: LLMClient,
  expanded: ExpandedData,
  persona: { name: string; description: string },
  domain: string,
): Promise<Fact[]> {
  const stats = buildDataStats(expanded);
  const flat = flattenStats(stats);

  // Render the flat stats as path = value lines for the LLM prompt
  const statLines = Object.entries(flat)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, val]) => `  ${path} = ${val}`)
    .join('\n');

  const userPrompt = [
    `Domain: ${domain}`,
    `Persona: "${persona.name}"`,
    persona.description,
    '',
    '## Available stat paths (cite ONLY these in data_refs)',
    '',
    statLines,
    '',
    'Generate 10–20 facts. Use placeholders for every number. Cover both the database and each API platform, including cross-surface drifts.',
  ].join('\n');

  let templates: z.infer<typeof FactTemplateSchema>['facts'];
  try {
    logger.step('Generating facts from expanded data...');
    const result = await llmClient.generateObject({
      schema: FactTemplateSchema,
      schemaName: 'FactTemplates',
      schemaDescription: 'Fact templates with placeholder refs to stat paths — code resolves placeholders into numbers.',
      system: FACT_GENERATION_SYSTEM,
      prompt: userPrompt,
      label: `facts:${persona.name}`,
      category: 'generation',
      temperature: 0.3,
    });
    templates = result.object.facts;
  } catch (error) {
    logger.warn(
      `Fact generation LLM call failed: ${error instanceof Error ? error.message : String(error)}. ` +
      `Falling back to blueprint facts.`,
    );
    return expanded.facts;
  }

  // Audit + resolve every template. A fact is included only if:
  //   - its template has no bare numerals, no fuzzy quantifiers, no dangling refs
  //   - every data_refs path resolves against the computed stats
  const accepted: Fact[] = [];
  const rejected: { id: string; reasons: string[] }[] = [];

  for (const t of templates) {
    const audit = auditTemplate(t.detail_template, t.data_refs);
    if (!audit.ok) {
      rejected.push({ id: t.id, reasons: audit.reasons });
      continue;
    }
    const resolved = resolveFact(t.detail_template, t.data_refs, flat);
    if (!resolved.ok) {
      rejected.push({ id: t.id, reasons: resolved.reasons });
      continue;
    }
    accepted.push({
      id: t.id,
      type: t.type,
      platform: t.platform,
      severity: t.severity,
      detail: resolved.detail,
      data: resolved.data,
    });
  }

  debugFile(`FACT GENERATION AUDIT [${persona.name}]`, {
    requested: templates.length,
    accepted: accepted.length,
    rejected,
  });

  if (rejected.length > 0) {
    logger.warn(
      `Rejected ${rejected.length}/${templates.length} fact(s) for unverifiable content: ` +
      rejected.map(r => `${r.id} (${r.reasons[0]})`).join('; '),
    );
  }
  logger.success(`Generated ${accepted.length} verified facts from actual data`);
  return accepted;
}
