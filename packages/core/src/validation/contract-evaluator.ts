/**
 * V5 — Phase 8: Contract evaluator (semantic gate).
 *
 * First of two post-generation gates. Asks: "Did we build the RIGHT data?"
 * by re-evaluating every clause in the ORIGINAL `PersonaContract` against
 * the materialised dataset (+ world state, for anchors). Failure routing
 * carries the `ownerId` from the obligation graph so Phase 10's
 * `regenerateFromOwner` knows which planner to re-run.
 *
 * Routing on failure (Phase 12 contract): the pipeline routes to
 * `regenerateFromOwner` and does NOT run the shape validator. The shape
 * validator only runs after the contract evaluator passes.
 *
 * Failure sources are V5-only: `planner`, `projection`, `canonicalisation`.
 * There is no `lowering` — V5 has no lowered shadow.
 */

import type {
  AnchorClause,
  Clause,
  ClauseFamily,
  ClauseId,
  ClauseStrength,
  CountClause,
  CrossSurfaceClause,
  DistributionClause,
  OwnerId,
  ReconciliationClause,
  TemporalClause,
} from '../contract/clause-types.js';
import type { PersonaContract } from '../contract/persona-contract.js';
import type { Filter, ResourceTarget } from '../types/claim.js';
import type { ExpandedData, Row } from '../types/dataset.js';
import type { ObligationGraph } from '../planner/obligation-graph.js';
import type { WorldState } from '../world/world-state.js';
import type { MaterialisedDataset } from '../projection/types.js';

import { selectRows, readRowField, toNumber, firstScalar } from './select-rows.js';
import { checkReconciliation } from './helper-checkers/reconciliation.js';
import { checkTemporalGap } from './helper-checkers/temporal-consistency.js';
import { resolveNumericTolerance } from '../utils/tolerance.js';
import { checkCrossSurfaceDrift } from './helper-checkers/cross-surface-drift.js';
import { checkSemanticDistribution } from './helper-checkers/semantic-distribution.js';
import { resolveSemanticTarget } from '../contract/semantic-capabilities.js';

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

export type ContractEvaluationFailureSource =
  | 'planner'
  | 'projection'
  | 'canonicalisation';

export interface ContractEvaluationFailure {
  clauseId: ClauseId;
  family: ClauseFamily;
  strength: ClauseStrength;
  /** Quoted from the source persona text — for error rendering. */
  quote: string;
  predicate: string;
  actual?: unknown;
  reason: string;
  /** Owning planner. Phase 10 routes regen on this. Absent for narrative. */
  ownerId?: OwnerId;
  source: ContractEvaluationFailureSource;
}

export interface ContractEvaluationPass {
  clauseId: ClauseId;
  family: ClauseFamily;
  strength: ClauseStrength;
  passed: true;
  predicate: string;
}

export type ContractEvaluation =
  | ContractEvaluationPass
  | (ContractEvaluationFailure & { passed: false });

export interface ContractEvaluationResult {
  evaluations: ContractEvaluation[];
  failures: ContractEvaluationFailure[];
  passed: boolean;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function evaluateContract(
  contract: PersonaContract,
  worldState: WorldState,
  materialised: MaterialisedDataset,
  graph?: ObligationGraph,
): ContractEvaluationResult {
  const expanded = materialised as unknown as ExpandedData;
  const evaluations: ContractEvaluation[] = [];

  for (const clause of contract.clauses) {
    if (clause.strength === 'soft' || clause.family === 'narrative') {
      // Soft / narrative never block; we don't even record evaluations.
      continue;
    }
    const evaluation = evaluateClause(clause, expanded, worldState, graph);
    evaluations.push(evaluation);
  }

  const failures = evaluations
    .filter((e): e is ContractEvaluationFailure & { passed: false } => !(e as ContractEvaluationPass).passed)
    .map((e) => e);

  return {
    evaluations,
    failures,
    passed: failures.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Per-clause dispatch
// ---------------------------------------------------------------------------

function evaluateClause(
  clause: Clause,
  expanded: ExpandedData,
  worldState: WorldState,
  graph: ObligationGraph | undefined,
): ContractEvaluation {
  switch (clause.family) {
    case 'count':
      return evalCount(clause, expanded, ownerFor(clause, graph));
    case 'aggregate':
      return evalAggregate(clause, expanded, ownerFor(clause, graph));
    case 'distribution':
      return evalDistribution(clause, expanded, ownerFor(clause, graph));
    case 'temporal':
      return evalTemporal(clause, expanded, worldState, ownerFor(clause, graph));
    case 'anchor':
      return evalAnchor(clause, worldState, ownerFor(clause, graph));
    case 'cross_surface':
      return evalCrossSurface(clause, expanded, worldState, ownerFor(clause, graph));
    case 'reconciliation':
      return evalReconciliation(clause, expanded, ownerFor(clause, graph));
    case 'narrative':
      // Filtered out earlier; unreachable.
      return pass(clause, 'narrative — not checked');
  }
}

function ownerFor(clause: Clause, graph: ObligationGraph | undefined): OwnerId | undefined {
  return graph?.byClauseId.get(clause.id)?.ownerId;
}

// ---------------------------------------------------------------------------
// Family checks
// ---------------------------------------------------------------------------

function evalCount(
  clause: CountClause,
  expanded: ExpandedData,
  ownerId: OwnerId | undefined,
): ContractEvaluation {
  const target = resolveTarget(clause.target, clause.semanticTarget?.adapter, clause);
  if (!target) {
    return fail(clause, 'count target could not be resolved', undefined, 'canonicalisation', ownerId);
  }
  const rows = selectRows(target, expanded);
  const actual = rows.length;
  const tol = resolveNumericTolerance(clause.expected, clause.tolerance);
  const predicate = `count(${describeTarget(target)}) = ${clause.expected}${tol ? ` (±${tol})` : ''}`;
  if (Math.abs(actual - clause.expected) <= tol) return pass(clause, predicate);
  return fail(clause, `expected ${clause.expected}, got ${actual}`, actual, 'planner', ownerId, predicate);
}

function evalAggregate(
  clause: import('../contract/clause-types.js').AggregateClause,
  expanded: ExpandedData,
  ownerId: OwnerId | undefined,
): ContractEvaluation {
  const target = resolveTarget(clause.target, clause.semanticTarget?.adapter, clause);
  if (!target) {
    return fail(clause, 'aggregate target could not be resolved', undefined, 'canonicalisation', ownerId);
  }
  const rows = selectRows(target, expanded);
  const sum = rows.reduce((s, r) => s + toNumber(readRowField(r, clause.field)), 0);
  const value = clause.op === 'avg' ? (rows.length === 0 ? 0 : sum / rows.length) : sum;
  const tol = resolveNumericTolerance(clause.expected, clause.tolerance);
  const predicate = `${clause.op}(${describeTarget(target)}.${clause.field}) = ${clause.expected}${tol ? ` (±${tol})` : ''}`;
  if (Math.abs(value - clause.expected) <= tol) return pass(clause, predicate);
  return fail(
    clause,
    `${clause.op} of ${clause.field} = ${value}, expected ${clause.expected}`,
    value,
    'planner',
    ownerId,
    predicate,
  );
}

function evalDistribution(
  clause: DistributionClause,
  expanded: ExpandedData,
  ownerId: OwnerId | undefined,
): ContractEvaluation {
  // Prefer the semantic-distribution helper when the clause is on a
  // semantic target — the helper canonicalises tier values per the
  // existing capability registry.
  if (clause.semanticTarget && clause.semanticField) {
    const r = checkSemanticDistribution(clause, expanded);
    const predicate = `distribution(${clause.field}) matches ${JSON.stringify(clause.values)}`;
    return r.passed
      ? pass(clause, predicate)
      : fail(clause, r.reason ?? 'distribution does not match', r.actual, 'planner', ownerId, predicate);
  }

  // Raw distribution: count rows per bucket, compare percentages.
  const target = resolveTarget(clause.target, undefined, clause);
  if (!target) {
    return fail(clause, 'distribution target could not be resolved', undefined, 'canonicalisation', ownerId);
  }
  const rows = selectRows(target, expanded);
  const total = rows.length;
  if (total === 0) {
    return fail(clause, 'distribution target has zero rows', { total: 0 }, 'planner', ownerId);
  }
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const v = String(firstScalar(readRowField(r, clause.field)) ?? '');
    counts[v] = (counts[v] ?? 0) + 1;
  }
  const actualPct: Record<string, number> = {};
  for (const [k, c] of Object.entries(counts)) actualPct[k] = (c / total) * 100;
  const tol = clause.tolerance ?? 2;
  for (const [k, expectedPct] of Object.entries(clause.values)) {
    if (Math.abs((actualPct[k] ?? 0) - expectedPct) > tol) {
      return fail(
        clause,
        `bucket ${k}: expected ${expectedPct}%, got ${(actualPct[k] ?? 0).toFixed(1)}%`,
        actualPct,
        'planner',
        ownerId,
      );
    }
  }
  return pass(clause, `distribution within ±${tol}pp`);
}

function evalTemporal(
  clause: TemporalClause,
  expanded: ExpandedData,
  worldState: WorldState,
  ownerId: OwnerId | undefined,
): ContractEvaluation {
  if (clause.kind === 'window') {
    // Prefer the materialised dataset; fall back to lifecycle events.
    const target = resolveTarget(clause.target, undefined, clause);
    let count = 0;
    if (target) {
      const rows = selectRows(target, expanded);
      count = countInWindow(rows, clause.field, clause.min, clause.max);
    }
    if (count === 0 && worldState.lifecycleEvents.length > 0) {
      // Fall through to lifecycle events when materialisation is empty
      // (e.g. an api:stripe.charge surface that no projector registered).
      count = worldState.lifecycleEvents.filter((e) => {
        const ts = new Date(e.timestamp).getTime();
        return (
          Number.isFinite(ts) &&
          ts >= new Date(clause.min).getTime() &&
          ts <= new Date(clause.max).getTime()
        );
      }).length;
    }
    const tol = resolveNumericTolerance(clause.expected, clause.tolerance);
    const predicate = `count(${target ? describeTarget(target) : 'lifecycle'} where ${clause.field} ∈ [${clause.min}, ${clause.max}]) = ${clause.expected}${tol ? ` (±${tol})` : ''}`;
    return Math.abs(count - clause.expected) <= tol
      ? pass(clause, predicate)
      : fail(clause, `expected ${clause.expected}, got ${count}`, count, 'planner', ownerId, predicate);
  }
  // relative_gap — needs anchors. Build a minimal Anchor[] from world state.
  const anchors = [...worldState.anchors.values()].map((a) => ({
    id: a.anchorId,
    dates: a.dates,
  }));
  const r = checkTemporalGap(clause, anchors as Parameters<typeof checkTemporalGap>[1]);
  const predicate = `gap(${clause.anchorA} → ${clause.anchorB}) = ${clause.days}d`;
  return r.passed
    ? pass(clause, predicate)
    : fail(clause, r.reason ?? 'temporal gap mismatch', r.actualDays, 'planner', ownerId, predicate);
}

function evalAnchor(
  clause: AnchorClause,
  worldState: WorldState,
  ownerId: OwnerId | undefined,
): ContractEvaluation {
  const binding = worldState.anchors.get(clause.anchorId);
  const predicate = `anchor(${clause.anchorId}) bound`;
  if (!binding) {
    return fail(
      clause,
      `anchor ${clause.anchorId} was not bound in the world state`,
      null,
      'planner',
      ownerId,
      predicate,
    );
  }
  return pass(clause, predicate);
}

function evalCrossSurface(
  clause: CrossSurfaceClause,
  _expanded: ExpandedData,
  worldState: WorldState,
  ownerId: OwnerId | undefined,
): ContractEvaluation {
  const r = checkCrossSurfaceDrift(clause, worldState);
  const predicate = `cross_surface(${clause.entity}.${clause.field}) drifts as expected`;
  return r.passed
    ? pass(clause, predicate)
    : fail(clause, r.reason ?? 'cross-surface drift mismatch', r, 'projection', ownerId, predicate);
}

function evalReconciliation(
  clause: ReconciliationClause,
  expanded: ExpandedData,
  ownerId: OwnerId | undefined,
): ContractEvaluation {
  const r = checkReconciliation(clause, expanded);
  const predicate = `reconciliation(${clause.metric}) headline=${clause.headline} ≈ Σbuckets`;
  return r.passed
    ? pass(clause, predicate)
    : fail(clause, r.reason ?? 'reconciliation mismatch', r, 'planner', ownerId, predicate);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pass(clause: Clause, predicate: string): ContractEvaluationPass {
  return {
    clauseId: clause.id,
    family: clause.family,
    strength: clause.strength,
    passed: true,
    predicate,
  };
}

function fail(
  clause: Clause,
  reason: string,
  actual: unknown,
  source: ContractEvaluationFailureSource,
  ownerId: OwnerId | undefined,
  predicate: string = '',
): ContractEvaluationFailure & { passed: false } {
  return {
    clauseId: clause.id,
    family: clause.family,
    strength: clause.strength,
    quote: clause.quote,
    predicate,
    actual,
    reason,
    ownerId,
    source,
    passed: false,
  };
}

function resolveTarget(
  raw: ResourceTarget | undefined,
  _adapter: string | undefined,
  clause: Clause,
): ResourceTarget | undefined {
  if (raw) return raw;
  // Semantic targets resolve via the existing capability registry.
  const semantic = (clause as { semanticTarget?: import('../contract/clause-types.js').SemanticTarget })
    .semanticTarget;
  if (!semantic) return undefined;
  const resolved = resolveSemanticTarget(semantic);
  return resolved?.target;
}

function describeTarget(t: ResourceTarget): string {
  const filter = t.filter ? ` where ${describeFilter(t.filter)}` : '';
  return `${t.surface}.${t.name}${filter}`;
}

function describeFilter(filter: Filter): string {
  return Object.entries(filter)
    .map(([k, v]) => `${k}=${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`)
    .join(' AND ');
}

function countInWindow(rows: Row[], field: string, min: string, max: string): number {
  const minMs = new Date(min).getTime();
  const maxMs = new Date(max).getTime();
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) return 0;
  let count = 0;
  for (const r of rows) {
    const v = readRowField(r, field);
    const ts = toTimestampMs(v);
    if (ts != null && ts >= minMs && ts <= maxMs) count++;
  }
  return count;
}

function toTimestampMs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}
