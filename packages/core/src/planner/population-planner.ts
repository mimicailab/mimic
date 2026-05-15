/**
 * V5 — Phase 6: Population planner.
 *
 * Owns: count clauses, distribution clauses on populations, non-revenue
 * aggregates. Materialises canonical entities into the world state, tagging
 * them with cohort labels and seeding their attributes.
 *
 * Deterministic by construction. Reads:
 *   - the slice of obligation nodes whose ownerId is 'population'
 *   - the canonical contract clauses (for cohort rules + distribution mixes)
 *   - the world-state PRNG (for tie-breaking deterministic shuffles)
 *
 * Writes the `populations` map in the world state.
 */

import type {
  Clause,
  DistributionClause,
} from '../contract/clause-types.js';
import type { PersonaContract } from '../contract/persona-contract.js';
import type {
  CanonicalEntity,
  CohortId,
} from '../world/entity.js';
import type { WorldState, WorldStateDelta } from '../world/world-state.js';
import type { ObligationGraph, ObligationNode } from './obligation-graph.js';
import type { PlannerEvidence, PlannerResult } from './planner-result.js';

export function runPopulationPlanner(
  contract: PersonaContract,
  graph: ObligationGraph,
  state: WorldState,
): PlannerResult {
  const nodes = graph.byOwnerId.get('population') ?? [];
  const evidence: PlannerEvidence[] = [];

  // 1) Walk count obligations: ensure each (populationId, cohortKey) has
  //    the expected number of entities. Tracks per-cohort counts so a
  //    later count obligation on the same cohort is idempotent.
  const perPopulation = new Map<string, CanonicalEntity[]>();

  for (const node of nodes) {
    if (node.budgetClaim.kind !== 'count') continue;
    const populationId = primaryPopulation(node);
    if (!populationId) continue;

    const expected = node.budgetClaim.expected;
    const clause = contract.clauses.find((c) => c.id === node.clauseId);
    const cohorts = cohortsFor(clause);
    const attrs = attrsFor(clause);
    const existing = perPopulation.get(populationId) ?? [];

    while (existing.length < currentNeed(perPopulation, populationId, expected)) {
      const idx = existing.length + 1;
      existing.push({
        id: `${populationId}/e${idx}`,
        populationId,
        cohorts: new Set(cohorts),
        attrs: { ...attrs },
        lifecycle: { start: '2026-01-01', status: 'active' },
      });
    }
    perPopulation.set(populationId, existing);
    evidence.push({
      clauseId: node.clauseId,
      observed: { populationId, count: expected, cohorts },
      note: `population planner created/extended ${populationId} to ${expected} entities`,
    });
  }

  // 2) Walk distribution obligations: assign cohort/tier attribute values
  //    over the entities so the distribution holds. Distribution mixes
  //    pin a SECOND attribute (typically `tier`) onto entities that
  //    population planner already created in step 1.
  for (const node of nodes) {
    if (node.budgetClaim.kind !== 'distribution') continue;
    const populationId = primaryPopulation(node);
    if (!populationId) continue;
    const entities = perPopulation.get(populationId);
    if (!entities || entities.length === 0) continue;
    const clause = contract.clauses.find((c) => c.id === node.clauseId) as
      | DistributionClause
      | undefined;
    if (!clause) continue;

    applyDistribution(entities, clause);
    evidence.push({
      clauseId: node.clauseId,
      observed: { populationId, field: clause.field, values: clause.values },
      note: `population planner applied distribution on ${clause.field}`,
    });
  }

  // 3) Walk non-revenue aggregates owned by population. These pin a
  //    derived attribute on every entity in the population (e.g. avg
  //    login_count = N). We simply stamp the expected/aggregate hint as
  //    an attribute so downstream projectors can read it.
  for (const node of nodes) {
    if (node.budgetClaim.kind !== 'aggregate') continue;
    const populationId = primaryPopulation(node);
    if (!populationId) continue;
    const entities = perPopulation.get(populationId);
    if (!entities) continue;
    const claim = node.budgetClaim;
    for (const e of entities) {
      const key = `agg.${claim.metricId}`;
      if (claim.op === 'sum') {
        e.attrs[key] = claim.expected / Math.max(entities.length, 1);
      } else {
        e.attrs[key] = claim.expected;
      }
    }
    evidence.push({
      clauseId: node.clauseId,
      observed: { populationId, metricId: claim.metricId, expected: claim.expected },
      note: `population planner stamped ${claim.metricId} aggregate hint`,
    });
  }

  // Threading the PRNG into deterministic shuffles is a future hook —
  // for Phase 6's deterministic skeleton we don't need to consume it.
  void state.prng;

  const delta: WorldStateDelta = {
    populations: [...perPopulation.entries()].map(([populationId, entities]) => ({
      populationId,
      entities,
    })),
  };

  return { delta, evidence };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function primaryPopulation(node: ObligationNode): string | null {
  const id = node.canonicalEntities[0];
  return id ?? null;
}

function currentNeed(
  perPopulation: Map<string, CanonicalEntity[]>,
  populationId: string,
  expected: number,
): number {
  const existing = perPopulation.get(populationId)?.length ?? 0;
  return Math.max(existing, expected);
}

function cohortsFor(clause: Clause | undefined): CohortId[] {
  if (!clause) return [];
  const cohorts = new Set<CohortId>();
  const rule = clause.canonicalTarget?.cohortRule;
  if (rule) {
    for (const [k, v] of Object.entries(rule)) {
      if (typeof v === 'string') cohorts.add(`${k}:${v}`);
    }
  }
  if ((clause as { semanticTarget?: { facets?: { tier?: string } } }).semanticTarget?.facets?.tier) {
    cohorts.add(`tier:${(clause as { semanticTarget?: { facets?: { tier?: string } } }).semanticTarget!.facets!.tier!}`);
  }
  return [...cohorts];
}

function attrsFor(clause: Clause | undefined): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  if (!clause) return attrs;
  const rule = clause.canonicalTarget?.cohortRule;
  if (rule) {
    for (const [k, v] of Object.entries(rule)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        attrs[k] = v;
      }
    }
  }
  return attrs;
}

function applyDistribution(entities: CanonicalEntity[], clause: DistributionClause): void {
  const total = entities.length;
  if (total === 0) return;
  const entries = Object.entries(clause.values).sort((a, b) => b[1] - a[1]);
  let cursor = 0;
  for (const [value, pct] of entries) {
    const slice = Math.round((pct / 100) * total);
    for (let i = 0; i < slice && cursor + i < total; i++) {
      const e = entities[cursor + i]!;
      e.attrs[clause.field] = value;
      e.cohorts.add(`${clause.field}:${value}`);
    }
    cursor += slice;
  }
}
