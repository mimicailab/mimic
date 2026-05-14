/**
 * Deterministic repair — mechanical patches for common audit failures.
 *
 * Runs BEFORE the LLM repair call. The architectural premise: most claim
 * failures have a single obvious fix (adjust a count, set a field, narrow a
 * date range). Patching these mechanically saves an LLM round-trip and is
 * deterministic — same audit → same patch → same outcome.
 *
 * Only the LLM is called for failures with no mechanical fix (e.g. complex
 * aggregate_sum where multiple archetypes share a varied field).
 *
 * Pure function over (audit, blueprint). Returns a `BlueprintPatch` plus a
 * residual set of unfixable failures for the caller to forward to the LLM.
 */

import type { Blueprint, EntityArchetype, FieldVariation } from '../types/blueprint.js';
import type {
  AuditResult,
  BlueprintPatch,
  Claim,
  ClaimEvaluation,
  Filter,
  PatchOp,
} from '../types/claim.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DeterministicRepairResult {
  patch: BlueprintPatch;
  /** Failures the deterministic pass could not address — caller can forward to LLM */
  residualFailures: ClaimEvaluation[];
  /** Per-failure outcome — for telemetry */
  decisions: RepairDecision[];
}

export interface RepairDecision {
  claimId: string;
  status: 'patched' | 'deferred';
  /** Why it was patched (or deferred) */
  reason: string;
  ops: PatchOp[];
}

/**
 * Walk audit failures and emit mechanical patches where possible.
 * Failures with no mechanical fix go into `residualFailures`.
 */
export function deterministicRepair(
  blueprint: Blueprint,
  audit: AuditResult,
): DeterministicRepairResult {
  const ops: PatchOp[] = [];
  const residualFailures: ClaimEvaluation[] = [];
  const decisions: RepairDecision[] = [];

  for (const failure of audit.failures) {
    const decision = repairOne(blueprint, failure);
    decisions.push(decision);
    if (decision.status === 'patched') {
      ops.push(...decision.ops);
    } else {
      residualFailures.push(failure);
    }
  }

  return {
    patch: {
      ops,
      rationale:
        ops.length === 0
          ? 'Deterministic repair: no mechanical fixes available.'
          : `Deterministic repair patched ${ops.length} op${ops.length === 1 ? '' : 's'} across ${decisions.filter((d) => d.status === 'patched').length} of ${audit.failures.length} failure${audit.failures.length === 1 ? '' : 's'}.`,
    },
    residualFailures,
    decisions,
  };
}

// ---------------------------------------------------------------------------
// Per-failure dispatch
// ---------------------------------------------------------------------------

function repairOne(blueprint: Blueprint, failure: ClaimEvaluation): RepairDecision {
  const claim = failure.claim;
  switch (claim.kind) {
    case 'row_count':
      return repairRowCount(blueprint, failure, claim);
    case 'pinned_field':
      return repairPinnedField(blueprint, failure, claim);
    case 'no_row_with':
      return repairNoRowWith(blueprint, failure, claim);
    case 'date_window':
      return repairDateWindow(blueprint, failure, claim);
    case 'distribution_pct':
      return repairDistribution(blueprint, failure, claim);
    case 'orphans_exactly':
      return repairOrphans(blueprint, failure, claim);
    case 'aggregate_sum':
    case 'aggregate_avg':
      return defer(claim.id, `${claim.kind} requires varied-field reshaping — defer to LLM`);
  }
}

// ---------------------------------------------------------------------------
// row_count — adjust cited archetype counts to close the gap
// ---------------------------------------------------------------------------

function repairRowCount(
  blueprint: Blueprint,
  failure: ClaimEvaluation,
  claim: Extract<Claim, { kind: 'row_count' }>,
): RepairDecision {
  const actual = toInt(failure.actual);
  if (actual == null) return defer(claim.id, 'row_count actual is non-numeric — unexpected');

  const delta = claim.expected - actual;
  if (delta === 0) return defer(claim.id, 'no delta — should not be a failure');

  const citers = findCitingArchetypes(blueprint, claim.id);
  if (citers.length === 0) {
    return defer(claim.id, 'no archetype cites this claim — cannot mechanically adjust');
  }

  // Predicate-leakage detection. When the actual count is much larger than
  // what the cited archetypes alone could explain, the overcount is leaking
  // from NON-CITED archetypes whose fields/vary incidentally satisfy the
  // filter (e.g. pro-paying-active timestamps drifting into the 30+-day-old
  // band, or non-orphan archetypes leaving external_id as null). Naively
  // zeroing the cited archetype doesn't help — the leak stays.
  const totalCiterCount = citers.reduce((s, c) => s + (c.archetype.count ?? 0), 0);
  const hasFilter = claim.target.filter && Object.keys(claim.target.filter).length > 0;
  if (hasFilter && delta < 0 && Math.abs(delta) > totalCiterCount) {
    return repairRowCountLeakage(blueprint, claim, citers, actual, failure.provenanceBreakdown);
  }

  // Pick the citing archetype with the highest current count and adjust it.
  // For grow: bump the largest citer (more headroom for variation).
  // For shrink: same — clamp at 0.
  const ranked = [...citers].sort(
    (a, b) => (b.archetype.count ?? 0) - (a.archetype.count ?? 0),
  );
  const target = ranked[0]!;
  const newCount = Math.max(0, (target.archetype.count ?? 0) + delta);

  const op: PatchOp = {
    op: 'set_count',
    path: target.path,
    count: newCount,
  };

  return {
    claimId: claim.id,
    status: 'patched',
    reason:
      `row_count delta=${delta}; bumped ${target.ref} from ${target.archetype.count ?? 0} to ${newCount}`,
    ops: [op],
  };
}

/**
 * Repair a row_count claim whose overcount comes from predicate leakage —
 * non-cited archetypes whose field/vary state satisfies the filter.
 *
 * Two-pronged fix:
 *   1. ANCHOR the cited archetypes at exactly `claim.expected` (split evenly)
 *      so the cited rows contribute the right number.
 *   2. NARROW non-cited archetypes that target the same surface and could
 *      match the filter. For `age_days_gte/lte` filters, this is mechanical:
 *      we can rewrite the vary timestamp/range so the non-cited rows fall on
 *      the opposite side of the threshold. For `is_null:true` or `eq` style
 *      leakage, we mark the archetype but leave the actual narrowing to the
 *      LLM repair (the right non-null value is semantic).
 */
function repairRowCountLeakage(
  blueprint: Blueprint,
  claim: Extract<Claim, { kind: 'row_count' }>,
  citers: CitingArchetype[],
  actual: number,
  provenanceBreakdown: Record<string, number> | undefined,
): RepairDecision {
  const ops: PatchOp[] = [];

  // 1) Anchor citers at exactly the expected count, distributed across them.
  const expected = claim.expected;
  const perCiter = Math.floor(expected / citers.length);
  const remainder = expected - perCiter * citers.length;
  citers.forEach((c, i) => {
    const newCount = perCiter + (i < remainder ? 1 : 0);
    if (c.archetype.count !== newCount) {
      ops.push({ op: 'set_count', path: c.path, count: newCount });
    }
  });

  // 2) Find non-cited archetypes that could match the filter and try to narrow
  //    them. Two sources:
  //    - Same-surface static analysis (`findLeakingArchetypes`).
  //    - Cross-surface provenance: when matched rows came from an archetype on
  //      a different surface via mirror or fk-backfill, the same-surface scan
  //      misses it. Provenance attribution exposes the real leaker.
  const sameSurfaceLeakers = findLeakingArchetypes(blueprint, claim, citers);
  const crossSurfaceLeakers = findLeakersFromProvenance(
    blueprint, claim, citers, provenanceBreakdown,
  );
  const leakers = dedupeLeakersByPath([...sameSurfaceLeakers, ...crossSurfaceLeakers]);
  const narrowedRefs: string[] = [];
  const unfixableRefs: string[] = [];
  for (const leaker of leakers) {
    const narrowOps = narrowToExcludeFilter(leaker, claim.target.filter!);
    if (narrowOps.length > 0) {
      ops.push(...narrowOps);
      narrowedRefs.push(leaker.ref);
    } else {
      unfixableRefs.push(leaker.ref);
    }
  }

  const parts: string[] = [];
  parts.push(`row_count overcount: actual=${actual} expected=${expected}, citer-sum=${citers.reduce((s, c) => s + (c.archetype.count ?? 0), 0)}`);
  parts.push(`anchored ${citers.length} cited archetype${citers.length === 1 ? '' : 's'} to total ${expected}`);
  if (narrowedRefs.length > 0) {
    parts.push(`narrowed ${narrowedRefs.length} leaking archetype${narrowedRefs.length === 1 ? '' : 's'} (${narrowedRefs.join(', ')})`);
  }
  if (unfixableRefs.length > 0) {
    parts.push(`${unfixableRefs.length} leak${unfixableRefs.length === 1 ? '' : 's'} need LLM (${unfixableRefs.join(', ')})`);
  }

  return {
    claimId: claim.id,
    status: 'patched',
    reason: parts.join('; '),
    ops,
  };
}

/**
 * Find archetypes on the same surface/table as `claim.target` that DON'T cite
 * the claim but whose fields/vary could satisfy the filter — i.e. predicate
 * leakage candidates.
 */
function findLeakingArchetypes(
  blueprint: Blueprint,
  claim: Extract<Claim, { kind: 'row_count' }>,
  citers: CitingArchetype[],
): CitingArchetype[] {
  const citerPaths = new Set(citers.map((c) => c.path));
  const filter = claim.target.filter ?? {};
  const surface = claim.target.surface;
  const name = claim.target.name;

  const collected: CitingArchetype[] = [];

  if (surface === 'db') {
    const config = blueprint.data.entityArchetypes?.[name];
    if (!config) return [];
    for (const a of config.archetypes) {
      const path = `data.entityArchetypes.${name}.archetypes[${a.label}]`;
      if (citerPaths.has(path)) continue;
      if (couldMatchFilter(a, filter)) {
        collected.push({
          ref: `db:${name}:${a.label}`,
          path,
          archetype: a,
        });
      }
    }
  } else {
    // api: "<adapter>.<resource>"
    const dot = name.indexOf('.');
    if (dot < 0) return [];
    const adapter = name.slice(0, dot);
    const resource = name.slice(dot + 1);
    const config = blueprint.data.apiEntityArchetypes?.[adapter]?.[resource];
    if (!config) return [];
    for (const a of config.archetypes) {
      const path = `data.apiEntityArchetypes.${adapter}.${resource}.archetypes[${a.label}]`;
      if (citerPaths.has(path)) continue;
      if (couldMatchFilter(a, filter)) {
        collected.push({
          ref: `api:${adapter}.${resource}:${a.label}`,
          path,
          archetype: a,
        });
      }
    }
  }

  return collected;
}

/**
 * Find leaking archetypes by following the auditor's runtime provenance
 * breakdown. Unlike `findLeakingArchetypes`, this can identify cross-surface
 * leakers: a `db.users` overcount whose rows trace back to an API archetype
 * via the mirror flow surfaces here as `api.<adapter>.<resource>[label]
 * (via mirror)`. Without this, the same-surface static scan would miss the
 * real culprit and the repair would keep clamping the wrong archetype.
 *
 * Conservative: only archetypes with a non-zero contribution to the matched
 * rows are returned. We ignore static / pattern / fk-backfill buckets (they
 * have no corresponding archetype to patch).
 */
function findLeakersFromProvenance(
  blueprint: Blueprint,
  claim: Extract<Claim, { kind: 'row_count' }>,
  citers: CitingArchetype[],
  breakdown: Record<string, number> | undefined,
): CitingArchetype[] {
  if (!breakdown) return [];
  const citerLabels = new Set(citers.map((c) => `${c.archetype.label}`));
  const out: CitingArchetype[] = [];
  // Match "<surface>.<target>[<label>]" optionally followed by " (via <kind>)".
  const KEY_RE = /^(db|api)\.(.+?)\[(.+?)\](?: \(via ([\w-]+)\))?$/;
  for (const [key, count] of Object.entries(breakdown)) {
    if (count <= 0) continue;
    const match = key.match(KEY_RE);
    if (!match) continue;
    const surface = match[1] as 'db' | 'api';
    const target = match[2]!;
    const label = match[3]!;
    const via = match[4];
    // Static rows / pattern rows / fk-backfill have no archetype to patch.
    if (via === 'static' || via === 'pattern' || via === 'fk-backfill') continue;
    // Don't relabel a citing archetype as a leaker.
    if (citerLabels.has(label) &&
        surface === claim.target.surface &&
        target === claim.target.name) continue;
    const archetype = lookupArchetype(blueprint, surface, target, label);
    if (!archetype) continue;
    const path = archetypePath(surface, target, label);
    if (citers.some((c) => c.path === path)) continue;
    out.push({ ref: `${surface}:${target}:${label}`, path, archetype });
  }
  return out;
}

function lookupArchetype(
  blueprint: Blueprint,
  surface: 'db' | 'api',
  target: string,
  label: string,
): EntityArchetype | undefined {
  if (surface === 'db') {
    const config = blueprint.data.entityArchetypes?.[target];
    return config?.archetypes.find((a) => a.label === label);
  }
  const dot = target.indexOf('.');
  if (dot < 0) return undefined;
  const adapter = target.slice(0, dot);
  const resource = target.slice(dot + 1);
  const config = blueprint.data.apiEntityArchetypes?.[adapter]?.[resource];
  return config?.archetypes.find((a) => a.label === label);
}

function archetypePath(surface: 'db' | 'api', target: string, label: string): string {
  if (surface === 'db') {
    return `data.entityArchetypes.${target}.archetypes[${label}]`;
  }
  const dot = target.indexOf('.');
  if (dot < 0) return '';
  const adapter = target.slice(0, dot);
  const resource = target.slice(dot + 1);
  return `data.apiEntityArchetypes.${adapter}.${resource}.archetypes[${label}]`;
}

function dedupeLeakersByPath(items: CitingArchetype[]): CitingArchetype[] {
  const seen = new Set<string>();
  const out: CitingArchetype[] = [];
  for (const item of items) {
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    out.push(item);
  }
  return out;
}

/**
 * Conservatively decide whether an archetype's fields/vary state CAN satisfy
 * the filter. Returns true when no per-field check rules it out — i.e. the
 * archetype "could" leak into the predicate. False positives are acceptable
 * (we'll just emit redundant narrowing ops); false negatives are NOT (we'd
 * miss the leak entirely).
 */
function couldMatchFilter(archetype: EntityArchetype, filter: Filter): boolean {
  for (const [field, predicate] of Object.entries(filter)) {
    const fieldValue = archetype.fields[field];
    const varyValue = archetype.vary[field];

    // If the archetype has a constant field value, evaluate directly.
    if (fieldValue !== undefined && varyValue === undefined) {
      if (!constantCanSatisfy(fieldValue, predicate)) return false;
      continue;
    }
    // Otherwise the field varies (or is unset → treated as null). We can't
    // rule it out at this layer; assume it could match.
  }
  return true;
}

function constantCanSatisfy(value: unknown, predicate: unknown): boolean {
  // Bare-value equality
  if (predicate === null || typeof predicate !== 'object' || Array.isArray(predicate)) {
    return value === predicate;
  }
  const op = predicate as Record<string, unknown>;
  if ('eq' in op) return value === op.eq;
  if ('neq' in op) return value !== op.neq;
  if ('in' in op && Array.isArray(op.in)) return op.in.includes(value);
  if ('nin' in op && Array.isArray(op.nin)) return !op.nin.includes(value);
  if ('is_null' in op) {
    const isNull = value === null || value === undefined || value === '';
    return isNull === op.is_null;
  }
  // For numeric/date comparisons on constants, conservatively allow.
  return true;
}

/**
 * Emit ops that make the given archetype STOP matching the filter. Only
 * handles cases that are mechanically obvious; returns [] when the right
 * non-matching value is a semantic call best left to the LLM.
 *
 * Currently handled:
 *   - `age_days_gte: N` on field F → set vary[F] = timestamp within last N days
 *   - `age_days_lte: N` on field F → set vary[F] = timestamp older than N days
 */
function narrowToExcludeFilter(leaker: CitingArchetype, filter: Filter): PatchOp[] {
  const ops: PatchOp[] = [];
  for (const [field, predicate] of Object.entries(filter)) {
    if (predicate === null || typeof predicate !== 'object' || Array.isArray(predicate)) {
      continue; // bare-value equality leakage needs LLM
    }
    const op = predicate as Record<string, unknown>;
    const nowSec = Math.floor(Date.now() / 1000);
    const day = 86_400;

    if ('age_days_gte' in op && typeof op.age_days_gte === 'number') {
      // Filter matches rows older than N days. Make non-cited rows YOUNGER
      // than N days: vary[F] = range(now - (N-1) days, now).
      const days = op.age_days_gte;
      const newVary: FieldVariation = {
        type: 'range',
        min: nowSec - (days - 1) * day,
        max: nowSec,
      };
      ops.push({
        op: 'set_vary',
        path: `${leaker.path}.vary.${field}`,
        variation: newVary,
      });
      continue;
    }
    if ('age_days_lte' in op && typeof op.age_days_lte === 'number') {
      // Filter matches rows YOUNGER than N days. Make non-cited rows OLDER
      // than N days: vary[F] = range(start_of_year, now - (N+1) days).
      const days = op.age_days_lte;
      const newVary: FieldVariation = {
        type: 'range',
        min: nowSec - 365 * day,
        max: nowSec - (days + 1) * day,
      };
      ops.push({
        op: 'set_vary',
        path: `${leaker.path}.vary.${field}`,
        variation: newVary,
      });
      continue;
    }
    // Other ops (is_null, eq, in, ...) require choosing a sensible
    // non-matching value, which is semantic — defer to LLM.
  }
  return ops;
}

// ---------------------------------------------------------------------------
// pinned_field — write the constant value into cited archetypes
// ---------------------------------------------------------------------------

function repairPinnedField(
  blueprint: Blueprint,
  failure: ClaimEvaluation,
  claim: Extract<Claim, { kind: 'pinned_field' }>,
): RepairDecision {
  const citers = findCitingArchetypes(blueprint, claim.id);
  if (citers.length === 0) {
    return defer(claim.id, 'no archetype cites this pinned_field claim');
  }

  const ops: PatchOp[] = [];
  for (const c of citers) {
    // Don't repath if already set correctly (defense in depth)
    if (c.archetype.fields[claim.field] === claim.expected) continue;
    ops.push({
      op: 'set_field',
      path: `${c.path}.fields.${claim.field}`,
      value: claim.expected,
    });
    // Also clear any vary on this field — vary will override fields.
    if (c.archetype.vary[claim.field] != null) {
      ops.push({
        op: 'set_field',
        path: `${c.path}.vary.${claim.field}`,
        value: undefined,
      });
    }
  }

  if (ops.length === 0) {
    return defer(claim.id, 'all cited archetypes already pin this field correctly');
  }

  return {
    claimId: claim.id,
    status: 'patched',
    reason: `set ${claim.field}=${JSON.stringify(claim.expected)} on ${citers.length} cited archetype${citers.length === 1 ? '' : 's'}`,
    ops,
  };
}

// ---------------------------------------------------------------------------
// no_row_with — zero out cited archetypes
// ---------------------------------------------------------------------------

function repairNoRowWith(
  blueprint: Blueprint,
  _failure: ClaimEvaluation,
  claim: Extract<Claim, { kind: 'no_row_with' }>,
): RepairDecision {
  const citers = findCitingArchetypes(blueprint, claim.id);
  if (citers.length === 0) {
    return defer(claim.id, 'no_row_with failed but no archetype cites it — origin unclear');
  }
  const ops: PatchOp[] = citers.map((c) => ({
    op: 'set_count',
    path: c.path,
    count: 0,
  }));
  return {
    claimId: claim.id,
    status: 'patched',
    reason: `zeroed ${citers.length} cited archetype${citers.length === 1 ? '' : 's'} to satisfy no_row_with`,
    ops,
  };
}

// ---------------------------------------------------------------------------
// date_window — narrow vary timestamp ranges to fall within [min, max]
// ---------------------------------------------------------------------------

function repairDateWindow(
  blueprint: Blueprint,
  failure: ClaimEvaluation,
  claim: Extract<Claim, { kind: 'date_window' }>,
): RepairDecision {
  const citers = findCitingArchetypes(blueprint, claim.id);
  if (citers.length === 0) {
    return defer(claim.id, 'no archetype cites this date_window claim');
  }

  const minMs = new Date(claim.min).getTime();
  const maxMs = new Date(claim.max).getTime();
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) {
    return defer(claim.id, `cannot parse min/max dates: ${claim.min} ${claim.max}`);
  }

  const ops: PatchOp[] = [];
  for (const c of citers) {
    const variation = c.archetype.vary[claim.field];
    if (variation == null) {
      // No vary rule — write one
      const newVary: FieldVariation = {
        type: 'timestamp',
        min: Math.floor(minMs / 1000),
        max: Math.floor(maxMs / 1000),
      };
      ops.push({
        op: 'set_vary',
        path: `${c.path}.vary.${claim.field}`,
        variation: newVary,
      });
      continue;
    }
    if (variation.type === 'timestamp' || variation.type === 'date') {
      const newVary: FieldVariation = {
        ...variation,
        min: Math.floor(minMs / 1000),
        max: Math.floor(maxMs / 1000),
      };
      ops.push({
        op: 'set_vary',
        path: `${c.path}.vary.${claim.field}`,
        variation: newVary,
      });
    }
  }

  if (ops.length === 0) {
    return defer(claim.id, 'no timestamp/date vary rules to adjust on cited archetypes');
  }

  return {
    claimId: claim.id,
    status: 'patched',
    reason:
      `narrowed ${ops.length} vary rule${ops.length === 1 ? '' : 's'} to [${claim.min}, ${claim.max}] (window count=${toInt(failure.actual) ?? '?'}, expected=${claim.expected})`,
    ops,
  };
}

// ---------------------------------------------------------------------------
// distribution_pct — re-scale cited archetype counts to hit the target mix
// ---------------------------------------------------------------------------

function repairDistribution(
  blueprint: Blueprint,
  failure: ClaimEvaluation,
  claim: Extract<Claim, { kind: 'distribution_pct' }>,
): RepairDecision {
  // For distribution failures, the solver already does the heavy lifting in
  // the engine pre-pass. If we got here, something downstream broke. Defer.
  void blueprint;
  void failure;
  return defer(claim.id, 'distribution_pct already attempted by solver; defer to LLM if still failing');
}

// ---------------------------------------------------------------------------
// orphans_exactly — adjust apiOnly archetype counts
// ---------------------------------------------------------------------------

function repairOrphans(
  blueprint: Blueprint,
  failure: ClaimEvaluation,
  claim: Extract<Claim, { kind: 'orphans_exactly' }>,
): RepairDecision {
  const actual = toInt(failure.actual);
  if (actual == null) return defer(claim.id, 'orphans actual is non-numeric');
  const delta = claim.expected - actual;
  if (delta === 0) return defer(claim.id, 'no delta');

  const citers = findCitingArchetypes(blueprint, claim.id);
  const apiOnlyCiters = citers.filter((c) => c.archetype.apiOnly === true);
  if (apiOnlyCiters.length === 0) {
    return defer(claim.id, 'no apiOnly archetype cites this orphans claim');
  }
  const target = apiOnlyCiters[0]!;
  const newCount = Math.max(0, (target.archetype.count ?? 0) + delta);
  return {
    claimId: claim.id,
    status: 'patched',
    reason: `adjusted apiOnly ${target.ref} from ${target.archetype.count ?? 0} to ${newCount}`,
    ops: [{ op: 'set_count', path: target.path, count: newCount }],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CitingArchetype {
  ref: string;
  path: string;
  archetype: EntityArchetype;
}

function findCitingArchetypes(blueprint: Blueprint, claimId: string): CitingArchetype[] {
  const out: CitingArchetype[] = [];
  for (const [table, config] of Object.entries(blueprint.data.entityArchetypes ?? {})) {
    for (const a of config.archetypes) {
      if (a.cites?.includes(claimId)) {
        out.push({
          ref: `db:${table}:${a.label}`,
          path: `data.entityArchetypes.${table}.archetypes[${a.label}]`,
          archetype: a,
        });
      }
    }
  }
  for (const [adapter, resources] of Object.entries(blueprint.data.apiEntityArchetypes ?? {})) {
    for (const [resource, config] of Object.entries(resources)) {
      for (const a of config.archetypes) {
        if (a.cites?.includes(claimId)) {
          out.push({
            ref: `api:${adapter}.${resource}:${a.label}`,
            path: `data.apiEntityArchetypes.${adapter}.${resource}.archetypes[${a.label}]`,
            archetype: a,
          });
        }
      }
    }
  }
  return out;
}

function toInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

function defer(claimId: string, reason: string): RepairDecision {
  return { claimId, status: 'deferred', reason, ops: [] };
}

/** Pretty-format a repair result for the logger. */
export function formatRepairDecisions(decisions: RepairDecision[]): string {
  if (decisions.length === 0) return '';
  const lines: string[] = [];
  const patched = decisions.filter((d) => d.status === 'patched');
  const deferred = decisions.filter((d) => d.status === 'deferred');
  lines.push(
    `Deterministic repair: ${patched.length} patched, ${deferred.length} deferred to LLM.`,
  );
  for (const d of decisions) {
    lines.push(`  ${d.status === 'patched' ? '✓' : '·'} ${d.claimId}: ${d.reason}`);
  }
  return lines.join('\n');
}
