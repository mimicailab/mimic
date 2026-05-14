/**
 * Claim sanitiser — drops or demotes malformed claims that would otherwise
 * become load-bearing predicates downstream.
 *
 * Failure mode it addresses: the claim extractor produces shapes the LLM
 * thinks are reasonable but which can never pass. Examples observed on
 * cfo-agent-skills:
 *
 *   - `aggregate_avg expected = 8.2` for "8.2% MoM growth" — 8.2 is a
 *     percentage, not a value to average. The auditor will compare avg-of-rows
 *     to 8.2 and always fail.
 *   - `date_window expected = 6` for "6 months of billing history" — 6 is
 *     the duration, not a row count.
 *   - `row_count` on a DB table whose claims also include a `distribution_pct`
 *     over the same column — the row_count is redundant and inconsistent.
 *
 * Pure function — no LLM, no I/O. Run between extraction and bridge rewrite.
 */

import type { Claim, Filter } from '../types/claim.js';
import type { AdapterResourceSpecs, SchemaModel } from '../types/index.js';
import { logger } from '../utils/logger.js';

export interface SanitiseResult {
  claims: Claim[];
  /** Per-claim sanitiser decisions, for telemetry */
  decisions: SanitiseDecision[];
}

export interface SanitiseDecision {
  claimId: string;
  action: 'kept' | 'dropped' | 'demoted';
  reason: string;
}

export interface SanitiseOptions {
  /** Database schema — used to validate db.<table> filter/field keys */
  schema?: SchemaModel;
  /** Adapter resource specs — used to validate api.<adapter>.<resource> filter/field keys */
  resourceSpecs?: Record<string, AdapterResourceSpecs>;
}

export function sanitiseClaims(
  input: ReadonlyArray<Claim>,
  options: SanitiseOptions = {},
): SanitiseResult {
  const decisions: SanitiseDecision[] = [];
  const out: Claim[] = [];

  // Build the field-existence index up front (cheap; bounded by adapter+table count).
  const fieldIndex = buildFieldIndex(options);

  // Pass 0: normalize target names and reject targets that can never resolve
  // when schema/spec data is available. This prevents malformed targets like
  // `surface:"api", name:"api.stripe.subscription"` from surviving into
  // audit as unsatisfiable predicates.
  const normalisedClaims: Claim[] = [];
  for (const claim of input) {
    const targetVerdict = normaliseAndValidateTarget(claim, fieldIndex, options);
    if (targetVerdict.decision) decisions.push(targetVerdict.decision);
    if (targetVerdict.action === 'dropped') continue;

    const aliasVerdict = normaliseApiFieldAliases(targetVerdict.claim);
    if (aliasVerdict.decision) decisions.push(aliasVerdict.decision);
    normalisedClaims.push(aliasVerdict.claim);
  }

  // First pass: detect targets with a distribution_pct claim so we can demote
  // sibling row_count claims that target the same field.
  const distributionTargets = new Set<string>();
  for (const c of normalisedClaims) {
    if (c.kind === 'distribution_pct') {
      distributionTargets.add(`${c.target.surface}:${c.target.name}:${c.field}`);
    }
  }

  for (const claim of normalisedClaims) {
    // V3 Layer 1 — field grounding. Reject claims whose filter keys or
    // field/aggregate references target fields that don't exist on the
    // resource. Predicates against missing fields are unsatisfiable by
    // definition (auditor returns 0 / null) and become permanent noise.
    const groundingVerdict = checkFieldGrounding(claim, fieldIndex);
    if (groundingVerdict) {
      decisions.push({
        claimId: claim.id,
        action: groundingVerdict.action,
        reason: groundingVerdict.reason,
      });
      if (groundingVerdict.action === 'dropped') continue;
    }

    const verdict = inspectClaim(claim, distributionTargets);
    decisions.push({ claimId: claim.id, action: verdict.action, reason: verdict.reason });
    if (verdict.action === 'dropped') continue;
    if (verdict.action === 'demoted' && verdict.replacement) {
      out.push(verdict.replacement);
    } else {
      out.push(claim);
    }
  }

  const dropped = decisions.filter((d) => d.action === 'dropped').length;
  const demoted = decisions.filter((d) => d.action === 'demoted').length;
  if (dropped + demoted > 0) {
    logger.info(
      `Claim sanitiser: kept ${decisions.length - dropped - demoted}, demoted ${demoted}, dropped ${dropped}.`,
    );
    for (const d of decisions) {
      if (d.action !== 'kept') {
        logger.debug(`  ${d.action} ${d.claimId}: ${d.reason}`);
      }
    }
  }

  return { claims: out, decisions };
}

// ---------------------------------------------------------------------------
// Field-existence checking (V3 Layer 1)
// ---------------------------------------------------------------------------

/**
 * Index of legal field paths per target. Key: `<surface>:<name>` (e.g.
 * `db:users`, `api:stripe.subscription`). Value: set of legal field paths
 * (top-level field names plus one level of dotted-object paths). When a
 * target isn't in the index, field grounding is skipped (no data to check
 * against — usually means schema/specs weren't passed in).
 */
type FieldIndex = Map<string, Set<string>>;

type TargetValidationResult =
  | { action: 'kept'; claim: Claim; decision?: SanitiseDecision }
  | { action: 'dropped'; claim: Claim; decision: SanitiseDecision };

function buildFieldIndex(options: SanitiseOptions): FieldIndex {
  const index: FieldIndex = new Map();

  if (options.schema) {
    for (const table of options.schema.tables) {
      const fields = new Set<string>();
      for (const col of table.columns) fields.add(col.name);
      index.set(`db:${table.name}`, fields);
    }
  }

  if (options.resourceSpecs) {
    for (const [adapterId, specs] of Object.entries(options.resourceSpecs)) {
      for (const [resourceName, spec] of Object.entries(specs.resources)) {
        const fields = new Set<string>();
        for (const [field, fieldSpec] of Object.entries(spec.fields)) {
          fields.add(field);
          if (fieldSpec.type === 'object' && fieldSpec.properties) {
            for (const inner of Object.keys(fieldSpec.properties)) {
              fields.add(`${field}.${inner}`);
            }
          }
        }
        // Register both spec key and a permissive plural alias — the
        // auditor accepts plural target names too.
        index.set(`api:${adapterId}.${resourceName}`, fields);
      }
    }
  }

  return index;
}

function normaliseAndValidateTarget(
  claim: Claim,
  index: FieldIndex,
  options: SanitiseOptions,
): TargetValidationResult {
  const original = claim.target.name.trim();
  let normalized = original;

  if (claim.target.surface === 'api') {
    if (normalized.startsWith('db.')) {
      return {
        action: 'dropped',
        claim,
        decision: {
          claimId: claim.id,
          action: 'dropped',
          reason:
            `target normalisation: api target name "${original}" starts with db.; ` +
            'surface already encodes the namespace, so this target can never resolve.',
        },
      };
    }
    normalized = normalized.replace(/^(?:api\.)+/, '');
  } else {
    if (normalized.startsWith('api.')) {
      return {
        action: 'dropped',
        claim,
        decision: {
          claimId: claim.id,
          action: 'dropped',
          reason:
            `target normalisation: db target name "${original}" starts with api.; ` +
            'surface already encodes the namespace, so this target can never resolve.',
        },
      };
    }
    normalized = normalized.replace(/^(?:db\.)+/, '');
  }

  let nextClaim = claim;
  let decision: SanitiseDecision | undefined;
  if (normalized !== original) {
    nextClaim = {
      ...claim,
      target: { ...claim.target, name: normalized },
    };
    decision = {
      claimId: claim.id,
      action: 'kept',
      reason: `target normalisation: rewrote ${claim.target.surface}.${original} -> ${claim.target.surface}.${normalized}`,
    };
  }

  const targetFields = resolveTargetFields(nextClaim, index);
  if (!targetFields && hasValidationDataForSurface(nextClaim, options)) {
    return {
      action: 'dropped',
      claim: nextClaim,
      decision: {
        claimId: claim.id,
        action: 'dropped',
        reason:
          `target normalisation: unknown target ${nextClaim.target.surface}.${nextClaim.target.name}. ` +
          'No schema/spec entry exists for this target, so the auditor would never resolve rows for it.',
      },
    };
  }

  return { action: 'kept', claim: nextClaim, decision };
}

function normaliseApiFieldAliases(
  claim: Claim,
): { claim: Claim; decision?: SanitiseDecision } {
  if (claim.target.surface !== 'api') return { claim };

  let nextClaim = claim;
  const rewrites: string[] = [];

  if (claim.target.filter) {
    let changed = false;
    const nextFilter: Filter = {};
    for (const [key, value] of Object.entries(claim.target.filter)) {
      const rewrittenKey = normaliseApiFieldAlias(claim.target.name, key);
      if (rewrittenKey !== key) {
        changed = true;
        rewrites.push(`filter.${key} -> ${rewrittenKey}`);
      }
      if (!(rewrittenKey in nextFilter)) {
        nextFilter[rewrittenKey] = value;
      }
    }
    if (changed) {
      nextClaim = {
        ...nextClaim,
        target: {
          ...nextClaim.target,
          filter: nextFilter,
        },
      };
    }
  }

  const fieldRef = readFieldReference(nextClaim);
  if (fieldRef) {
    const rewrittenField = normaliseApiFieldAlias(nextClaim.target.name, fieldRef);
    if (rewrittenField !== fieldRef) {
      rewrites.push(`field.${fieldRef} -> ${rewrittenField}`);
      nextClaim = rewriteClaimField(nextClaim, rewrittenField);
    }
  }

  if (rewrites.length === 0) return { claim };

  return {
    claim: nextClaim,
    decision: {
      claimId: claim.id,
      action: 'kept',
      reason: `field alias rewrite: normalised ${claim.target.name} ${rewrites.join(', ')}`,
    },
  };
}

function normaliseApiFieldAlias(targetName: string, fieldPath: string): string {
  if (targetName === 'stripe.subscription') {
    switch (fieldPath) {
      case 'plan_nickname':
      case 'price_nickname':
      case 'nickname':
        return 'items.data.price.nickname';
      case 'plan_lookup_key':
      case 'price_lookup_key':
      case 'lookup_key':
        return 'items.data.price.lookup_key';
      case 'price_id':
        return 'items.data.price.id';
      case 'product_id':
      case 'product':
        return 'items.data.price.product';
    }
  }
  return fieldPath;
}

function rewriteClaimField(claim: Claim, field: string): Claim {
  switch (claim.kind) {
    case 'aggregate_sum':
    case 'aggregate_avg':
    case 'pinned_field':
    case 'distribution_pct':
    case 'date_window':
      return {
        ...claim,
        field,
      };
    default:
      return claim;
  }
}

function hasValidationDataForSurface(
  claim: Claim,
  options: SanitiseOptions,
): boolean {
  if (claim.target.surface === 'db') return Boolean(options.schema);
  return Boolean(options.resourceSpecs && Object.keys(options.resourceSpecs).length > 0);
}

function resolveTargetFields(
  claim: Claim,
  index: FieldIndex,
): Set<string> | undefined {
  const key = `${claim.target.surface}:${claim.target.name}`;
  const direct = index.get(key);
  if (direct) return direct;
  if (claim.target.surface === 'api') {
    const singular = singulariseApiTarget(claim.target.name);
    if (singular) return index.get(`api:${singular}`);
  }
  return undefined;
}

function checkFieldGrounding(
  claim: Claim,
  index: FieldIndex,
): { action: 'dropped' | 'kept'; reason: string } | null {
  // Find the resource entry. Try the literal target first, then a singularised
  // alias for permissive plural names like "stripe.customers".
  const fields = resolveTargetFields(claim, index);
  // No entry → we have nothing to validate against; let the claim through.
  // This intentionally fails open rather than rejecting claims when the
  // calling site didn't pass schema/specs.
  if (!fields) return null;

  const missing: string[] = [];

  // Filter keys
  if (claim.target.filter) {
    for (const fkey of Object.keys(claim.target.filter as Filter)) {
      if (!fieldExists(fields, fkey)) missing.push(`filter.${fkey}`);
    }
  }

  // Field reference on kinds that carry one
  const fieldRef = readFieldReference(claim);
  if (fieldRef !== undefined && !fieldExists(fields, fieldRef)) {
    missing.push(`field=${fieldRef}`);
  }

  if (missing.length === 0) {
    return { action: 'kept', reason: '' };
  }

  return {
    action: 'dropped',
    reason:
      `field grounding: target ${claim.target.surface}.${claim.target.name} has no field(s) [${missing.join(', ')}]. ` +
      `Auditor would always return 0 / null. Retarget the claim to a sibling resource that exposes the required field(s).`,
  };
}

/**
 * Match `field` against the index, allowing both exact match and prefix
 * match on the head of a dotted path (e.g. `metadata.tier` is acceptable if
 * `metadata` is a registered object field — we may have only enumerated one
 * level of nesting in the spec).
 */
function fieldExists(fields: Set<string>, field: string): boolean {
  if (fields.has(field)) return true;
  const dot = field.indexOf('.');
  if (dot > 0) {
    const head = field.slice(0, dot);
    if (fields.has(head)) return true;
  }
  return false;
}

function readFieldReference(claim: Claim): string | undefined {
  switch (claim.kind) {
    case 'aggregate_sum':
    case 'aggregate_avg':
    case 'pinned_field':
    case 'distribution_pct':
    case 'date_window':
      return (claim as Claim & { field: string }).field;
    default:
      return undefined;
  }
}

function singulariseApiTarget(name: string): string | null {
  const dot = name.indexOf('.');
  if (dot < 0) return null;
  const adapter = name.slice(0, dot);
  const resource = name.slice(dot + 1);
  let singular = resource;
  if (resource.endsWith('ies')) singular = resource.slice(0, -3) + 'y';
  else if (resource.endsWith('ses') || resource.endsWith('xes') || resource.endsWith('zes')) singular = resource.slice(0, -2);
  else if (resource.endsWith('s') && !resource.endsWith('ss')) singular = resource.slice(0, -1);
  if (singular === resource) return null;
  return `${adapter}.${singular}`;
}

type Verdict =
  | { action: 'kept'; reason: string }
  | { action: 'dropped'; reason: string }
  | { action: 'demoted'; reason: string; replacement: Claim };

function inspectClaim(claim: Claim, distributionTargets: Set<string>): Verdict {
  // `aggregate_avg` / `aggregate_sum` with a percentage-looking expected and
  // no monetary or count context: the value is almost certainly a percentage
  // misread as a numeric value.
  if (claim.kind === 'aggregate_avg' || claim.kind === 'aggregate_sum') {
    const looksLikePct =
      typeof claim.expected === 'number' &&
      claim.expected > 0 &&
      claim.expected <= 100 &&
      mentionsPercent(claim.quote);
    const fieldLooksLikeRate =
      claim.field.toLowerCase().includes('pct') ||
      claim.field.toLowerCase().includes('rate') ||
      claim.field.toLowerCase().includes('percent');
    if (looksLikePct && !fieldLooksLikeRate) {
      return {
        action: 'dropped',
        reason:
          `${claim.kind} expected=${claim.expected} with quote mentioning a percentage — looks like a rate misread as a value. Dropping (auditor would always fail).`,
      };
    }
  }

  // `date_window` where `expected` is small and the quote talks about a
  // duration (months/weeks): the LLM stuffed a duration into a row count.
  if (claim.kind === 'date_window') {
    const expectedIsLowDuration = claim.expected > 0 && claim.expected <= 12;
    const quoteIsDuration = /\b\d+\s*(month|week|day|year|quarter)s?\b/i.test(claim.quote);
    if (expectedIsLowDuration && quoteIsDuration && !looksLikeRowCountContext(claim.quote)) {
      return {
        action: 'dropped',
        reason:
          `date_window expected=${claim.expected} from a duration quote — value is the duration, not a row count.`,
      };
    }
    if (!isValidIsoDate(claim.min) || !isValidIsoDate(claim.max)) {
      return {
        action: 'dropped',
        reason: `date_window min/max not valid ISO dates (min="${claim.min}", max="${claim.max}").`,
      };
    }
  }

  // `row_count` on a target that ALSO has a distribution_pct claim over
  // some field — the row_count usually IS the parent total a distribution
  // applies to. Keep it; only drop if the row_count expected suspiciously
  // matches a bucket count (e.g. someone wrote `row_count: 8` for "8
  // distinct platforms" when it's a count-distinct).
  if (claim.kind === 'row_count' && claim.expected > 0 && claim.expected <= 20) {
    const sayDistinct = /\b(distinct|unique|different|platforms?|types?|categories|kinds?)\b/i.test(
      claim.quote,
    );
    const targetKey = `${claim.target.surface}:${claim.target.name}`;
    // If another distribution_pct claim targets the same table, AND the
    // row_count expected is small AND the quote says "distinct/unique", the
    // count is almost certainly a count-distinct, not a row count.
    const hasSiblingDistribution = [...distributionTargets].some((t) =>
      t.startsWith(`${targetKey}:`),
    );
    if (sayDistinct && hasSiblingDistribution) {
      return {
        action: 'dropped',
        reason:
          `row_count expected=${claim.expected} on ${targetKey} with quote suggesting count-distinct + sibling distribution_pct claim. Likely a count-distinct miscoded as row_count.`,
      };
    }
  }

  return { action: 'kept', reason: '' };
}

function mentionsPercent(quote: string): boolean {
  if (/%/.test(quote)) return true;
  if (/\bpercent(age)?\b/i.test(quote)) return true;
  if (/\bgrowth\b/i.test(quote) && /\d+(\.\d+)?\s*%?/.test(quote)) return true;
  if (/\bMoM\b|\bYoY\b|\bWoW\b/i.test(quote)) return true;
  return false;
}

function looksLikeRowCountContext(quote: string): boolean {
  return /\b(row|record|entry|customer|user|invoice|transaction|charge|payment|subscription)s?\b/i.test(
    quote,
  );
}

function isValidIsoDate(s: string | undefined): boolean {
  if (!s || typeof s !== 'string') return false;
  // Accept "YYYY-MM-DD" or full ISO timestamps.
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}|$)/.test(s)) return false;
  const t = Date.parse(s);
  return Number.isFinite(t);
}
