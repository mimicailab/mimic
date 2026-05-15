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
  const ownerLabels = collectFailureOwners(report.failures);
  const lines: string[] = [
    `Owner-level failure (${report.cause}): ${report.clauseIds.length} clause(s) still failing${ownerLabels.length > 0 ? ` across ${ownerLabels.join(', ')}` : ''}.`,
  ];
  if (report.cause === 'regen_exhausted') {
    lines.push(`  First failing planner: "${report.ownerId}".`);
  }
  if (report.attempts > 0) {
    lines.push(`  Attempts: ${report.attempts}.`);
  }
  for (let i = 0; i < report.clauseIds.length; i++) {
    const failure = report.failures[i];
    const ownerLabel = hasOwnerId(failure) ? failure.ownerId ?? 'unowned' : 'unowned';
    lines.push(`  · [owner=${ownerLabel}] ${report.clauseIds[i]}: "${report.quotes[i] ?? ''}"`);
  }
  return lines.join('\n');
}

function collectFailureOwners(
  failures: Array<ContractEvaluationFailure | ShapeFailure>,
): string[] {
  const seen = new Set<string>();
  for (const failure of failures) {
    if (!hasOwnerId(failure) || !failure.ownerId) continue;
    seen.add(failure.ownerId);
  }
  return [...seen];
}

function hasOwnerId(
  failure: ContractEvaluationFailure | ShapeFailure | undefined,
): failure is (ContractEvaluationFailure | Extract<ShapeFailure, { ownerId?: string }>) & {
  ownerId?: string;
} {
  return failure !== undefined && 'ownerId' in failure;
}
