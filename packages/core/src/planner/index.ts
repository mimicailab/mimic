/**
 * V5 — Planner barrel.
 *
 * Phase 4 surface: pre-generation gate + supporting modules. Phase 6 will
 * add the semantic planners and the orchestrator; this file expands then.
 */

export {
  runPreGenerationGate,
  formatGateReport,
  type GateResult,
} from './pre-generation-gate.js';

export {
  runFeasibilityChecks,
  type FeasibilityResult,
  type FeasibilityFailure,
  type FeasibilityRuleId,
  type MissingOwnerFailure,
  type ContradictionAndCoverageReport,
} from './feasibility.js';

export {
  assignOwner,
  listRules,
  OWNERS_REGISTRY_VERSION,
  type OwnerAssignmentDecision,
} from './owners.js';

export {
  buildObligationGraph,
  buildObligationNode,
  type ObligationGraph,
  type ObligationNode,
  type BudgetClaim,
} from './obligation-graph.js';

// V5 — Phase 6 planners + orchestrator.
export { runPopulationPlanner } from './population-planner.js';
export { runIdentityPlanner } from './identity-planner.js';
export { runLifecyclePlanner } from './lifecycle-planner.js';
export { runAnchorPlanner } from './anchor-planner.js';
export { runReconciliationPlanner } from './reconciliation-planner.js';
export {
  PLANNER_ORDER,
  runPlanners,
  regenerateFromOwner,
  type OrchestratorResult,
} from './orchestrator.js';
export type { PlannerEvidence, PlannerResult } from './planner-result.js';
