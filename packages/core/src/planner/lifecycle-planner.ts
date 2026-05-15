/**
 * V5 — Phase 6: Lifecycle planner.
 *
 * Owns: temporal_window clauses + temporal_gap clauses. Emits lifecycle
 * events (`start` / `renewal` / `failure` / `churn` / `refund` / …) into
 * the world state, distributing timestamps evenly across the window so
 * the contract evaluator's count-in-window check passes deterministically.
 */

import type { PersonaContract, } from '../contract/persona-contract.js';
import type { Clause, TemporalClause } from '../contract/clause-types.js';
import type { LifecycleEvent, LifecycleEventKind } from '../world/entity.js';
import type { WorldState, WorldStateDelta } from '../world/world-state.js';
import type { ObligationGraph } from './obligation-graph.js';
import type { PlannerEvidence, PlannerResult } from './planner-result.js';

export function runLifecyclePlanner(
  contract: PersonaContract,
  graph: ObligationGraph,
  state: WorldState,
): PlannerResult {
  const nodes = graph.byOwnerId.get('lifecycle') ?? [];
  const events: LifecycleEvent[] = [];
  const evidence: PlannerEvidence[] = [];

  for (const node of nodes) {
    if (node.budgetClaim.kind === 'temporal_window') {
      const populationId = node.canonicalEntities[0];
      // Prefer the clause's canonical population; fall back to any
      // populated roster so a temporal window on a derived/computed
      // population (e.g. api:stripe.charge events for paying customers)
      // can still attach events to actual entities.
      let pool = populationId ? state.populations.get(populationId) ?? [] : [];
      if (pool.length === 0) {
        for (const [, entities] of state.populations) {
          if (entities.length > 0) {
            pool = entities;
            break;
          }
        }
      }
      if (pool.length === 0) continue;

      const clause = contract.clauses.find((c) => c.id === node.clauseId);
      const kind = inferKind(node.budgetClaim.field, clause);
      const timestamps = evenlySpacedTimestamps(
        node.budgetClaim.min,
        node.budgetClaim.max,
        node.budgetClaim.expected,
      );

      for (let i = 0; i < timestamps.length; i++) {
        const entity = pool[i % pool.length]!;
        events.push({
          entityId: entity.id,
          kind,
          timestamp: timestamps[i]!,
          attrs: { source: 'lifecycle_planner', field: node.budgetClaim.field },
        });
      }
      evidence.push({
        clauseId: node.clauseId,
        observed: {
          populationId,
          kind,
          count: timestamps.length,
          window: { start: node.budgetClaim.min, end: node.budgetClaim.max },
        },
        note: `lifecycle planner emitted ${timestamps.length} ${kind} event(s)`,
      });
    } else if (node.budgetClaim.kind === 'temporal_gap') {
      // Realised when both anchors are bound (anchor planner runs after
      // lifecycle in the orchestrator topology — we still record evidence
      // so Phase 11 can cite the gap clause).
      evidence.push({
        clauseId: node.clauseId,
        observed: {
          anchorA: node.budgetClaim.anchorA,
          anchorB: node.budgetClaim.anchorB,
          days: node.budgetClaim.days,
        },
        note: 'lifecycle planner registered relative_gap (resolved by anchor binding)',
      });
    }
  }

  const delta: WorldStateDelta = { lifecycleEvents: events };
  return { delta, evidence };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferKind(field: string, clause: Clause | undefined): LifecycleEventKind {
  // Prefer the clause's filter context (e.g. status='failed') because the
  // field name itself (e.g. 'created') often doesn't carry the event kind.
  const tw = clause as Extract<TemporalClause, { kind: 'window' }> | undefined;
  const filterStatus = pickStatus(tw?.target?.filter);
  const cohortStatus = pickStatus(tw?.canonicalTarget?.cohortRule);
  const status = (filterStatus ?? cohortStatus ?? '').toLowerCase();
  const blob = `${field} ${status}`.toLowerCase();

  if (blob.includes('fail')) return 'failure';
  if (blob.includes('refund')) return 'refund';
  if (blob.includes('churn') || blob.includes('cancel')) return 'churn';
  if (blob.includes('renew')) return 'renewal';
  if (blob.includes('pause')) return 'pause';
  if (blob.includes('upgrade')) return 'upgrade';
  if (blob.includes('downgrade')) return 'downgrade';
  return 'start';
}

function pickStatus(filter: Record<string, unknown> | undefined): string | null {
  if (!filter) return null;
  const v = filter.status;
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const op = v as Record<string, unknown>;
    if (typeof op.eq === 'string') return op.eq;
    if (Array.isArray(op.in) && typeof op.in[0] === 'string') return op.in[0];
  }
  return null;
}

function evenlySpacedTimestamps(min: string, max: string, count: number): string[] {
  if (count <= 0) return [];
  const start = new Date(min).getTime();
  const end = new Date(max).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  if (count === 1) return [new Date((start + end) / 2).toISOString()];
  const step = (end - start) / (count - 1);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(new Date(start + step * i).toISOString());
  }
  return out;
}
