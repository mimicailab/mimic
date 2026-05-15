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

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export const MAX_REGEN_ATTEMPTS = 2 as const;
export const MAX_SHAPE_REPAIR_ATTEMPTS = 2 as const;

export interface RunPipelineContext {
  runId: string;
  /** PRNG seed; defaults to a stable test value. */
  seed?: number | string;
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

  // 1. Canonicalise — mutates clauses in place to attach canonical targets.
  canonicaliseContract(contract);

  // 2. Pre-generation gate.
  const gate = runPreGenerationGate(contract);
  if (!gate.ok) {
    return { ok: false, runId, reason: 'pre_generation_gate', report: gate.report };
  }
  const graph: ObligationGraph = gate.obligationGraph;

  // 3. Initial planner pass.
  const seed = ctx.seed ?? 1;
  let state: WorldState = createWorldState(new SeededRandom(seed));
  let evidence: PlannerEvidence[] = [];
  {
    const out = runPlanners(contract, graph, state);
    state = out.state;
    evidence = out.evidence;
  }

  // 4. Projection.
  let materialised = runProjection(state, schema).dataset;

  // 5. Contract evaluator + regen loop (bounded).
  let evaluation = evaluateContract(contract, state, materialised, graph);
  let regenAttempts = 0;
  while (!evaluation.passed && regenAttempts < MAX_REGEN_ATTEMPTS) {
    regenAttempts++;
    const firstFailure = evaluation.failures[0]!;
    const ownerId = firstFailure.ownerId;
    if (!ownerId) break;
    const regen = regenerateFromOwner(contract, graph, state, ownerId);
    state = regen.state;
    evidence = [...evidence, ...regen.evidence];
    materialised = runProjection(state, schema).dataset;
    evaluation = evaluateContract(contract, state, materialised, graph);
  }
  if (!evaluation.passed) {
    return {
      ok: false,
      runId,
      reason: 'owner_level',
      report: buildRegenExhaustedReport(evaluation.failures, regenAttempts),
    };
  }

  // 6. Shape validator + repair loop (bounded).
  let shape = validateShape(materialised, schema, state);
  let shapeAttempts = 0;
  while (
    shape.classification === 'local-only' &&
    shapeAttempts < MAX_SHAPE_REPAIR_ATTEMPTS
  ) {
    shapeAttempts++;
    const { repaired } = repairShape(materialised, shape.failures, schema);
    materialised = repaired;
    shape = validateShape(materialised, schema, state);
  }
  if (shape.classification === 'owner-level') {
    return {
      ok: false,
      runId,
      reason: 'owner_level',
      report: buildShapeOwnerReport(shape.failures),
    };
  }
  if (shape.classification === 'local-only') {
    // Repair did not converge within the bound — escalate.
    return {
      ok: false,
      runId,
      reason: 'owner_level',
      report: buildShapeOwnerReport(shape.failures),
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
  if (proof.missing.length > 0) {
    return {
      ok: false,
      runId,
      reason: 'owner_level',
      report: {
        cause: 'regen_exhausted',
        ownerId: graph.byClauseId.get(proof.missing[0]!.clauseId)?.ownerId ?? 'population',
        clauseIds: proof.missing.map((m) => m.clauseId),
        quotes: proof.missing.map((m) => m.quote),
        failures: [],
        attempts: regenAttempts,
      },
    };
  }

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
