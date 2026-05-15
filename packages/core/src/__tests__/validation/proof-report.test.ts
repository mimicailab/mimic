/**
 * Phase 11 — Proof report tests.
 *
 *   - Every hard clause in a passing smoke contract produces a ProofRecord.
 *   - Missing proof for a hard clause surfaces in `missing` (callers can
 *     fail the run on it; the pipeline does this in Phase 12).
 *   - Proof artifact carries a versioned schema (`proofVersion: 1`).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { canonicaliseContract } from '../../contract/canonicaliser.js';
import {
  runPreGenerationGate,
  runPlanners,
} from '../../planner/index.js';
import {
  createWorldState,
  SeededRandom,
} from '../../world/index.js';
import {
  runProjection,
  __resetProjectorHints,
} from '../../projection/index.js';
import { evaluateContract } from '../../validation/contract-evaluator.js';
import {
  buildProofArtifact,
  PROOF_VERSION,
} from '../../validation/proof-report.js';
import type {
  AnchorClause,
  Clause,
  CountClause,
} from '../../contract/clause-types.js';
import type { PersonaContract } from '../../contract/persona-contract.js';

function makeContract(clauses: Clause[]): PersonaContract {
  return canonicaliseContract({
    personaId: 'p',
    domain: 'test',
    persona: { name: 'T', age: 30, occupation: 'eng', location: 'SF', salary: null, description: '' },
    source: { name: 'T', description: '' },
    clauses,
    anchors: [],
    compiledAt: new Date().toISOString(),
    compilerVersion: 'v5',
  });
}

beforeEach(() => __resetProjectorHints());

function pipeline(clauses: Clause[]) {
  const contract = makeContract(clauses);
  const gate = runPreGenerationGate(contract);
  if (!gate.ok) throw new Error('gate failed');
  const initial = createWorldState(new SeededRandom(1));
  const { state, evidence } = runPlanners(contract, gate.obligationGraph, initial);
  const { dataset } = runProjection(state);
  const evaluation = evaluateContract(contract, state, dataset, gate.obligationGraph);
  return { contract, graph: gate.obligationGraph, state, dataset, evaluation, evidence };
}

describe('proof report', () => {
  it('emits one proof record per hard clause and carries proofVersion=1', () => {
    const count: CountClause = {
      id: 'c',
      quote: '3 stripe customers',
      family: 'count',
      strength: 'hard',
      target: { surface: 'api', name: 'stripe.customer' },
      expected: 3,
    };
    const anchor: AnchorClause = {
      id: 'klein',
      quote: 'Klein duplicate charge',
      family: 'anchor',
      strength: 'hard',
      anchorId: 'klein-dup',
      customer: 'Klein Records',
      dates: { event: '2026-04-29' },
    };
    const p = pipeline([count, anchor]);
    const result = buildProofArtifact({
      runId: 'run-1',
      contract: p.contract,
      graph: p.graph,
      evaluation: p.evaluation,
      plannerEvidence: p.evidence,
      now: () => '2026-05-15T00:00:00.000Z',
    });
    expect(result.artifact.proofVersion).toBe(PROOF_VERSION);
    expect(result.artifact.runId).toBe('run-1');
    expect(result.missing).toEqual([]);
    expect(result.artifact.records).toHaveLength(2);
    const byId = new Map(result.artifact.records.map((r) => [r.clauseId, r]));
    expect(byId.get('c')?.ownerId).toBe('population');
    expect(byId.get('klein')?.ownerId).toBe('anchor');
    expect(byId.get('c')?.evidence.materialisedQuery).toBe('api.stripe.customer');
    expect(byId.get('c')?.evidence.worldQuery).toContain('population:api:stripe.customer');
  });

  it('skips soft and narrative clauses entirely', () => {
    const hard: CountClause = {
      id: 'h',
      quote: '5 customers',
      family: 'count',
      strength: 'hard',
      target: { surface: 'api', name: 'stripe.customer' },
      expected: 5,
    };
    const soft: CountClause = {
      id: 's',
      quote: 'maybe 5',
      family: 'count',
      strength: 'soft',
      target: { surface: 'api', name: 'stripe.customer' },
      expected: 5,
    };
    const p = pipeline([hard, soft]);
    const result = buildProofArtifact({
      runId: 'r',
      contract: p.contract,
      graph: p.graph,
      evaluation: p.evaluation,
      plannerEvidence: p.evidence,
    });
    expect(result.artifact.records.map((r) => r.clauseId)).toEqual(['h']);
  });

  it('surfaces failed-evaluation hard clauses as missing proof', () => {
    const count: CountClause = {
      id: 'unmet',
      quote: '5 stripe customers',
      family: 'count',
      strength: 'hard',
      target: { surface: 'api', name: 'stripe.customer' },
      expected: 5,
    };
    const p = pipeline([count]);
    // Force the evaluation to mark the clause failed (simulate a bad
    // projection that the validator would have caught).
    const synthetic = {
      ...p.evaluation,
      evaluations: p.evaluation.evaluations.map((e) =>
        e.clauseId === 'unmet'
          ? {
              ...e,
              passed: false,
              reason: 'forced for test',
              quote: 'forced for test',
              predicate: 'forced',
              source: 'planner' as const,
              ownerId: 'population' as const,
            }
          : e,
      ),
    };
    const result = buildProofArtifact({
      runId: 'r',
      contract: p.contract,
      graph: p.graph,
      evaluation: synthetic,
      plannerEvidence: p.evidence,
    });
    expect(result.artifact.records).toHaveLength(0);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]!.clauseId).toBe('unmet');
  });
});
