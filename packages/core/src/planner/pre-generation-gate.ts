/**
 * V5 — Phase 4: Pre-generation gate.
 *
 * One gate, one decision, one report. The gate combines three checks into
 * a single composite verdict:
 *
 *   1. Canonicalisation — every hard clause has a non-`unresolved`
 *      `canonicalTarget` (Phase 3 attached `canonicalisationGap` on
 *      anything it could not resolve).
 *   2. Feasibility — all five rules in `feasibility.ts` pass.
 *   3. Owner coverage — every hard clause is assigned an owner planner by
 *      the rule table in `owners.ts`.
 *
 * The gate does NOT short-circuit: a contract with both a contradiction
 * AND a missing owner emits a report containing both. Only on a clean
 * sweep does the gate return `ok: true` with the obligation graph built
 * in the same pass.
 *
 * V5 contract: nothing downstream runs while the gate is failing.
 */

import type {
  CanonicalisationGap,
  Clause,
  OwnerId,
  TemporalClause,
} from '../contract/clause-types.js';
import type { PersonaContract } from '../contract/persona-contract.js';
import {
  runFeasibilityChecks,
  type ContradictionAndCoverageReport,
  type FeasibilityFailure,
  type MissingOwnerFailure,
} from './feasibility.js';
import {
  assignOwner,
  OWNERS_REGISTRY_VERSION,
  type OwnerAssignmentDecision,
} from './owners.js';
import {
  buildObligationGraph,
  buildObligationNode,
  type ObligationGraph,
  type ObligationNode,
} from './obligation-graph.js';

export type GateResult =
  | { ok: true; obligationGraph: ObligationGraph; ownerDecisions: OwnerAssignmentDecision[] }
  | { ok: false; report: ContradictionAndCoverageReport; ownerDecisions: OwnerAssignmentDecision[] };

/**
 * Single composite gate. The contract MUST have been canonicalised first
 * (Phase 3); the gate reads `clause.canonicalisationGap` directly rather
 * than re-running canonicalisation.
 */
export function runPreGenerationGate(contract: PersonaContract): GateResult {
  const hardClauses = contract.clauses.filter((c) => c.strength === 'hard');

  // 1. Canonicalisation gaps — pulled off the clauses the canonicaliser
  //    already marked.
  const canonicalisationGaps: CanonicalisationGap[] = [];
  for (const c of hardClauses) {
    if (c.canonicalisationGap) canonicalisationGaps.push(c.canonicalisationGap);
  }

  // 2. Feasibility checks.
  const feasibility = runFeasibilityChecks(contract.clauses);
  const contradictions: FeasibilityFailure[] = feasibility.failures;

  // 3. Owner assignment — done in the SAME pass as obligation-node
  //    construction so we never re-walk clauses.
  const ownerDecisions: OwnerAssignmentDecision[] = [];
  const missingOwners: MissingOwnerFailure[] = [];
  const nodes: ObligationNode[] = [];

  for (const c of contract.clauses) {
    const decision = assignOwner(c);
    ownerDecisions.push(decision);

    // Narrative clauses by design have no runtime owner — they're
    // documentation, not constraints. Skip them regardless of strength;
    // the LLM frequently emits factual narratives marked "hard" and the
    // gate shouldn't penalise that.
    if (c.family === 'narrative') continue;
    // Soft (non-narrative) clauses without owners don't fail the gate
    // either; they simply aren't part of the obligation graph.
    if (c.strength !== 'hard') continue;
    if (decision.ownerId == null) {
      missingOwners.push({
        clauseId: c.id,
        family: c.family,
        quote: c.quote,
        ownerRuleId: decision.ruleId,
        detail: decision.explanation,
      });
      continue;
    }
    // Hard clauses with canonicalisation gaps do NOT enter the graph,
    // even though their owner might match — Phase 4 requires clean
    // canonicalisation first.
    if (c.canonicalisationGap) continue;

    // Hard clauses without a canonical target (unresolved) are also
    // skipped from graph construction; the gap above already records
    // the failure if any.
    if (
      c.canonicalTarget == null ||
      c.canonicalTarget.populationId === 'unresolved'
    ) {
      if (!c.canonicalisationGap) {
        canonicalisationGaps.push({
          reason: `Hard clause ${c.id} has no canonical target attached.`,
          unresolvedText: clauseDiagnosticText(c),
          quote: c.quote,
        });
      }
      continue;
    }

    nodes.push(buildObligationNode(c, decision.ownerId as OwnerId));
  }

  const hasContradictions = contradictions.length > 0;
  const hasMissingOwners = missingOwners.length > 0;
  const hasGaps = canonicalisationGaps.length > 0;

  if (hasContradictions || hasMissingOwners || hasGaps) {
    return {
      ok: false,
      report: {
        contradictions,
        missingOwners,
        canonicalisationGaps,
        summary: formatSummary(contradictions, missingOwners, canonicalisationGaps),
      },
      ownerDecisions,
    };
  }

  return {
    ok: true,
    obligationGraph: buildObligationGraph(nodes),
    ownerDecisions,
  };
}

/**
 * Render a single human-readable rollup string. Useful for the CLI exit
 * message and Phase 11 proof rejections.
 */
export function formatGateReport(report: ContradictionAndCoverageReport): string {
  const lines: string[] = ['Pre-generation gate FAILED.', ''];
  if (report.contradictions.length > 0) {
    lines.push(`Contradictions (${report.contradictions.length}):`);
    for (const f of report.contradictions) {
      lines.push(`  · [${f.ruleId}] ${f.detail}`);
      for (let i = 0; i < f.clauseIds.length; i++) {
        lines.push(`      ${f.clauseIds[i]}: "${f.quotes[i] ?? ''}"`);
      }
    }
    lines.push('');
  }
  if (report.missingOwners.length > 0) {
    lines.push(`Missing owners (${report.missingOwners.length}) — registry ${OWNERS_REGISTRY_VERSION}:`);
    for (const m of report.missingOwners) {
      lines.push(`  · ${m.clauseId} (${m.family}): ${m.detail}`);
      lines.push(`      quote: "${m.quote}"`);
    }
    lines.push('');
  }
  if (report.canonicalisationGaps.length > 0) {
    lines.push(`Canonicalisation gaps (${report.canonicalisationGaps.length}):`);
    for (const g of report.canonicalisationGaps) {
      lines.push(`  · ${g.reason} (text: "${g.unresolvedText}")`);
      lines.push(`      quote: "${g.quote}"`);
    }
    lines.push('');
  }
  lines.push(report.summary);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSummary(
  contradictions: FeasibilityFailure[],
  missingOwners: MissingOwnerFailure[],
  gaps: CanonicalisationGap[],
): string {
  return (
    `Gate verdict: FAIL. ${contradictions.length} contradiction(s), ` +
    `${missingOwners.length} missing owner(s), ` +
    `${gaps.length} canonicalisation gap(s). ` +
    `No planner will run. (owners registry: ${OWNERS_REGISTRY_VERSION}.)`
  );
}

function clauseDiagnosticText(clause: Clause): string {
  if (clause.family === 'temporal') {
    const t = clause as TemporalClause;
    if (t.kind === 'window') return `temporal(${t.field}, ${t.min}..${t.max})`;
    return `temporal_gap(${t.anchorA}→${t.anchorB})`;
  }
  if (clause.family === 'cross_surface') return `cross_surface(${clause.entity})`;
  if (clause.family === 'anchor') return `anchor(${clause.anchorId})`;
  if (clause.family === 'reconciliation') return `reconciliation(${clause.metric})`;
  return clause.family;
}
