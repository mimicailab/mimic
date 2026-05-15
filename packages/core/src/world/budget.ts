/**
 * V5 — Phase 5: Budget ledgers.
 *
 * Reconciliation clauses describe "total = sum(parts)" requirements. The
 * reconciliation planner writes one `BudgetLedger` per such clause and
 * asserts sum identity post-write. A failure to balance throws a planner
 * error — V5 forbids semantic patching of output.
 */

export type BudgetId = string;

export interface BudgetLedger {
  id: BudgetId;
  /** Headline target (signed — e.g. -4820 for an MRR drop). */
  total: number;
  /**
   * Named contributions. Key is the bucket name (e.g. `churn`,
   * `downgrade`); value is the signed contribution.
   */
  parts: Map<string, number>;
  /** Tolerance for the sum identity check (≥ 0). */
  tolerance: number;
}

/**
 * Compute the current part-sum of a ledger. Used by the reconciliation
 * planner to assert sum identity post-write.
 */
export function ledgerPartSum(ledger: BudgetLedger): number {
  let sum = 0;
  for (const v of ledger.parts.values()) sum += v;
  return sum;
}

/**
 * Check whether a ledger currently balances within tolerance. Throws when
 * called by a planner whose written deltas violate the invariant.
 */
export function ledgerBalances(ledger: BudgetLedger): boolean {
  return Math.abs(ledgerPartSum(ledger) - ledger.total) <= ledger.tolerance;
}

export class BudgetIdentityError extends Error {
  constructor(public readonly ledger: BudgetLedger) {
    super(
      `Budget ledger "${ledger.id}" violates sum identity: parts sum to ` +
        `${ledgerPartSum(ledger)}, total is ${ledger.total}, tolerance ${ledger.tolerance}.`,
    );
    this.name = 'BudgetIdentityError';
  }
}

export function assertLedgerBalances(ledger: BudgetLedger): void {
  if (!ledgerBalances(ledger)) throw new BudgetIdentityError(ledger);
}
