/**
 * V5 — Phase 12: Pipeline driver.
 *
 * Single entry point for the V5 runtime. Orchestrates the full
 * canonical-meaning → world-state → projection → validation → proof flow
 * exactly as specified in the v5.md mermaid:
 *
 *   canonicaliseContract
 *     → runPreGenerationGate (fail-fast or ObligationGraph)
 *     → runPlanners → WorldState
 *     → runProjection → MaterialisedDataset
 *     → evaluateContract (regen-from-owner on fail, bounded 2 attempts)
 *     → validateShape (local-only repair bounded 2 attempts; owner-level → abort)
 *     → buildProofArtifact
 *
 * The CLI (commands/run.ts) calls this directly. No V4.5 codepath remains.
 */

import type { PersonaContract } from './contract/persona-contract.js';
import type { SchemaModel } from './types/schema.js';
import type { ObligationGraph } from './planner/obligation-graph.js';
import type { WorldState } from './world/world-state.js';
import type { MaterialisedDataset } from './projection/types.js';
import type { ContractEvaluationFailure } from './validation/contract-evaluator.js';
import type { ShapeFailure } from './validation/shape-validator.js';
import type {
  OwnerLevelFailureReport,
} from './repair/owner-level-failure-report.js';
import type { ProofArtifact } from './validation/proof-report.js';
import type { ContradictionAndCoverageReport } from './planner/feasibility.js';
import type { OwnerId } from './contract/clause-types.js';

import { canonicaliseContract } from './contract/canonicaliser.js';
import { runPreGenerationGate } from './planner/pre-generation-gate.js';
import {
  runPlanners,
  regenerateFromOwner,
} from './planner/orchestrator.js';
import { createWorldState } from './world/world-state.js';
import { SeededRandom } from './world/prng.js';
import { runProjection } from './projection/projection-planner.js';
import { evaluateContract } from './validation/contract-evaluator.js';
import { validateShape } from './validation/shape-validator.js';
import { repairShape } from './repair/shape-repair.js';
import { buildProofArtifact } from './validation/proof-report.js';
import type { PlannerEvidence } from './planner/planner-result.js';
import { logger } from './utils/logger.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export const MAX_REGEN_ATTEMPTS = 2 as const;
export const MAX_SHAPE_REPAIR_ATTEMPTS = 2 as const;

export interface RunPipelineContext {
  runId: string;
  /** PRNG seed; defaults to a stable test value. */
  seed?: number | string;
  /**
   * 1-based persona index for this pipeline run. Threaded into WorldState
   * so projected IDs (e.g. `cus_p2_…`) namespace per-persona instead of
   * colliding across personas in the same workspace. Defaults to 1.
   */
  personaIndex?: number;
  /** Optional override of "now" used in the proof artifact. */
  now?: () => string;
}

export type PipelineResult =
  | {
      ok: true;
      runId: string;
      materialised: MaterialisedDataset;
      proof: ProofArtifact;
    }
  | {
      ok: false;
      runId: string;
      reason: 'pre_generation_gate';
      report: ContradictionAndCoverageReport;
    }
  | {
      ok: false;
      runId: string;
      reason: 'owner_level';
      report: OwnerLevelFailureReport;
    };

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function runPipeline(
  contract: PersonaContract,
  schema: SchemaModel | undefined,
  ctx: RunPipelineContext,
): PipelineResult {
  const runId = ctx.runId;
  logPipelineStage(runId, 'START', {
    clauseCount: contract.clauses.length,
    seed: ctx.seed ?? 1,
    personaIndex: ctx.personaIndex ?? 1,
  });

  // 1. Canonicalise — mutates clauses in place to attach canonical targets.
  canonicaliseContract(contract);
  logPipelineStage(runId, 'CANONICALISE', {
    clauses: contract.clauses.map((clause) => ({
      id: clause.id,
      family: clause.family,
      strength: clause.strength,
      canonicalTarget: clause.canonicalTarget,
    })),
  });

  // 2. Pre-generation gate.
  const gate = runPreGenerationGate(contract);
  if (!gate.ok) {
    logPipelineStage(runId, 'PRE-GENERATION GATE', {
      ok: false,
      report: gate.report,
    });
    return { ok: false, runId, reason: 'pre_generation_gate', report: gate.report };
  }
  const graph: ObligationGraph = gate.obligationGraph;
  logPipelineStage(runId, 'PRE-GENERATION GATE', {
    ok: true,
    nodeCount: graph.nodes.length,
    owners: Object.fromEntries(
      [...graph.byOwnerId.entries()].map(([ownerId, nodes]) => [ownerId, nodes.length]),
    ),
  });

  // 3. Initial planner pass.
  const seed = ctx.seed ?? 1;
  const personaIndex = ctx.personaIndex ?? 1;
  let state: WorldState = createWorldState(new SeededRandom(seed), personaIndex);
  let evidence: PlannerEvidence[] = [];
  {
    const out = runPlanners(contract, graph, state);
    state = out.state;
    evidence = out.evidence;
  }
  logPipelineStage(runId, 'PLANNERS INITIAL', {
    state: summariseState(state),
    evidenceCount: evidence.length,
  });

  // 4. Projection.
  let materialised = runProjection(state, schema).dataset;
  logPipelineStage(runId, 'PROJECTION INITIAL', summariseMaterialised(materialised));

  // 5. Contract evaluator + regen loop (bounded).
  let evaluation = evaluateContract(contract, state, materialised, graph);
  logPipelineStage(runId, 'EVALUATOR INITIAL', summariseEvaluation(evaluation));
  let regenAttempts = 0;
  while (!evaluation.passed && regenAttempts < MAX_REGEN_ATTEMPTS) {
    regenAttempts++;
    const firstFailure = evaluation.failures[0]!;
    const ownerId = firstFailure.ownerId;
    logPipelineStage(runId, `REGEN ATTEMPT ${regenAttempts} START`, {
      ownerId: ownerId ?? null,
      firstFailure,
      failures: evaluation.failures,
    });
    if (!ownerId) break;
    const regen = regenerateFromOwner(contract, graph, state, ownerId);
    state = regen.state;
    evidence = [...evidence, ...regen.evidence];
    materialised = runProjection(state, schema).dataset;
    evaluation = evaluateContract(contract, state, materialised, graph);
    logPipelineStage(runId, `REGEN ATTEMPT ${regenAttempts} END`, {
      ownerId,
      state: summariseState(state),
      materialised: summariseMaterialised(materialised),
      evaluation: summariseEvaluation(evaluation),
      evidenceCount: regen.evidence.length,
    });
  }
  if (!evaluation.passed) {
    const report = buildRegenExhaustedReport(evaluation.failures, regenAttempts);
    logPipelineStage(runId, 'PIPELINE ABORT', {
      reason: 'owner_level',
      stage: 'contract_evaluator',
      report,
    });
    return {
      ok: false,
      runId,
      reason: 'owner_level',
      report,
    };
  }

  // 6. Shape validator + repair loop (bounded).
  let shape = validateShape(materialised, schema, state);
  logPipelineStage(runId, 'SHAPE INITIAL', summariseShape(shape));
  let shapeAttempts = 0;
  while (
    shape.classification === 'local-only' &&
    shapeAttempts < MAX_SHAPE_REPAIR_ATTEMPTS
  ) {
    shapeAttempts++;
    logPipelineStage(runId, `SHAPE REPAIR ${shapeAttempts} START`, summariseShape(shape));
    const { repaired } = repairShape(materialised, shape.failures, schema, personaIndex);
    materialised = repaired;
    shape = validateShape(materialised, schema, state);
    logPipelineStage(runId, `SHAPE REPAIR ${shapeAttempts} END`, {
      materialised: summariseMaterialised(materialised),
      shape: summariseShape(shape),
    });
  }
  if (shape.classification === 'owner-level') {
    const report = buildShapeOwnerReport(shape.failures);
    logPipelineStage(runId, 'PIPELINE ABORT', {
      reason: 'owner_level',
      stage: 'shape_validator',
      report,
    });
    return {
      ok: false,
      runId,
      reason: 'owner_level',
      report,
    };
  }
  if (shape.classification === 'local-only') {
    // Repair did not converge within the bound — escalate.
    const report = buildShapeOwnerReport(shape.failures);
    logPipelineStage(runId, 'PIPELINE ABORT', {
      reason: 'owner_level',
      stage: 'shape_repair',
      report,
    });
    return {
      ok: false,
      runId,
      reason: 'owner_level',
      report,
    };
  }

  // 7. Proof artifact.
  const proof = buildProofArtifact({
    runId,
    contract,
    graph,
    evaluation,
    plannerEvidence: evidence,
    now: ctx.now,
  });
  logPipelineStage(runId, 'PROOF', {
    recordCount: proof.artifact.records.length,
    missing: proof.missing,
  });
  if (proof.missing.length > 0) {
    const report = {
      cause: 'regen_exhausted' as const,
      ownerId: graph.byClauseId.get(proof.missing[0]!.clauseId)?.ownerId ?? 'population',
      clauseIds: proof.missing.map((m) => m.clauseId),
      quotes: proof.missing.map((m) => m.quote),
      failures: [],
      attempts: regenAttempts,
    };
    logPipelineStage(runId, 'PIPELINE ABORT', {
      reason: 'owner_level',
      stage: 'proof',
      report,
    });
    return {
      ok: false,
      runId,
      reason: 'owner_level',
      report,
    };
  }

  logPipelineStage(runId, 'SUCCESS', {
    materialised: summariseMaterialised(materialised),
    proofRecords: proof.artifact.records.length,
  });
  return { ok: true, runId, materialised, proof: proof.artifact };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRegenExhaustedReport(
  failures: ContractEvaluationFailure[],
  attempts: number,
): OwnerLevelFailureReport {
  const firstOwner: OwnerId =
    (failures.find((f) => f.ownerId)?.ownerId as OwnerId) ?? 'population';
  return {
    cause: 'regen_exhausted',
    ownerId: firstOwner,
    clauseIds: failures.map((f) => f.clauseId),
    quotes: failures.map((f) => f.quote),
    failures,
    attempts,
  };
}

function buildShapeOwnerReport(failures: ShapeFailure[]): OwnerLevelFailureReport {
  const ownerLevel = failures.find((f) => f.scope === 'owner-level') as
    | Extract<ShapeFailure, { scope: 'owner-level' }>
    | undefined;
  const ownerId: OwnerId = ownerLevel?.ownerId ?? 'population';
  return {
    cause: 'shape_owner_level',
    ownerId,
    clauseIds: [],
    quotes: [],
    failures,
    attempts: 0,
  };
}

function logPipelineStage(runId: string, stage: string, data: unknown): void {
  logger.debugFile(`PIPELINE ${stage} [${runId}]`, data);
}

function summariseState(state: WorldState): Record<string, unknown> {
  return {
    populations: Object.fromEntries(
      [...state.populations.entries()].map(([populationId, entities]) => [populationId, entities.length]),
    ),
    identities: state.identities.size,
    lifecycleEvents: state.lifecycleEvents.length,
    anchors: state.anchors.size,
    budgets: state.budgets.size,
  };
}

function summariseMaterialised(materialised: MaterialisedDataset): Record<string, unknown> {
  return {
    tables: Object.fromEntries(
      Object.entries(materialised.tables).map(([table, rows]) => [table, rows.length]),
    ),
    apiResponses: Object.fromEntries(
      Object.entries(materialised.apiResponses).map(([adapterId, responseSet]) => [
        adapterId,
        Object.fromEntries(
          Object.entries(responseSet.responses).map(([resource, responses]) => [resource, responses.length]),
        ),
      ]),
    ),
  };
}

function summariseEvaluation(
  evaluation: ReturnType<typeof evaluateContract>,
): Record<string, unknown> {
  return {
    passed: evaluation.passed,
    failureCount: evaluation.failures.length,
    failures: evaluation.failures.map((failure) => ({
      clauseId: failure.clauseId,
      ownerId: failure.ownerId,
      family: failure.family,
      source: failure.source,
      predicate: failure.predicate,
      reason: failure.reason,
      actual: failure.actual,
    })),
  };
}

function summariseShape(shape: ReturnType<typeof validateShape>): Record<string, unknown> {
  return {
    classification: shape.classification,
    failureCount: shape.failures.length,
    failures: shape.failures,
  };
}
