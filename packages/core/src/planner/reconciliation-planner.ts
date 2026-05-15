/**
 * V5 — Phase 6: Reconciliation planner.
 *
 * Owns: reconciliation clauses + revenue aggregates (mrr / arr / revenue
 * / mrr_change). Writes one `BudgetLedger` per clause and asserts sum
 * identity post-write — a failure throws `BudgetIdentityError`. V5
 * forbids semantic patching of output; the orchestrator must regenerate
 * from this planner if its budget cannot balance.
 */

import type { PersonaContract } from '../contract/persona-contract.js';
import type { AggregateClause, Clause } from '../contract/clause-types.js';
import type { BudgetLedger } from '../world/budget.js';
import { assertLedgerBalances } from '../world/budget.js';
import type { CanonicalEntity } from '../world/entity.js';
import type { WorldState, WorldStateDelta } from '../world/world-state.js';
import type { Filter } from '../types/claim.js';
import type { ObligationGraph } from './obligation-graph.js';
import type { PlannerEvidence, PlannerResult } from './planner-result.js';

export function runReconciliationPlanner(
  contract: PersonaContract,
  graph: ObligationGraph,
  state: WorldState,
): PlannerResult {
  const nodes = graph.byOwnerId.get('reconciliation') ?? [];
  const ledgers: Array<[string, BudgetLedger]> = [];
  const evidence: PlannerEvidence[] = [];
  // New entities minted to satisfy revenue aggregates whose target
  // population had no count-clause-derived rows. Keyed by populationId.
  const minted = new Map<string, CanonicalEntity[]>();

  for (const node of nodes) {
    if (node.budgetClaim.kind === 'reconciliation') {
      const claim = node.budgetClaim;
      const parts = new Map<string, number>();
      for (const b of claim.buckets) parts.set(b.name, b.value);
      const ledger: BudgetLedger = {
        id: claim.metric,
        total: claim.headline,
        parts,
        tolerance: claim.tolerance,
      };
      // V5 contract: this MUST balance — feasibility gate already verified
      // it, but we assert again here so a planner re-run that miswrites
      // parts also fails loudly.
      assertLedgerBalances(ledger);
      ledgers.push([ledger.id, ledger]);
      evidence.push({
        clauseId: node.clauseId,
        observed: { metric: claim.metric, headline: claim.headline, parts: claim.buckets },
        note: `reconciliation planner wrote ledger ${claim.metric}`,
      });
    } else if (node.budgetClaim.kind === 'aggregate') {
      // Revenue aggregates without explicit buckets still produce a
      // budget ledger headline so the proof report can cite them.
      // Key by clauseId, not by metricId: a persona may have multiple
      // `mrr` aggregates (one per platform), and they must NOT collide
      // on a shared ledger key.
      const claim = node.budgetClaim;
      const ledger: BudgetLedger = {
        id: node.clauseId,
        total: claim.expected,
        parts: new Map([['total', claim.expected]]),
        tolerance: claim.tolerance,
      };
      assertLedgerBalances(ledger);
      ledgers.push([ledger.id, ledger]);
      // Stamp the aggregate value onto the matching entities so the
      // contract evaluator's `sum(rows.field)` actually finds it. The
      // population planner does this for non-revenue aggregates; revenue
      // aggregates route through us instead — without stamping, every
      // mrr/arr/revenue sum reads 0 from the materialised dataset.
      const clause = contract.clauses.find((c) => c.id === node.clauseId) as
        | AggregateClause
        | undefined;
      if (clause) {
        stampOnMatching(state, minted, clause, claim.expected, claim.op, claim.metricId);
      }
      evidence.push({
        clauseId: node.clauseId,
        observed: { metric: claim.metricId, op: claim.op, expected: claim.expected },
        note: `reconciliation planner stamped ${claim.metricId} headline`,
      });
    }
  }

  const populations: WorldStateDelta['populations'] = [];
  for (const [populationId, entities] of minted) {
    populations.push({ populationId, entities });
  }
  const delta: WorldStateDelta = {
    budgets: ledgers,
    ...(populations.length > 0 ? { populations } : {}),
  };
  return { delta, evidence };
}

function stampOnMatching(
  state: WorldState,
  minted: Map<string, CanonicalEntity[]>,
  clause: AggregateClause,
  expected: number,
  op: 'sum' | 'avg',
  metricId: string,
): void {
  const populationId = clause.canonicalTarget?.populationId;
  if (!populationId || populationId === 'unresolved') return;
  const existing = state.populations.get(populationId) ?? [];
  const mintedHere = minted.get(populationId) ?? [];
  const pool = [...existing, ...mintedHere];
  let matching = pool.filter((e) => matchesCohortRule(e, clause.canonicalTarget?.cohortRule));
  if (matching.length === 0) {
    const adopted = adoptCompatibleEntity(pool, clause.canonicalTarget?.cohortRule);
    if (adopted) {
      matching = [adopted];
    }
  }
  if (matching.length === 0) {
    // No count clause created entities for this cohort. Mint a single
    // entity carrying the cohort's filter attrs so the evaluator's
    // `sum(rows.field)` has something to read. This is the equivalent
    // of population planner's `ensureAggregatePopulation` path.
    const seed = cohortRuleToAttrs(clause.canonicalTarget?.cohortRule);
    const idx = pool.length + 1;
    const newEntity: CanonicalEntity = {
      id: `${populationId}/e${idx}`,
      populationId,
      cohorts: new Set(),
      attrs: { ...seed },
      surfaceBindings: surfaceBindingFromPopulationId(populationId),
      lifecycle: { start: '2026-01-01', status: 'active' },
    };
    mintedHere.push(newEntity);
    minted.set(populationId, mintedHere);
    matching = [newEntity];
  }
  const field = clause.field;

  if (op === 'avg') {
    for (const entity of matching) {
      if (entity.attrs[field] === undefined) {
        entity.attrs[field] = expected;
      }
      entity.attrs[`agg.${metricId}`] = expected;
    }
    return;
  }

  // sum: preserve any field values that earlier (more specific) clauses
  // already stamped; distribute the remainder across the unstamped subset.
  let alreadyStamped = 0;
  const unstamped: CanonicalEntity[] = [];
  for (const entity of matching) {
    const v = entity.attrs[field];
    if (typeof v === 'number') alreadyStamped += v;
    else unstamped.push(entity);
  }
  const remaining = expected - alreadyStamped;
  const count = unstamped.length;
  if (count <= 0) return;
  const base = Math.trunc(remaining / count);
  let rem = remaining - base * count;
  for (let i = 0; i < count; i++) {
    const step = rem > 0 ? 1 : rem < 0 ? -1 : 0;
    const value =
      (rem > 0 && i < rem) || (rem < 0 && i < Math.abs(rem)) ? base + step : base;
    const entity = unstamped[i]!;
    entity.attrs[field] = value;
    entity.attrs[`agg.${metricId}`] = value;
  }
}

function matchesCohortRule(
  entity: CanonicalEntity,
  rule: Filter | undefined,
): boolean {
  if (!rule) return true;
  for (const [field, expected] of Object.entries(rule)) {
    const current =
      entity.attrs[field] ?? (field === 'status' ? entity.lifecycle.status : undefined);
    if (expected === null) {
      if (current !== null) return false;
      continue;
    }
    if (typeof expected === 'object' && expected !== null && !Array.isArray(expected)) {
      // Operator predicates aren't matched here — the population planner
      // handles those; revenue aggregates almost always use scalar
      // equality. Skip to avoid false negatives.
      continue;
    }
    if (current !== expected) return false;
  }
  return true;
}

function cohortRuleToAttrs(rule: Filter | undefined): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  if (!rule) return attrs;
  for (const [field, value] of Object.entries(rule)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) continue;
    attrs[field] = value;
  }
  return attrs;
}

function adoptCompatibleEntity(
  pool: CanonicalEntity[],
  rule: Filter | undefined,
): CanonicalEntity | null {
  if (!rule) return pool[0] ?? null;
  for (const entity of pool) {
    if (!canAdoptCohortRule(entity, rule)) continue;
    seedEntityFromCohortRule(entity, rule);
    return entity;
  }
  return null;
}

function canAdoptCohortRule(entity: CanonicalEntity, rule: Filter): boolean {
  for (const [field, predicate] of Object.entries(rule)) {
    const current = readEntityField(entity, field);
    if (predicate === null) {
      if (current !== undefined && current !== null) return false;
      continue;
    }
    if (typeof predicate !== 'object' || predicate == null || Array.isArray(predicate)) {
      if (current !== undefined && current !== predicate) return false;
      continue;
    }

    const op = predicate as Record<string, unknown>;
    if ('eq' in op) {
      if (current !== undefined && current !== op.eq) return false;
      continue;
    }
    if ('in' in op && Array.isArray(op.in)) {
      if (current !== undefined && !op.in.some((value) => current === value)) return false;
      continue;
    }
    if ('neq' in op) {
      if (current !== undefined && current === op.neq) return false;
      continue;
    }
    if ('is_null' in op) {
      if (op.is_null === true && current !== undefined && current !== null) return false;
      if (op.is_null === false && (current === null || current === undefined)) return false;
      continue;
    }
  }
  return true;
}

function seedEntityFromCohortRule(entity: CanonicalEntity, rule: Filter): void {
  for (const [field, predicate] of Object.entries(rule)) {
    const current = readEntityField(entity, field);
    if (current !== undefined) continue;
    if (predicate === null || typeof predicate !== 'object' || Array.isArray(predicate)) {
      writeEntityField(entity, field, predicate);
      continue;
    }

    const op = predicate as Record<string, unknown>;
    if ('eq' in op) {
      writeEntityField(entity, field, op.eq);
    } else if ('in' in op && Array.isArray(op.in) && op.in.length > 0) {
      writeEntityField(entity, field, op.in[0]);
    } else if ('is_null' in op && op.is_null === true) {
      writeEntityField(entity, field, null);
    }
  }
}

function readEntityField(entity: CanonicalEntity, field: string): unknown {
  if (field === 'status') return entity.lifecycle.status;
  return entity.attrs[field];
}

function writeEntityField(entity: CanonicalEntity, field: string, value: unknown): void {
  // All cohort-derived writes land on `attrs`. `lifecycle.status` is the
  // canonical 6-value enum (active/trialing/paused/churned/past_due/pending)
  // owned by the population planner; filter-derived status strings from
  // arbitrary platforms (Zuora "Active", Chargebee "overdue", etc.) belong
  // on `attrs.status` only. The cohort matcher reads attrs first and falls
  // back to lifecycle, so this just works.
  entity.attrs[field] = value;
}

function surfaceBindingFromPopulationId(
  populationId: string,
): import('../world/entity.js').SurfaceBinding[] {
  if (populationId.startsWith('db:')) {
    return [{ surface: 'db', objectKind: populationId.slice(3) }];
  }
  if (populationId.startsWith('product:')) {
    const [, table] = populationId.split(':');
    return table ? [{ surface: 'db', objectKind: table }] : [];
  }
  if (populationId.startsWith('api:')) {
    const rest = populationId.slice(4);
    const dot = rest.indexOf('.');
    if (dot < 0) return [];
    return [{ surface: rest.slice(0, dot), objectKind: rest.slice(dot + 1) }];
  }
  return [];
}

void ((_: Clause) => undefined);
