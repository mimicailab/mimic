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
      // Restrict the pool to entities matching the clause's cohort
      // filter. Without this, a window clause like "14 pro customers
      // logged in within window" would round-robin across every db:users
      // entity, including 2833 entities that aren't pro — and the
      // evaluator (which filters by `plan=pro`) would never find them.
      const cohortPool = filterByCohort(pool, clause);
      const targetPool = cohortPool.length > 0 ? cohortPool : pool;
      const kind = inferKind(node.budgetClaim.field, clause);
      const timestamps = evenlySpacedTimestamps(
        node.budgetClaim.min,
        node.budgetClaim.max,
        node.budgetClaim.expected,
      );

      const field = node.budgetClaim.field;
      for (let i = 0; i < timestamps.length; i++) {
        const entity = targetPool[i % targetPool.length]!;
        const timestamp = timestamps[i]!;
        events.push({
          entityId: entity.id,
          kind,
          timestamp,
          attrs: { source: 'lifecycle_planner', field },
        });
        // Also stamp the timestamp onto the entity's attrs so the DB
        // projector emits it as a column. The contract evaluator reads
        // materialised rows first (where `row[field]` is in window) and
        // only falls back to event counting when the rows path produces
        // zero — without this stamping, every temporal_window clause
        // would over-count via the unfiltered fallback path.
        if (entity.attrs[field] === undefined) {
          entity.attrs[field] = timestamp;
        }
      }
      evidence.push({
        clauseId: node.clauseId,
        observed: {
          populationId,
          kind,
          count: timestamps.length,
          window: { start: node.budgetClaim.min, end: node.budgetClaim.max },
          pool: targetPool.length,
        },
        note: `lifecycle planner emitted ${timestamps.length} ${kind} event(s) over ${targetPool.length} cohort entit(ies)`,
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

function filterByCohort(
  pool: import('../world/entity.js').CanonicalEntity[],
  clause: Clause | undefined,
): import('../world/entity.js').CanonicalEntity[] {
  if (!clause) return pool;
  const rule = clause.canonicalTarget?.cohortRule;
  if (!rule) return pool;
  return pool.filter((entity) => {
    for (const [field, expected] of Object.entries(rule)) {
      const current = entity.attrs[field] ?? (field === 'status' ? entity.lifecycle.status : undefined);
      if (!matchesPredicate(current, expected)) return false;
    }
    return true;
  });
}

function matchesPredicate(value: unknown, predicate: unknown): boolean {
  if (predicate === null) return value === null;
  if (typeof predicate !== 'object' || predicate == null || Array.isArray(predicate)) {
    return valueEquals(value, predicate);
  }

  const op = predicate as Record<string, unknown>;
  if ('eq' in op) return valueEquals(value, op.eq);
  if ('neq' in op) return !valueEquals(value, op.neq);
  if ('in' in op && Array.isArray(op.in)) return op.in.some((item) => valueEquals(value, item));
  if ('nin' in op && Array.isArray(op.nin)) return !op.nin.some((item) => valueEquals(value, item));
  if ('gte' in op) return compareScalar(value, op.gte as number | string) >= 0;
  if ('lte' in op) return compareScalar(value, op.lte as number | string) <= 0;
  if ('gt' in op) return compareScalar(value, op.gt as number | string) > 0;
  if ('lt' in op) return compareScalar(value, op.lt as number | string) < 0;
  if ('is_null' in op) {
    const isNull = value === null || value === undefined || value === '';
    return isNull === op.is_null;
  }
  return false;
}

function valueEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === 'number' && typeof b === 'string') return a === Number(b);
  if (typeof a === 'string' && typeof b === 'number') return Number(a) === b;
  return false;
}

function compareScalar(a: unknown, b: number | string): number {
  if (typeof b === 'number') return toNumber(a) - b;
  const left = toMillis(a);
  const right = toMillis(b);
  if (left != null && right != null) return left - right;
  return String(a).localeCompare(String(b));
}

function toMillis(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  if (typeof value !== 'string') return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
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
