/**
 * V5 — Phase 11: Proof report.
 *
 * Each run that reaches `clean` on both gates emits one `ProofRecord` per
 * hard clause, tying the clause back to its owning planner and the
 * evidence that satisfied it.
 *
 * Schema is versioned (`proofVersion: 1`) so Phase 12's `mimic explain`
 * can warn on stale artifacts.
 *
 * Disk write (`.mimic/proof/<runId>.json`) and the `mimic explain` CLI
 * subcommand land in Phase 12. This module builds the in-memory record
 * set; the pipeline driver decides when to persist.
 */

import type {
  ClauseId,
  OwnerId,
} from '../contract/clause-types.js';
import type { PersonaContract as PersonaContractType } from '../contract/persona-contract.js';
import type { ObligationGraph } from '../planner/obligation-graph.js';
import type { PlannerEvidence } from '../planner/planner-result.js';
import type { ContractEvaluation } from './contract-evaluator.js';

export const PROOF_VERSION = 1 as const;

export interface ProofEvidence {
  /** Stable canonical query — describes how to find this clause's row set
   *  in the canonical world state (population / metric / cohort). */
  worldQuery: string;
  /** Stable surface query — describes where to verify on the projected
   *  dataset (surface / target / filter / window). */
  materialisedQuery: string;
  /** What the evaluator actually observed. */
  observed: unknown;
}

export interface ProofRecord {
  clauseId: ClauseId;
  quote: string;
  ownerId: OwnerId;
  evidence: ProofEvidence;
}

export interface ProofArtifact {
  proofVersion: typeof PROOF_VERSION;
  runId: string;
  emittedAt: string;
  records: ProofRecord[];
}

export interface MissingProofError {
  clauseId: ClauseId;
  quote: string;
  reason: string;
}

export interface ProofResult {
  artifact: ProofArtifact;
  /** Hard clauses for which no proof could be produced. */
  missing: MissingProofError[];
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface BuildProofOptions {
  runId: string;
  contract: PersonaContractType;
  graph: ObligationGraph;
  evaluation: { evaluations: ContractEvaluation[] };
  plannerEvidence: PlannerEvidence[];
  /** Override the timestamp (test seam). */
  now?: () => string;
}

export function buildProofArtifact(opts: BuildProofOptions): ProofResult {
  const records: ProofRecord[] = [];
  const missing: MissingProofError[] = [];
  const now = opts.now ?? (() => new Date().toISOString());

  // Index helpful lookup maps
  const passByClauseId = new Map<ClauseId, ContractEvaluation>();
  for (const e of opts.evaluation.evaluations) {
    passByClauseId.set(e.clauseId, e);
  }
  const evidenceByClauseId = new Map<ClauseId, PlannerEvidence>();
  for (const e of opts.plannerEvidence) {
    // First-write-wins so the OWNER's evidence is preferred over
    // identity planner's bookkeeping records.
    if (!evidenceByClauseId.has(e.clauseId)) {
      evidenceByClauseId.set(e.clauseId, e);
    }
  }

  for (const clause of opts.contract.clauses) {
    if (clause.strength !== 'hard') continue;
    if (clause.family === 'narrative') continue;

    const node = opts.graph.byClauseId.get(clause.id);
    if (!node) {
      missing.push({
        clauseId: clause.id,
        quote: clause.quote,
        reason: 'no obligation node — hard clause was not assigned to a planner',
      });
      continue;
    }

    const passed = passByClauseId.get(clause.id);
    if (passed && !(passed as { passed?: boolean }).passed) {
      missing.push({
        clauseId: clause.id,
        quote: clause.quote,
        reason: 'contract evaluator failed for this clause; proof artifact is reserved for passing runs',
      });
      continue;
    }

    const evidence = evidenceByClauseId.get(clause.id);
    const observed = evidence?.observed ?? null;
    records.push({
      clauseId: clause.id,
      quote: clause.quote,
      ownerId: node.ownerId,
      evidence: {
        worldQuery: buildWorldQuery(clause),
        materialisedQuery: buildMaterialisedQuery(clause),
        observed,
      },
    });
  }

  return {
    artifact: {
      proofVersion: PROOF_VERSION,
      runId: opts.runId,
      emittedAt: now(),
      records,
    },
    missing,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildWorldQuery(clause: PersonaContractType['clauses'][number]): string {
  const ct = clause.canonicalTarget;
  if (!ct) return `clause:${clause.id}`;
  const parts = [`population:${ct.populationId}`];
  if (ct.metricId) parts.push(`metric:${ct.metricId}`);
  if (ct.window) parts.push(`window:${ct.window.start}..${ct.window.end}`);
  if (ct.cohortRule) parts.push(`cohort:${JSON.stringify(ct.cohortRule)}`);
  return parts.join('/');
}

function buildMaterialisedQuery(clause: PersonaContractType['clauses'][number]): string {
  switch (clause.family) {
    case 'count':
    case 'aggregate':
    case 'distribution':
      return clause.target
        ? `${clause.target.surface}.${clause.target.name}`
        : `semantic:${clause.semanticTarget?.kind ?? '?'}`;
    case 'temporal':
      if (clause.kind === 'window') {
        return clause.target ? `${clause.target.surface}.${clause.target.name}` : 'lifecycle';
      }
      return `gap:${clause.anchorA}->${clause.anchorB}`;
    case 'anchor':
      return `anchor:${clause.anchorId}`;
    case 'cross_surface':
      return `${clause.surfaceA.surface}.${clause.surfaceA.name} vs ${clause.surfaceB.surface}.${clause.surfaceB.name}`;
    case 'reconciliation':
      return `reconciliation:${clause.metric}`;
    case 'narrative':
      return 'narrative';
  }
}
