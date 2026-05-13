/**
 * Count solver — assigns archetype counts deterministically from claim constraints.
 *
 * Replaces LLM-emitted `count`/`weight` guesses with arithmetic over the
 * (archetype → cites → claim) graph. The persona's row_count claims are
 * treated as constraints; archetypes that cite a claim are its "contributors."
 * The solver pins counts by solving:
 *
 *   sum(count(a) for a in archetypes where claim ∈ a.cites) ≈ claim.expected
 *
 * Strategy
 * --------
 * 1. Build a constraint graph (claims × archetypes).
 * 2. Pin singleton-cite claims first — one cite ⇒ count = expected.
 * 3. Propagate: for each multi-cite claim, subtract pinned contributions and
 *    distribute the remainder across unpinned citers (by their declared
 *    weight, or evenly).
 * 4. Apply `distribution_pct` claims to redistribute archetypes within a
 *    target slice.
 * 5. Detect infeasibilities (over-constrained claims) and surface them with
 *    a diagnostic identifying the conflict.
 *
 * Output: a `BlueprintPatch` of `set_count` ops, plus a feasibility report.
 * The caller applies the patch via the existing `applyBlueprintPatch`.
 *
 * The solver is a pure function over `Blueprint`. It does not mutate.
 */

import type { Blueprint, EntityArchetype } from '../types/blueprint.js';
import type { BlueprintPatch, Claim, PatchOp } from '../types/claim.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SolveResult {
  /** Patch to apply via applyBlueprintPatch */
  patch: BlueprintPatch;
  /** Per-archetype assignments — `<surface>:<target>:<label>` → count */
  assignments: Map<string, number>;
  /** Infeasibility diagnostics (claim conflicts the solver couldn't resolve) */
  conflicts: SolverConflict[];
  /** Telemetry — useful for logging which pass placed each assignment */
  trace: SolverTraceEntry[];
}

export interface SolverConflict {
  claimId: string;
  expected: number;
  /** Sum of citers' assigned counts */
  assignedSum: number;
  tolerance: number;
  /** Human-readable explanation */
  message: string;
}

export interface SolverTraceEntry {
  archetypeRef: string;
  count: number;
  reason: 'singleton' | 'multi-cite-remainder' | 'distribution-pct' | 'preserved' | 'orphan' | 'parent-residual';
  claimId?: string;
}

/**
 * Solve archetype counts from claims. Returns a patch + assignments.
 * Pure: input blueprint is not mutated.
 */
export function solveCounts(blueprint: Blueprint): SolveResult {
  const archetypes = collectArchetypes(blueprint);
  const claims = blueprint.data.claims ?? [];

  const assignments = new Map<string, number>();
  const trace: SolverTraceEntry[] = [];
  const conflicts: SolverConflict[] = [];

  // Pass 0 — seed assignments with any existing explicit counts. The LLM may
  // have set some; we treat those as preliminary and let later passes refine.
  // Singleton/multi-cite passes overwrite; distribution_pct may overwrite.
  for (const a of archetypes) {
    if (typeof a.archetype.count === 'number' && a.archetype.count > 0) {
      assignments.set(a.ref, a.archetype.count);
      trace.push({ archetypeRef: a.ref, count: a.archetype.count, reason: 'preserved' });
    }
  }

  // Pass 1 — singleton cites: any claim cited by exactly one archetype gets
  // that archetype's count pinned to claim.expected.
  const rowCountClaims = claims.filter((c): c is Extract<Claim, { kind: 'row_count' }> => c.kind === 'row_count');
  for (const claim of rowCountClaims) {
    const citers = archetypes.filter((a) => a.archetype.cites?.includes(claim.id));
    if (citers.length !== 1) continue;
    const citer = citers[0]!;
    assignments.set(citer.ref, claim.expected);
    trace.push({
      archetypeRef: citer.ref,
      count: claim.expected,
      reason: 'singleton',
      claimId: claim.id,
    });
  }

  // Pass 2 — multi-cite distribution: for each claim with multiple citers,
  // subtract the pinned/preserved contributions and split the remainder
  // across unpinned citers by weight (or evenly).
  for (const claim of rowCountClaims) {
    const citers = archetypes.filter((a) => a.archetype.cites?.includes(claim.id));
    if (citers.length <= 1) continue;

    const pinned: typeof citers = [];
    const unpinned: typeof citers = [];
    let pinnedSum = 0;
    for (const c of citers) {
      const existing = assignments.get(c.ref);
      if (typeof existing === 'number') {
        pinned.push(c);
        pinnedSum += existing;
      } else {
        unpinned.push(c);
      }
    }

    const remainder = claim.expected - pinnedSum;

    if (unpinned.length === 0) {
      // All citers already pinned; verify in feasibility check below.
      continue;
    }

    if (remainder <= 0) {
      // Pinned values already meet/exceed expected — give unpinned at most 0
      // each. Better to surface as a conflict than to silently overflow.
      for (const u of unpinned) {
        assignments.set(u.ref, 0);
        trace.push({
          archetypeRef: u.ref,
          count: 0,
          reason: 'multi-cite-remainder',
          claimId: claim.id,
        });
      }
      continue;
    }

    const totalWeight = unpinned.reduce((s, a) => s + (a.archetype.weight ?? 0), 0);
    const distributed = distributeRemainder(unpinned, remainder, totalWeight);
    for (const [ref, count] of distributed) {
      assignments.set(ref, count);
      trace.push({
        archetypeRef: ref,
        count,
        reason: 'multi-cite-remainder',
        claimId: claim.id,
      });
    }
  }

  // Pass 3 — distribution_pct: for each distribution_pct claim, find the
  // target archetype config and redistribute. Distribution_pct doesn't tell
  // us totals — it depends on a sibling row_count claim or the config's own
  // total. We use the sum of currently-assigned archetypes (or the config
  // total) as the basis.
  const distributionClaims = claims.filter(
    (c): c is Extract<Claim, { kind: 'distribution_pct' }> => c.kind === 'distribution_pct',
  );
  for (const claim of distributionClaims) {
    applyDistribution(claim, archetypes, assignments, trace);
  }

  // Pass 4 — orphan archetypes (cite nothing or cite only claims we couldn't
  // satisfy): fill from parent config's count minus assigned siblings.
  for (const a of archetypes) {
    if (assignments.has(a.ref)) continue;
    if (a.archetype.anchor || a.archetype.apiOnly) continue; // anchor/apiOnly handled by expander

    const siblings = archetypes.filter((s) => s.parentConfigKey === a.parentConfigKey);
    const assignedSum = siblings.reduce(
      (s, sib) => s + (assignments.get(sib.ref) ?? 0),
      0,
    );
    const parentTotal = a.parentConfigCount ?? 0;
    const remaining = Math.max(0, parentTotal - assignedSum);
    const unassignedCount = siblings.filter((s) => !assignments.has(s.ref)).length;

    if (unassignedCount > 0 && remaining > 0) {
      const share = Math.floor(remaining / unassignedCount);
      assignments.set(a.ref, share);
      trace.push({
        archetypeRef: a.ref,
        count: share,
        reason: 'parent-residual',
      });
    } else if (typeof a.archetype.weight === 'number' && a.archetype.weight > 0) {
      // Weight-only archetype with no claims to pin against — keep its
      // weight-derived share. We leave count unset so the expander uses
      // weight × parent.count. Mark in trace.
      trace.push({
        archetypeRef: a.ref,
        count: -1,
        reason: 'orphan',
      });
    } else {
      // Nothing to anchor it; default to 0 to keep the system deterministic.
      assignments.set(a.ref, 0);
      trace.push({
        archetypeRef: a.ref,
        count: 0,
        reason: 'orphan',
      });
    }
  }

  // Feasibility check — for each row_count claim, sum citer counts and
  // compare against expected ± tolerance.
  for (const claim of rowCountClaims) {
    const citers = archetypes.filter((a) => a.archetype.cites?.includes(claim.id));
    if (citers.length === 0) continue; // no citers ⇒ caller's problem, audit will catch
    const sum = citers.reduce((s, c) => s + (assignments.get(c.ref) ?? 0), 0);
    const tolerance = claim.tolerance ?? 0;
    if (Math.abs(sum - claim.expected) > tolerance) {
      conflicts.push({
        claimId: claim.id,
        expected: claim.expected,
        assignedSum: sum,
        tolerance,
        message:
          `Claim "${claim.id}" expects ${claim.expected}` +
          (tolerance > 0 ? ` (±${tolerance})` : '') +
          `, but its ${citers.length} citing archetype${citers.length === 1 ? '' : 's'} ` +
          `(${citers.map((c) => c.ref).join(', ')}) ` +
          `sum to ${sum}. ` +
          `Off by ${sum - claim.expected}.`,
      });
    }
  }

  // Emit patch ops only for archetypes whose count changed (or is being set
  // for the first time). Skip orphan markers (count: -1).
  const ops: PatchOp[] = [];
  for (const a of archetypes) {
    const target = assignments.get(a.ref);
    if (target == null) continue;
    const current = a.archetype.count;
    if (current === target) continue; // no-op
    ops.push({
      op: 'set_count',
      path: a.path,
      count: target,
    });
  }

  return {
    patch: {
      ops,
      rationale:
        `Solver assigned ${ops.length} archetype count${ops.length === 1 ? '' : 's'} ` +
        `from ${rowCountClaims.length} row_count and ${distributionClaims.length} distribution_pct claim${
          rowCountClaims.length + distributionClaims.length === 1 ? '' : 's'
        }. ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} detected.`,
    },
    assignments,
    conflicts,
    trace,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ArchetypeRecord {
  /** Stable reference, "<surface>:<target>:<label>" */
  ref: string;
  /** Patch path, e.g. "data.entityArchetypes.users.archetypes[stripe-starter]" */
  path: string;
  /** "<surface>:<target>" — used for sibling lookup */
  parentConfigKey: string;
  /** The parent EntityArchetypeConfig.count, when set */
  parentConfigCount?: number;
  archetype: EntityArchetype;
}

function collectArchetypes(blueprint: Blueprint): ArchetypeRecord[] {
  const out: ArchetypeRecord[] = [];
  for (const [table, config] of Object.entries(blueprint.data.entityArchetypes ?? {})) {
    for (const a of config.archetypes) {
      out.push({
        ref: `db:${table}:${a.label}`,
        path: `data.entityArchetypes.${table}.archetypes[${a.label}]`,
        parentConfigKey: `db:${table}`,
        parentConfigCount: config.count,
        archetype: a,
      });
    }
  }
  for (const [adapter, resources] of Object.entries(blueprint.data.apiEntityArchetypes ?? {})) {
    for (const [resource, config] of Object.entries(resources)) {
      for (const a of config.archetypes) {
        out.push({
          ref: `api:${adapter}.${resource}:${a.label}`,
          path: `data.apiEntityArchetypes.${adapter}.${resource}.archetypes[${a.label}]`,
          parentConfigKey: `api:${adapter}.${resource}`,
          parentConfigCount: config.count,
          archetype: a,
        });
      }
    }
  }
  return out;
}

/**
 * Distribute a remainder across unpinned archetypes, weighted by their
 * declared weight (or evenly if no weights). Uses integer rounding with
 * remainder-correction so the assigned sum equals the target exactly.
 */
function distributeRemainder(
  citers: ArchetypeRecord[],
  remainder: number,
  totalWeight: number,
): Map<string, number> {
  const result = new Map<string, number>();
  if (citers.length === 0 || remainder <= 0) return result;

  if (totalWeight > 0) {
    // Weighted distribution
    const provisional = citers.map((c) => ({
      ref: c.ref,
      raw: (remainder * (c.archetype.weight ?? 0)) / totalWeight,
    }));
    const floored = provisional.map((p) => ({ ref: p.ref, value: Math.floor(p.raw), frac: p.raw - Math.floor(p.raw) }));
    let assignedSum = floored.reduce((s, x) => s + x.value, 0);
    // Distribute the remainder by largest fractional part
    const leftover = remainder - assignedSum;
    const sorted = [...floored].sort((a, b) => b.frac - a.frac);
    for (let i = 0; i < leftover; i++) {
      const entry = sorted[i % sorted.length]!;
      entry.value += 1;
      assignedSum += 1;
    }
    for (const x of floored) result.set(x.ref, x.value);
  } else {
    // Even distribution
    const base = Math.floor(remainder / citers.length);
    const leftover = remainder - base * citers.length;
    for (let i = 0; i < citers.length; i++) {
      result.set(citers[i]!.ref, base + (i < leftover ? 1 : 0));
    }
  }
  return result;
}

/**
 * Apply a distribution_pct claim by redistributing archetypes that share the
 * claim's target. Each archetype's `fields[claim.field]` (or vary value)
 * decides which bucket it falls into.
 *
 * Only archetypes whose constant field value matches a bucket key are
 * touched — varying-field archetypes are ignored (the auditor handles them
 * as a soft constraint).
 */
function applyDistribution(
  claim: Extract<Claim, { kind: 'distribution_pct' }>,
  archetypes: ArchetypeRecord[],
  assignments: Map<string, number>,
  trace: SolverTraceEntry[],
): void {
  const targetKey = `${claim.target.surface}:${claim.target.name}`;
  const siblings = archetypes.filter((a) => a.parentConfigKey === targetKey);
  if (siblings.length === 0) return;

  const total = siblings.reduce((s, a) => s + (assignments.get(a.ref) ?? 0), 0);
  if (total === 0) return;

  for (const [bucketValue, pct] of Object.entries(claim.values)) {
    const bucketArchetypes = siblings.filter(
      (a) => a.archetype.fields[claim.field] === bucketValue,
    );
    if (bucketArchetypes.length === 0) continue;

    const targetCount = Math.round((pct / 100) * total);
    const currentBucketSum = bucketArchetypes.reduce(
      (s, a) => s + (assignments.get(a.ref) ?? 0),
      0,
    );
    if (currentBucketSum === targetCount) continue;

    // Scale the bucket archetypes proportionally to hit targetCount.
    const scale = currentBucketSum > 0 ? targetCount / currentBucketSum : 1;
    const provisional = bucketArchetypes.map((a) => ({
      ref: a.ref,
      raw: (assignments.get(a.ref) ?? 0) * scale,
    }));
    const floored = provisional.map((p) => ({ ref: p.ref, value: Math.floor(p.raw), frac: p.raw - Math.floor(p.raw) }));
    let sum = floored.reduce((s, x) => s + x.value, 0);
    const leftover = targetCount - sum;
    if (leftover > 0) {
      const sorted = [...floored].sort((a, b) => b.frac - a.frac);
      for (let i = 0; i < leftover; i++) {
        sorted[i % sorted.length]!.value += 1;
        sum += 1;
      }
    } else if (leftover < 0) {
      const sorted = [...floored].sort((a, b) => a.frac - b.frac);
      for (let i = 0; i < -leftover; i++) {
        if (sorted[i % sorted.length]!.value > 0) sorted[i % sorted.length]!.value -= 1;
      }
    }
    for (const x of floored) {
      assignments.set(x.ref, x.value);
      trace.push({
        archetypeRef: x.ref,
        count: x.value,
        reason: 'distribution-pct',
        claimId: claim.id,
      });
    }
  }
}

/**
 * Format conflicts as a human-readable diagnostic. Used by the engine to
 * surface infeasible personas at parse time.
 */
export function formatConflicts(conflicts: SolverConflict[]): string {
  if (conflicts.length === 0) return '';
  const lines: string[] = [];
  lines.push(`Count solver detected ${conflicts.length} infeasible constraint${conflicts.length === 1 ? '' : 's'}:`);
  for (const c of conflicts) {
    lines.push('');
    lines.push(`  ${c.message}`);
  }
  return lines.join('\n');
}
