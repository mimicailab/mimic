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
