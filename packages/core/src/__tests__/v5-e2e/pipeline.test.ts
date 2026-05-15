/**
 * Phase 12 — End-to-end pipeline tests.
 *
 * Drives `runPipeline` on a small set of fixture personas and asserts the
 * full V5 mermaid: canonicalise → gate → planners → projection →
 * contract evaluator (regen on fail) → shape validator (repair on
 * local-only; abort on owner-level) → proof artifact.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runPipeline, PROOF_VERSION } from '../../index.js';
import { __resetProjectorHints } from '../../projection/index.js';
import type {
  AnchorClause,
  Clause,
  CountClause,
  ReconciliationClause,
  TemporalClause,
} from '../../contract/clause-types.js';
import type { PersonaContract } from '../../contract/persona-contract.js';

function makeContract(clauses: Clause[]): PersonaContract {
  return {
    personaId: 'p',
    domain: 'test',
    persona: { name: 'T', age: 30, occupation: 'eng', location: 'SF', salary: null, description: '' },
    source: { name: 'T', description: '' },
    clauses,
    anchors: [],
    compiledAt: new Date().toISOString(),
    compilerVersion: 'v5',
  };
}

beforeEach(() => __resetProjectorHints());

describe('pipeline — clean run', () => {
  it('emits a proof artifact with one record per hard clause (raw targets)', () => {
    // Phase 12 happy-path uses raw targets that the V5 deterministic
    // projector materialises 1:1 (no per-adapter row shaping yet — that
    // is follow-on adapter-specific work tracked in Phase 13's TODOs).
    // Semantic-target lowering through the existing capability registry
    // still works in the contract evaluator; it just requires an
    // adapter-shaped projector before the materialised path can satisfy
    // a deep filter like `items.data.price.lookup_key`.
    const customers: CountClause = {
      id: 'customers-100',
      quote: '100 stripe customers',
      family: 'count',
      strength: 'hard',
      target: { surface: 'api', name: 'stripe.customer' },
      expected: 100,
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
    const failed: TemporalClause = {
      id: 'failed',
      quote: '8 failed charges this week',
      family: 'temporal',
      kind: 'window',
      strength: 'hard',
      target: { surface: 'api', name: 'stripe.charge', filter: { status: 'failed' } },
      field: 'created',
      min: '2026-05-08',
      max: '2026-05-15',
      expected: 8,
    };
    const result = runPipeline(makeContract([customers, anchor, failed]), undefined, {
      runId: 'r1',
      now: () => '2026-05-15T00:00:00.000Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proof.proofVersion).toBe(PROOF_VERSION);
    expect(result.proof.records).toHaveLength(3);
    const ids = result.proof.records.map((r) => r.clauseId).sort();
    expect(ids).toEqual(['customers-100', 'failed', 'klein']);
  });
});

describe('pipeline — gate fails before any planner runs', () => {
  it('returns pre_generation_gate with combined report on a sum-identity contradiction', () => {
    const recon: ReconciliationClause = {
      id: 'mrr',
      quote: 'MRR drop -$4820 explained',
      family: 'reconciliation',
      strength: 'hard',
      metric: 'mrr_change',
      headline: -4820,
      buckets: [
        { name: 'churn', value: -1000, target: { surface: 'api', name: 'stripe.subscription' }, field: 'mrr', op: 'sum' },
      ],
    };
    const result = runPipeline(makeContract([recon]), undefined, { runId: 'r-gate' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('pre_generation_gate');
    if (result.reason !== 'pre_generation_gate') return;
    expect(result.report.contradictions.some((c) => c.ruleId === 'sum_identity')).toBe(true);
  });
});

describe('pipeline — owner_level abort when evaluator cannot pass', () => {
  it('exhausts regen attempts on a clause the planner cannot satisfy and returns owner_level', () => {
    // Aggregate sum over `mrr` with expected=10_000 on a raw subscription
    // target — population planner creates entities without an `mrr`
    // attribute (no semantic data carrier yet), so the aggregate evaluator
    // reports sum=0 ≠ 10_000. Regen replays the reconciliation planner
    // (revenue aggregates route there) which doesn't change the entity
    // attrs, so we exhaust attempts.
    const agg: import('../../contract/clause-types.js').AggregateClause = {
      id: 'mrr',
      quote: '£10k MRR',
      family: 'aggregate',
      op: 'sum',
      strength: 'hard',
      field: 'mrr',
      expected: 10_000,
      target: { surface: 'api', name: 'stripe.subscription' },
    };
    const result = runPipeline(makeContract([agg]), undefined, { runId: 'r-owner' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('owner_level');
    if (result.reason !== 'owner_level') return;
    expect(result.report.cause).toBe('regen_exhausted');
    expect(result.report.ownerId).toBe('reconciliation');
    expect(result.report.clauseIds).toContain('mrr');
  });
});
