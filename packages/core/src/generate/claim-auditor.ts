import type {
  Claim,
  ClaimEvaluation,
  AuditResult,
  ResourceTarget,
  Filter,
  FilterOp,
} from '../types/claim.js';
import type { ExpandedData, Row } from '../types/dataset.js';
import type { Blueprint } from '../types/blueprint.js';

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Evaluate every claim in the blueprint against the expanded data. Returns
 * a full audit report with per-claim outcomes plus a `failures` shortcut.
 *
 * The caller decides what to do with failures — the audit-and-repair loop
 * uses them to drive the repair LLM; a final-attempt failure raises
 * BlueprintGenerationError.
 */
export function auditClaims(
  blueprint: Blueprint,
  expanded: ExpandedData,
): AuditResult {
  const claims = blueprint.data.claims ?? [];
  const evaluations: ClaimEvaluation[] = claims.map((claim) =>
    evaluateClaim(claim, blueprint, expanded),
  );
  return {
    evaluations,
    failures: evaluations.filter((e) => !e.passed),
  };
}

// ---------------------------------------------------------------------------
// Per-claim evaluation
// ---------------------------------------------------------------------------

function evaluateClaim(
  claim: Claim,
  blueprint: Blueprint,
  expanded: ExpandedData,
): ClaimEvaluation {
  const rows = selectRows(claim.target, expanded);
  const citedBy = collectCitations(claim.id, blueprint);

  switch (claim.kind) {
    case 'row_count': {
      const actual = rows.length;
      const passed = withinTolerance(actual, claim.expected, claim.tolerance);
      return {
        claim,
        passed,
        predicate: `count(${describeTarget(claim.target)}) = ${claim.expected}${claim.tolerance ? ` (±${claim.tolerance})` : ''}`,
        actual,
        sampleRows: rows.slice(0, 5),
        citedBy,
      };
    }
    case 'aggregate_sum': {
      const sum = rows.reduce((acc, r) => acc + toNumber(r[claim.field]), 0);
      const passed = withinTolerance(sum, claim.expected, claim.tolerance);
      return {
        claim,
        passed,
        predicate: `sum(${describeTarget(claim.target)}.${claim.field}) = ${claim.expected}${claim.tolerance ? ` (±${claim.tolerance})` : ''}`,
        actual: sum,
        sampleRows: rows.slice(0, 5),
        citedBy,
      };
    }
    case 'aggregate_avg': {
      const sum = rows.reduce((acc, r) => acc + toNumber(r[claim.field]), 0);
      const avg = rows.length === 0 ? 0 : sum / rows.length;
      const passed = withinTolerance(avg, claim.expected, claim.tolerance);
      return {
        claim,
        passed,
        predicate: `avg(${describeTarget(claim.target)}.${claim.field}) = ${claim.expected}${claim.tolerance ? ` (±${claim.tolerance})` : ''}`,
        actual: avg,
        sampleRows: rows.slice(0, 5),
        citedBy,
      };
    }
    case 'pinned_field': {
      const expected = claim.expected;
      if (claim.perRow) {
        const bad = rows.filter((r) => !valueEquals(r[claim.field], expected));
        const passed = bad.length === 0 && rows.length > 0;
        return {
          claim,
          passed,
          predicate: `every row in ${describeTarget(claim.target)} has ${claim.field} = ${JSON.stringify(expected)}`,
          actual: passed
            ? `${rows.length}/${rows.length} rows match`
            : `${rows.length - bad.length}/${rows.length} rows match`,
          sampleRows: bad.slice(0, 5),
          citedBy,
        };
      } else {
        const hit = rows.some((r) => valueEquals(r[claim.field], expected));
        return {
          claim,
          passed: hit,
          predicate: `at least one row in ${describeTarget(claim.target)} has ${claim.field} = ${JSON.stringify(expected)}`,
          actual: hit ? 'present' : 'absent',
          sampleRows: rows.slice(0, 5),
          citedBy,
        };
      }
    }
    case 'distribution_pct': {
      const total = rows.length;
      const counts: Record<string, number> = {};
      for (const r of rows) {
        const v = String(r[claim.field] ?? '');
        counts[v] = (counts[v] ?? 0) + 1;
      }
      const actualPct: Record<string, number> = {};
      for (const [k, c] of Object.entries(counts)) {
        actualPct[k] = total === 0 ? 0 : (c / total) * 100;
      }
      const tolerance = claim.tolerance ?? 2; // 2pp default
      const misses: string[] = [];
      for (const [k, expectedPct] of Object.entries(claim.values)) {
        const actual = actualPct[k] ?? 0;
        if (Math.abs(actual - expectedPct) > tolerance) {
          misses.push(`${k}: expected ${expectedPct}%, got ${actual.toFixed(1)}%`);
        }
      }
      return {
        claim,
        passed: misses.length === 0,
        predicate: `distribution of ${describeTarget(claim.target)}.${claim.field} matches ${JSON.stringify(claim.values)} (±${tolerance}pp)`,
        actual: actualPct,
        sampleRows: misses.length > 0 ? rows.slice(0, 5) : undefined,
        citedBy,
      };
    }
    case 'date_window': {
      const min = parseDateBound(claim.min);
      const max = parseDateBound(claim.max);
      const inWindow = rows.filter((r) => {
        const ts = toMillis(r[claim.field]);
        return ts != null && ts >= min && ts <= max;
      });
      const passed = withinTolerance(inWindow.length, claim.expected, claim.tolerance);
      return {
        claim,
        passed,
        predicate: `count(${describeTarget(claim.target)} where ${claim.field} ∈ [${claim.min}, ${claim.max}]) = ${claim.expected}${claim.tolerance ? ` (±${claim.tolerance})` : ''}`,
        actual: inWindow.length,
        sampleRows: inWindow.slice(0, 5),
        citedBy,
      };
    }
    case 'orphans_exactly': {
      const apiIds = collectApiIds(claim.target, expanded);
      const dbIds = collectDbIdentityIds(expanded);
      const orphans = [...apiIds].filter((id) => !dbIds.has(id));
      const passed = orphans.length === claim.expected;
      return {
        claim,
        passed,
        predicate: `count(${describeTarget(claim.target)} with no DB identity row) = ${claim.expected}`,
        actual: orphans.length,
        sampleRows: orphans.slice(0, 5),
        citedBy,
      };
    }
    case 'no_row_with': {
      const passed = rows.length === 0;
      return {
        claim,
        passed,
        predicate: `count(${describeTarget(claim.target)}) = 0`,
        actual: rows.length,
        sampleRows: rows.slice(0, 5),
        citedBy,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Row selection — target + filter → row[]
// ---------------------------------------------------------------------------

function selectRows(target: ResourceTarget, expanded: ExpandedData): Row[] {
  const all = resolveRows(target, expanded);
  if (!target.filter) return all;
  return all.filter((row) => filterMatches(row, target.filter!));
}

function resolveRows(target: ResourceTarget, expanded: ExpandedData): Row[] {
  if (target.surface === 'db') {
    return (expanded.tables[target.name] ?? []) as Row[];
  }
  // api: "<adapter>.<resource>"
  const dot = target.name.indexOf('.');
  if (dot < 0) return [];
  const adapter = target.name.slice(0, dot);
  const resource = target.name.slice(dot + 1);
  const responses = expanded.apiResponses[adapter]?.responses[resource] ?? [];
  return responses
    .map((r) => r.body)
    .filter(
      (b): b is Record<string, unknown> => b !== null && typeof b === 'object' && !Array.isArray(b),
    ) as Row[];
}

function filterMatches(row: Row, filter: Filter): boolean {
  for (const [field, predicate] of Object.entries(filter)) {
    if (!matchesPredicate(getNested(row, field), predicate)) return false;
  }
  return true;
}

function matchesPredicate(value: unknown, predicate: unknown): boolean {
  // Bare value → equality
  if (predicate === null || typeof predicate !== 'object' || Array.isArray(predicate)) {
    return valueEquals(value, predicate);
  }
  const op = predicate as FilterOp;
  if ('eq' in op) return valueEquals(value, op.eq);
  if ('neq' in op) return !valueEquals(value, op.neq);
  if ('in' in op) return op.in.some((v) => valueEquals(value, v));
  if ('nin' in op) return !op.nin.some((v) => valueEquals(value, v));
  if ('gte' in op) return compareScalar(value, op.gte) >= 0;
  if ('lte' in op) return compareScalar(value, op.lte) <= 0;
  if ('gt' in op) return compareScalar(value, op.gt) > 0;
  if ('lt' in op) return compareScalar(value, op.lt) < 0;
  if ('is_null' in op) {
    const isNull = value === null || value === undefined || value === '';
    return isNull === op.is_null;
  }
  if ('age_days_gte' in op) {
    const ms = toMillis(value);
    if (ms == null) return false;
    return ageDays(ms) >= op.age_days_gte;
  }
  if ('age_days_lte' in op) {
    const ms = toMillis(value);
    if (ms == null) return false;
    return ageDays(ms) <= op.age_days_lte;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function valueEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  // Loose numeric/string equality for amounts that arrive as strings
  if (typeof a === 'number' && typeof b === 'string') return a === Number(b);
  if (typeof a === 'string' && typeof b === 'number') return Number(a) === b;
  return false;
}

function compareScalar(a: unknown, b: number | string): number {
  if (typeof b === 'number') {
    const an = toNumber(a);
    return an - b;
  }
  // string comparison — try date first, else lexicographic
  const ams = toMillis(a);
  const bms = toMillis(b);
  if (ams != null && bms != null) return ams - bms;
  return String(a).localeCompare(String(b));
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

function toMillis(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') {
    // unix seconds vs ms heuristic
    return v < 1e12 ? v * 1000 : v;
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    const t = d.getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function parseDateBound(s: string): number {
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function ageDays(ms: number): number {
  return (Date.now() - ms) / (24 * 3600 * 1000);
}

/** Get a nested field with `a.b.c` dotted paths */
function getNested(obj: Record<string, unknown>, path: string): unknown {
  if (!path.includes('.')) return obj[path];
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function describeTarget(target: ResourceTarget): string {
  const filter = target.filter ? ` where ${describeFilter(target.filter)}` : '';
  return `${target.surface}.${target.name}${filter}`;
}

function describeFilter(filter: Filter): string {
  return Object.entries(filter)
    .map(([k, v]) => `${k}=${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`)
    .join(' AND ');
}

function withinTolerance(actual: number, expected: number, tolerance: number | undefined): boolean {
  if (!tolerance) return actual === expected;
  return Math.abs(actual - expected) <= tolerance;
}

// ---------------------------------------------------------------------------
// Orphan detection — API ids missing from DB identity rows
// ---------------------------------------------------------------------------

function collectApiIds(target: ResourceTarget, expanded: ExpandedData): Set<string> {
  const rows = resolveRows(target, expanded);
  const ids = new Set<string>();
  for (const row of rows) {
    const id = row.id;
    if (typeof id === 'string' && id.length > 0) ids.add(id);
  }
  return ids;
}

/**
 * Walk every DB table and collect string values from any column that looks
 * like an external/identity id. We don't have the schema mapping at audit
 * time, so we use a heuristic — columns named `external_id`, `*_customer_id`,
 * `*_subscription_id`, `*_invoice_id`, `*_id` where the value matches a
 * common id prefix pattern.
 */
function collectDbIdentityIds(expanded: ExpandedData): Set<string> {
  const ids = new Set<string>();
  for (const rows of Object.values(expanded.tables)) {
    for (const row of rows as Row[]) {
      for (const [col, val] of Object.entries(row)) {
        if (typeof val !== 'string' || val.length === 0) continue;
        if (
          col === 'external_id' ||
          col.endsWith('_id') ||
          col.endsWith('_external_id')
        ) {
          ids.add(val);
        }
      }
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Citation collector — which archetype labels declared `cites: [claimId]`
// ---------------------------------------------------------------------------

function collectCitations(claimId: string, blueprint: Blueprint): string[] {
  const hits: string[] = [];
  for (const [table, config] of Object.entries(blueprint.data.entityArchetypes ?? {})) {
    for (const a of config.archetypes) {
      if (a.cites?.includes(claimId)) hits.push(`db.${table}[${a.label}]`);
    }
  }
  for (const [adapter, resources] of Object.entries(blueprint.data.apiEntityArchetypes ?? {})) {
    for (const [resource, config] of Object.entries(resources)) {
      for (const a of config.archetypes) {
        if (a.cites?.includes(claimId)) hits.push(`api.${adapter}.${resource}[${a.label}]`);
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Pretty formatter for failed claims — used by the error wrapper
// ---------------------------------------------------------------------------

export function formatAuditFailures(result: AuditResult): string {
  if (result.failures.length === 0) return '';
  const lines: string[] = [];
  lines.push(`Claim audit: ${result.failures.length} of ${result.evaluations.length} claims failed.`);
  for (const f of result.failures) {
    lines.push('');
    lines.push(`  FAIL ${f.claim.id}: "${f.claim.quote}"`);
    lines.push(`    predicate: ${f.predicate}`);
    lines.push(`    actual:    ${typeof f.actual === 'object' ? JSON.stringify(f.actual) : String(f.actual)}`);
    if (f.citedBy && f.citedBy.length > 0) {
      lines.push(`    cited by:  ${f.citedBy.join(', ')}`);
    } else {
      lines.push(`    cited by:  (no archetype cited this claim)`);
    }
  }
  return lines.join('\n');
}
