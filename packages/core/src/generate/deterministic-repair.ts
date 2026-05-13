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
