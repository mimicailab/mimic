/**
 * V5 — Phase 6: Planner orchestrator.
 *
 * Topologically sorts the planners and threads the world state through
 * each one. The order matters:
 *
 *   population → identity → lifecycle → anchor → reconciliation
 *
 *   - identity must run after population (it needs entities to slot)
 *   - anchor must run after population (it binds to an entity)
 *   - lifecycle reads populations; runs after them
 *   - reconciliation has no dependency on entities but is conventionally
 *     last so the proof report can cite its ledgers alongside the
 *     others' evidence.
 *
 * Returns the final WorldState plus the flat evidence list. Phase 10's
 * `regenerateFromOwner` re-enters this orchestrator from the affected
 * planner forward, mutating only the slice that planner owns.
 */

import type { OwnerId } from '../contract/clause-types.js';
import type { PersonaContract } from '../contract/persona-contract.js';
import type { WorldState } from '../world/world-state.js';
import { mergeDelta, resetWorldStateFromOwner } from '../world/world-state.js';
import { runAnchorPlanner } from './anchor-planner.js';
import { runIdentityPlanner } from './identity-planner.js';
import { runLifecyclePlanner } from './lifecycle-planner.js';
import { runPopulationPlanner } from './population-planner.js';
import { runReconciliationPlanner } from './reconciliation-planner.js';
import type { ObligationGraph } from './obligation-graph.js';
import type { PlannerEvidence } from './planner-result.js';

export const PLANNER_ORDER: OwnerId[] = [
  'population',
  'identity',
  'lifecycle',
  'anchor',
  'reconciliation',
];

const PLANNERS = {
  population: runPopulationPlanner,
  identity: runIdentityPlanner,
  lifecycle: runLifecyclePlanner,
  anchor: runAnchorPlanner,
  reconciliation: runReconciliationPlanner,
} as const;

export interface OrchestratorResult {
  state: WorldState;
  evidence: PlannerEvidence[];
}

export function runPlanners(
  contract: PersonaContract,
  graph: ObligationGraph,
  initialState: WorldState,
): OrchestratorResult {
  let state = initialState;
  const evidence: PlannerEvidence[] = [];
  for (const owner of PLANNER_ORDER) {
    const planner = PLANNERS[owner];
    const result = planner(contract, graph, state);
    state = mergeDelta(state, result.delta);
    evidence.push(...result.evidence);
  }
  return { state, evidence };
}

/**
 * Re-run a single owner planner with the existing state as input. Phase
 * 10 invokes this when the contract evaluator routes a failure to a
 * specific owner. The downstream planners (everything after `ownerId`
 * in `PLANNER_ORDER`) re-run as well, so the world is consistent.
 */
export function regenerateFromOwner(
  contract: PersonaContract,
  graph: ObligationGraph,
  state: WorldState,
  ownerId: OwnerId,
): OrchestratorResult {
  const start = PLANNER_ORDER.indexOf(ownerId);
  if (start < 0) {
    throw new Error(`regenerateFromOwner: unknown owner "${ownerId}".`);
  }
  let next = resetWorldStateFromOwner(state, ownerId);
  const evidence: PlannerEvidence[] = [];
  for (let i = start; i < PLANNER_ORDER.length; i++) {
    const owner = PLANNER_ORDER[i]!;
    const planner = PLANNERS[owner];
    const result = planner(contract, graph, next);
    next = mergeDelta(next, result.delta);
    evidence.push(...result.evidence);
  }
  return { state: next, evidence };
}
