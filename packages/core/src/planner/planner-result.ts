/**
 * V5 — Phase 6: Shared planner result shape.
 *
 * Every semantic planner returns the same shape: the slice of world state
 * it wrote (`delta`) plus one evidence record per clause it owns. Evidence
 * records flow into Phase 11's proof report when validators pass.
 */

import type { ClauseId } from '../contract/clause-types.js';
import type { WorldStateDelta } from '../world/world-state.js';

export interface PlannerEvidence {
  clauseId: ClauseId;
  /** What the planner produced for this clause. */
  observed: unknown;
  /** Stable hint for downstream debugging — e.g. 'created 100 entities'. */
  note?: string;
}

export interface PlannerResult {
  delta: WorldStateDelta;
  evidence: PlannerEvidence[];
}
