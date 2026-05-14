/**
 * V4.5 — Layer 6: Fidelity validator.
 *
 * Asks: "Did we build the RIGHT data?" — evaluates the final expanded data
 * against the ORIGINAL PersonaContract clauses, not just the lowered Claim
 * subset. Structural correctness is already established upstream by the
 * existing claim-auditor / repair loop; this gate closes the V3 blind spot
 * where a persona requirement could disappear silently between extraction
 * and audit.
 *
 * Per private/v4.5.md:
 *   - Each hard clause either passes or yields a clause-level failure.
 *   - Soft and narrative clauses report `not_checked` but never block.
 *   - Helper-routed clauses (reconciliation, temporal_gap, cross_surface)
 *     run via dedicated checkers.
 *   - Lowered (executable_now) clauses re-run their predicate against the
 *     original quote so the failure surfaces with the persona text.
 */

import type { PersonaContract, CoverageReport } from '../contract/persona-contract.js';
import type {
  Clause,
  CountClause,
  AggregateClause,
  DistributionClause,
  TemporalClause,
  AnchorClause,
  CrossSurfaceClause,
  ReconciliationClause,
} from '../contract/clause-types.js';
import type { ExpandedData } from '../types/dataset.js';
import type { Blueprint, Anchor } from '../types/blueprint.js';
import type { LoweringResult } from '../contract/lowering.js';
import type { AuditResult } from '../types/claim.js';
import { selectRows } from '../generate/claim-auditor.js';
import { checkReconciliation } from './helper-checkers/reconciliation.js';
import { checkTemporalGap } from './helper-checkers/temporal-consistency.js';
import { checkCrossSurfaceDrift } from './helper-checkers/cross-surface-drift.js';
import { checkAnchorMultiplicity } from './helper-checkers/anchor-multiplicity.js';
import { checkSemanticDistribution } from './helper-checkers/semantic-distribution.js';
import { describeSemanticTarget, resolveSemanticTarget } from '../contract/semantic-capabilities.js';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type FidelityFailureSource =
  | 'extraction' // clause never became executable coverage
  | 'lowering' // clause mapped to the wrong target resource
  | 'generation' // right target, wrong count or wrong bound anchor
  | 'projection'; // world satisfied, surface translation broke it

export interface FidelityEvaluation {
  clauseId: string;
  family: Clause['family'];
  strength: Clause['strength'];
  passed: boolean;
  /** When `passed=false && !skipped`, a one-line predicate description. */
  predicate?: string;
  /** Actual measured value, structured per checker. */
  actual?: unknown;
  /** Human-readable failure explanation. */
  reason?: string;
  /** Persona quote (for error reports). */
  quote: string;
  /** When the helper / lowering decision was applied. */
  ruleId?: string;
  /** True for soft / narrative / unsupported_blocking clauses we did not run. */
  skipped: boolean;
  /** When `passed=false`, the most likely failure source for routing repair. */
  source?: FidelityFailureSource;
}

export interface FidelityResult {
  /** Per-clause evaluations in input order. */
  evaluations: FidelityEvaluation[];
  /** Convenience: hard-clause failures. */
  failures: FidelityEvaluation[];
  /** True iff no HARD clause failed. Soft failures never tip this. */
  passed: boolean;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface RunFidelityOptions {
  /**
   * Result of the structural audit (claim-auditor). When supplied, the
   * fidelity validator reuses the auditor's verdict for executable_now
   * clauses instead of re-evaluating, and points failures at the original
   * persona quote.
   */
  structuralAudit?: AuditResult;
  /** Loweing artefact — needed to map back from Claim id → Clause id. */
  lowering: LoweringResult;
  blueprint: Blueprint;
  expanded: ExpandedData;
}

export function runFidelity(
  contract: PersonaContract,
  coverage: CoverageReport,
  options: RunFidelityOptions,
): FidelityResult {
  const { structuralAudit, lowering, blueprint, expanded } = options;
  const decisionById = new Map(coverage.decisions.map((d) => [d.clauseId, d]));
  // Build a reverse index: lowered claim id → clause id.
  const claimIdToClauseId = new Map<string, string>();
  for (const [clauseId, claimIds] of Object.entries(lowering.clauseIdToClaimIds)) {
    for (const cid of claimIds) claimIdToClauseId.set(cid, clauseId);
  }

  const evaluations: FidelityEvaluation[] = [];

  for (const clause of contract.clauses) {
    const decision = decisionById.get(clause.id);
    const ruleId = decision?.ruleId;
    if (!decision) {
      evaluations.push({
        clauseId: clause.id,
        family: clause.family,
        strength: clause.strength,
        quote: clause.quote,
        passed: clause.strength === 'soft',
        skipped: true,
        reason: 'No coverage decision available — extraction failure.',
        source: clause.strength === 'soft' ? undefined : 'extraction',
      });
      continue;
    }

    if (decision.status === 'unsupported_blocking') {
      evaluations.push({
        clauseId: clause.id,
        family: clause.family,
        strength: clause.strength,
        quote: clause.quote,
        passed: false,
        skipped: true,
        ruleId,
        reason: decision.explanation,
        source: 'extraction',
      });
      continue;
    }

    if (decision.status === 'soft_only') {
      evaluations.push({
        clauseId: clause.id,
        family: clause.family,
        strength: clause.strength,
        quote: clause.quote,
        passed: true,
        skipped: true,
        ruleId,
        reason: decision.explanation,
      });
      continue;
    }

    if (decision.status === 'executable_now') {
      evaluations.push(
        evaluateExecutable(clause, structuralAudit, lowering, blueprint, expanded, ruleId),
      );
      continue;
    }

    // executable_with_helper
    evaluations.push(evaluateWithHelper(clause, blueprint, expanded, contract.anchors, ruleId));
  }

  const failures = evaluations.filter(
    (e) => !e.passed && e.strength === 'hard',
  );
  return {
    evaluations,
    failures,
    passed: failures.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Per-clause evaluation
// ---------------------------------------------------------------------------

function evaluateExecutable(
  clause: Clause,
  audit: AuditResult | undefined,
  lowering: LoweringResult,
  blueprint: Blueprint,
  expanded: ExpandedData,
  ruleId: string | undefined,
): FidelityEvaluation {
  // Anchor-family executable clauses: structural binding is enforced
  // upstream; we still verify at least one materialised row exists.
  if (clause.family === 'anchor') {
    const result = checkAnchorMultiplicity(clause as AnchorClause, blueprint, expanded);
    return {
      clauseId: clause.id,
      family: clause.family,
      strength: clause.strength,
      quote: clause.quote,
      passed: result.passed,
      skipped: false,
      ruleId,
      actual: result,
      reason: result.reason,
      source: result.passed ? undefined : 'generation',
    };
  }

  // Otherwise, locate the lowered claim and use the structural audit if
  // available, else compute the predicate directly here for a clean result.
  const loweredIds = lowering.clauseIdToClaimIds[clause.id] ?? [];
  const evals = (audit?.evaluations ?? []).filter((e) =>
    loweredIds.includes(e.claim.id),
  );
  if (evals.length > 0) {
    const failed = evals.find((e) => !e.passed);
    if (failed) {
      return {
        clauseId: clause.id,
        family: clause.family,
        strength: clause.strength,
        quote: clause.quote,
        passed: false,
        skipped: false,
        ruleId,
        predicate: failed.predicate,
        actual: failed.actual,
        reason: `Lowered claim ${failed.claim.id} failed audit.`,
        source: 'generation',
      };
    }
    return {
      clauseId: clause.id,
      family: clause.family,
      strength: clause.strength,
      quote: clause.quote,
      passed: true,
      skipped: false,
      ruleId,
      predicate: evals[0]!.predicate,
      actual: evals[0]!.actual,
    };
  }

  // Fallback: compute the predicate directly (no structural audit was run,
  // or the lowering produced no claim). This handles unit-test paths.
  return computeDirect(clause, expanded, ruleId);
}

function evaluateWithHelper(
  clause: Clause,
  blueprint: Blueprint,
  expanded: ExpandedData,
  anchors: Anchor[],
  ruleId: string | undefined,
): FidelityEvaluation {
  switch (clause.family) {
    case 'reconciliation': {
      const result = checkReconciliation(clause as ReconciliationClause, expanded);
      return {
        clauseId: clause.id,
        family: clause.family,
        strength: clause.strength,
        quote: clause.quote,
        passed: result.passed,
        skipped: false,
        ruleId,
        actual: result,
        reason: result.reason,
        source: result.passed ? undefined : 'generation',
      };
    }
    case 'temporal': {
      if ((clause as TemporalClause).kind !== 'relative_gap') {
        return {
          clauseId: clause.id,
          family: clause.family,
          strength: clause.strength,
          quote: clause.quote,
          passed: false,
          skipped: true,
          ruleId,
          reason: 'Temporal helper supports only relative_gap; window is executable_now.',
          source: 'lowering',
        };
      }
      const result = checkTemporalGap(
        clause as TemporalClause & { kind: 'relative_gap' },
        anchors,
      );
      return {
        clauseId: clause.id,
        family: clause.family,
        strength: clause.strength,
        quote: clause.quote,
        passed: result.passed,
        skipped: false,
        ruleId,
        actual: result,
        reason: result.reason,
        source: result.passed ? undefined : 'generation',
      };
    }
    case 'cross_surface': {
      const result = checkCrossSurfaceDrift(clause as CrossSurfaceClause, expanded);
      return {
        clauseId: clause.id,
        family: clause.family,
        strength: clause.strength,
        quote: clause.quote,
        passed: result.passed,
        skipped: false,
        ruleId,
        actual: result,
        reason: result.reason,
        source: result.passed ? undefined : 'projection',
      };
    }
    case 'distribution': {
      const result = checkSemanticDistribution(clause as DistributionClause, expanded);
      return {
        clauseId: clause.id,
        family: clause.family,
        strength: clause.strength,
        quote: clause.quote,
        passed: result.passed,
        skipped: false,
        ruleId,
        actual: result.actual,
        reason: result.reason,
        source: result.passed ? undefined : 'generation',
      };
    }
    default:
      return {
        clauseId: clause.id,
        family: clause.family,
        strength: clause.strength,
        quote: clause.quote,
        passed: false,
        skipped: true,
        ruleId,
        reason: `No helper registered for family=${clause.family}.`,
        source: 'lowering',
      };
  }
  // No-op: void to silence noUnusedParameters when called paths skip blueprint.
  void blueprint;
}

function computeDirect(
  clause: Clause,
  expanded: ExpandedData,
  ruleId: string | undefined,
): FidelityEvaluation {
  switch (clause.family) {
    case 'count': {
      const c = clause as CountClause;
      const target = resolveClauseTarget(c);
      if (!target) {
        return missingExecutionTarget(c, ruleId);
      }
      const rows = selectRows(target, expanded);
      const tol = c.tolerance ?? 0;
      const passed = Math.abs(rows.length - c.expected) <= tol;
      return {
        clauseId: c.id,
        family: c.family,
        strength: c.strength,
        quote: c.quote,
        passed,
        skipped: false,
        ruleId,
        predicate: `count(${formatTargetLabel(c, target)}) = ${c.expected}${tol ? ` (±${tol})` : ''}`,
        actual: rows.length,
        reason: passed ? undefined : `Got ${rows.length}, expected ${c.expected}.`,
        source: passed ? undefined : 'generation',
      };
    }
    case 'aggregate': {
      const c = clause as AggregateClause;
      const target = resolveClauseTarget(c);
      if (!target) {
        return missingExecutionTarget(c, ruleId);
      }
      const rows = selectRows(target, expanded);
      let sum = 0;
      for (const r of rows) sum += toNumber(r[c.field]);
      const value = c.op === 'avg' ? (rows.length === 0 ? 0 : sum / rows.length) : sum;
      const tol = c.tolerance ?? 0;
      const passed = Math.abs(value - c.expected) <= tol;
      return {
        clauseId: c.id,
        family: c.family,
        strength: c.strength,
        quote: c.quote,
        passed,
        skipped: false,
        ruleId,
        predicate: `${c.op}(${formatTargetLabel(c, target)}.${c.field}) = ${c.expected}${tol ? ` (±${tol})` : ''}`,
        actual: value,
        reason: passed ? undefined : `Got ${value}, expected ${c.expected}.`,
        source: passed ? undefined : 'generation',
      };
    }
    case 'distribution': {
      const c = clause as DistributionClause;
      const target = resolveClauseTarget(c);
      if (!target) {
        return missingExecutionTarget(c, ruleId);
      }
      const rows = selectRows(target, expanded);
      const counts: Record<string, number> = {};
      for (const r of rows) {
        const v = String(r[c.field] ?? '');
        counts[v] = (counts[v] ?? 0) + 1;
      }
      const tol = c.tolerance ?? 2;
      const actualPct: Record<string, number> = {};
      const total = rows.length;
      const misses: string[] = [];
      for (const [k, expected] of Object.entries(c.values)) {
        const pct = total === 0 ? 0 : (counts[k] ?? 0) / total * 100;
        actualPct[k] = pct;
        if (Math.abs(pct - expected) > tol) {
          misses.push(`${k}: expected ${expected}%, got ${pct.toFixed(1)}%`);
        }
      }
      const passed = misses.length === 0;
      return {
        clauseId: c.id,
        family: c.family,
        strength: c.strength,
        quote: c.quote,
        passed,
        skipped: false,
        ruleId,
        predicate: `distribution(${c.field}) ≈ ${JSON.stringify(c.values)} (±${tol}pp)`,
        actual: actualPct,
        reason: passed ? undefined : misses.join('; '),
        source: passed ? undefined : 'generation',
      };
    }
    case 'temporal': {
      const c = clause as TemporalClause;
      if (c.kind === 'window') {
        const target = resolveClauseTarget(c);
        if (!target) {
          return missingExecutionTarget(c, ruleId);
        }
        const rows = selectRows(target, expanded);
        const min = new Date(c.min).getTime();
        const max = new Date(c.max).getTime();
        const inWindow = rows.filter((r) => {
          const v = r[c.field];
          const ms = toMillis(v);
          return ms != null && ms >= min && ms <= max;
        });
        const tol = c.tolerance ?? 0;
        const passed = Math.abs(inWindow.length - c.expected) <= tol;
        return {
          clauseId: c.id,
          family: c.family,
          strength: c.strength,
          quote: c.quote,
          passed,
          skipped: false,
          ruleId,
          predicate: `count(${formatTargetLabel(c, target)} where ${c.field} ∈ [${c.min}, ${c.max}]) = ${c.expected}`,
          actual: inWindow.length,
          reason: passed ? undefined : `Got ${inWindow.length} in-window rows, expected ${c.expected}.`,
          source: passed ? undefined : 'generation',
        };
      }
      // relative_gap should never reach computeDirect — coverage planner marks it helper.
      return {
        clauseId: c.id,
        family: c.family,
        strength: c.strength,
        quote: c.quote,
        passed: false,
        skipped: true,
        ruleId,
        reason: 'relative_gap is helper-only; not directly computable.',
        source: 'lowering',
      };
    }
    default:
      return {
        clauseId: clause.id,
        family: clause.family,
        strength: clause.strength,
        quote: clause.quote,
        passed: false,
        skipped: true,
        ruleId,
        reason: `computeDirect: no fallback for family=${clause.family}.`,
        source: 'lowering',
      };
  }
}

function resolveClauseTarget(
  clause: CountClause | AggregateClause | DistributionClause | Extract<TemporalClause, { kind: 'window' }>,
) {
  if (clause.semanticTarget) {
    return resolveSemanticTarget(clause.semanticTarget)?.target;
  }
  return clause.target;
}

function formatTargetLabel(
  clause: CountClause | AggregateClause | DistributionClause | Extract<TemporalClause, { kind: 'window' }>,
  target: { surface: 'db' | 'api'; name: string },
): string {
  if (clause.semanticTarget) {
    return describeSemanticTarget(clause.semanticTarget);
  }
  return `${target.surface}.${target.name}`;
}

function missingExecutionTarget(
  clause: Clause,
  ruleId: string | undefined,
): FidelityEvaluation {
  return {
    clauseId: clause.id,
    family: clause.family,
    strength: clause.strength,
    quote: clause.quote,
    passed: false,
    skipped: true,
    ruleId,
    reason: 'No executable target was available for direct fidelity evaluation.',
    source: 'lowering',
  };
}

// ---------------------------------------------------------------------------
// Pretty-printer (Markdown — used by the compliance report)
// ---------------------------------------------------------------------------

export function formatFidelityFailures(result: FidelityResult): string {
  if (result.failures.length === 0) return '';
  const lines: string[] = [];
  lines.push(`Fidelity: ${result.failures.length} of ${result.evaluations.length} clauses failed.`);
  for (const f of result.failures) {
    lines.push('');
    lines.push(`  FAIL ${f.clauseId} (${f.family}, source=${f.source ?? 'unknown'}): "${f.quote}"`);
    if (f.predicate) lines.push(`    predicate: ${f.predicate}`);
    if (f.actual !== undefined) {
      lines.push(`    actual:    ${typeof f.actual === 'object' ? JSON.stringify(f.actual) : String(f.actual)}`);
    }
    if (f.reason) lines.push(`    reason:    ${f.reason}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Small numeric helpers (duplicated rather than re-exported to keep deps tight)
// ---------------------------------------------------------------------------

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

function toMillis(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}
