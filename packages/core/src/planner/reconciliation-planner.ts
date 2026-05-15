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
import type { BudgetLedger } from '../world/budget.js';
import { assertLedgerBalances } from '../world/budget.js';
import type { WorldState, WorldStateDelta } from '../world/world-state.js';
import type { ObligationGraph } from './obligation-graph.js';
import type { PlannerEvidence, PlannerResult } from './planner-result.js';

export function runReconciliationPlanner(
  contract: PersonaContract,
  graph: ObligationGraph,
  state: WorldState,
): PlannerResult {
  void contract;
  void state;
  const nodes = graph.byOwnerId.get('reconciliation') ?? [];
  const ledgers: Array<[string, BudgetLedger]> = [];
  const evidence: PlannerEvidence[] = [];

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
      const claim = node.budgetClaim;
      const ledger: BudgetLedger = {
        id: claim.metricId,
        total: claim.expected,
        parts: new Map([['total', claim.expected]]),
        tolerance: claim.tolerance,
      };
      assertLedgerBalances(ledger);
      ledgers.push([ledger.id, ledger]);
      evidence.push({
        clauseId: node.clauseId,
        observed: { metric: claim.metricId, op: claim.op, expected: claim.expected },
        note: `reconciliation planner stamped ${claim.metricId} headline`,
      });
    }
  }

  const delta: WorldStateDelta = { budgets: ledgers };
  return { delta, evidence };
}
