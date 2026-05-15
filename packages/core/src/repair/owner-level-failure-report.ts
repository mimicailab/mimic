/**
 * V5 — Phase 10: Owner-level failure report.
 *
 * Emitted by either of two paths:
 *
 *   1. The contract evaluator failed twice in a row even after
 *      `regenerateFromOwner` was invoked (`cause: 'regen_exhausted'`).
 *   2. The shape validator returned `owner-level` (`cause:
 *      'shape_owner_level'`), or `local-only` repair exhausted its bound
 *      without converging.
 *
 * Both paths abort the run with the same shape so the CLI prints one
 * uniform report and humans triage from there.
 */

import type { ContractEvaluationFailure } from '../validation/contract-evaluator.js';
import type { ShapeFailure } from '../validation/shape-validator.js';

export type OwnerLevelFailureCause = 'regen_exhausted' | 'shape_owner_level';

export interface OwnerLevelFailureReport {
  cause: OwnerLevelFailureCause;
  ownerId: string;
  clauseIds: string[];
  quotes: string[];
  failures: Array<ContractEvaluationFailure | ShapeFailure>;
  /** How many regen rounds we tried (0 for shape_owner_level). */
  attempts: number;
}

/** Pretty-render for the CLI exit message. */
export function formatOwnerLevelFailureReport(report: OwnerLevelFailureReport): string {
  const lines: string[] = [
    `Owner-level failure (${report.cause}): planner "${report.ownerId}" cannot satisfy ${report.clauseIds.length} clause(s).`,
  ];
  if (report.attempts > 0) {
    lines.push(`  Attempts: ${report.attempts}.`);
  }
  for (let i = 0; i < report.clauseIds.length; i++) {
    lines.push(`  · ${report.clauseIds[i]}: "${report.quotes[i] ?? ''}"`);
  }
  return lines.join('\n');
}
