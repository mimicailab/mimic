/**
 * V5 — Phase 5: Canonical world state.
 *
 * The single source of truth the planners agree on. Projectors (Phase 7)
 * read from this; the contract evaluator (Phase 8) verifies that what
 * projectors emitted is consistent with what planners wrote here.
 *
 * **Immutability per planner pass.** Planners do NOT mutate a shared
 * WorldState; each one returns a `WorldStateDelta`, and the orchestrator
 * merges. This is what makes Phase 10's `regenerateFromOwner` tractable:
 * a planner re-run replays a single delta, not a partial mutation history.
 *
 * Conflict policy: merging a delta that disagrees with the existing state
 * on an anchored object (anchor binding, identity record, budget ledger)
 * throws. Same-key, same-content writes are idempotent.
 */

import type { OwnerId, PopulationId } from '../contract/clause-types.js';
import type { SeededRandom } from './prng.js';
import type {
  AnchorBinding,
  AnchorId,
  CanonicalEntity,
  EntityId,
  IdentityRecord,
  LifecycleEvent,
} from './entity.js';
import type { BudgetId, BudgetLedger } from './budget.js';

export interface WorldState {
  populations: Map<PopulationId, CanonicalEntity[]>;
  lifecycleEvents: LifecycleEvent[];
  anchors: Map<AnchorId, AnchorBinding>;
  identities: Map<EntityId, IdentityRecord>;
  budgets: Map<BudgetId, BudgetLedger>;
  /** Seeded, threaded through every planner. */
  prng: SeededRandom;
  /**
   * Persona index for this run. Used by the projectors and the shape repair
   * to namespace minted IDs (e.g. `cus_p2_…` for the second persona in a
   * batch) so two personas in the same workspace cannot collide on IDs.
   * Defaults to 1; the pipeline driver sets it from its `RunPipelineContext`.
   */
  personaIndex: number;
}

/**
 * Delta a planner returns. Every field is optional so a planner only
 * has to declare the slices it touched.
 */
export interface WorldStateDelta {
  /** Entities to append to each population's roster. */
  populations?: Array<{
    populationId: PopulationId;
    entities: CanonicalEntity[];
  }>;
  /** Lifecycle events to append. */
  lifecycleEvents?: LifecycleEvent[];
  /** Anchor bindings to insert (keyed by anchorId). */
  anchors?: Array<[AnchorId, AnchorBinding]>;
  /** Identity records to insert (keyed by entityId). */
  identities?: Array<[EntityId, IdentityRecord]>;
  /** Budget ledgers to insert (keyed by budgetId). */
  budgets?: Array<[BudgetId, BudgetLedger]>;
}

/**
 * Conflict raised by `mergeDelta` when an incoming write disagrees with
 * existing state on a keyed object. Keeps the existing value, the
 * proposed value, and the owning collection so the orchestrator can
 * route the failure back to its planner.
 */
export class WorldStateConflictError extends Error {
  constructor(
    public readonly collection: 'anchors' | 'identities' | 'budgets',
    public readonly key: string,
  ) {
    super(
      `World-state conflict on ${collection}["${key}"]: an existing value disagrees with the delta.`,
    );
    this.name = 'WorldStateConflictError';
  }
}

/**
 * Build an empty WorldState. The PRNG must be supplied by the
 * orchestrator — Phase 6 owns when/how to seed. `personaIndex` defaults to
 * 1 so existing callers (and tests) need no change.
 */
export function createWorldState(prng: SeededRandom, personaIndex = 1): WorldState {
  return {
    populations: new Map(),
    lifecycleEvents: [],
    anchors: new Map(),
    identities: new Map(),
    budgets: new Map(),
    prng,
    personaIndex,
  };
}

/**
 * Prepare a world state for Phase 10 regeneration. The triggering owner and
 * every downstream owner slice are cleared so replay rebuilds that suffix of
 * the world instead of appending duplicate entities/events onto stale state.
 */
export function resetWorldStateFromOwner(state: WorldState, ownerId: OwnerId): WorldState {
  const next = cloneWorldState(state);

  switch (ownerId) {
    case 'population':
      next.populations = new Map();
      next.identities = new Map();
      next.lifecycleEvents = [];
      next.anchors = new Map();
      next.budgets = new Map();
      break;
    case 'identity':
      next.identities = new Map();
      next.lifecycleEvents = [];
      next.anchors = new Map();
      next.budgets = new Map();
      break;
    case 'lifecycle':
      next.lifecycleEvents = [];
      next.anchors = new Map();
      next.budgets = new Map();
      break;
    case 'anchor':
      next.anchors = new Map();
      next.budgets = new Map();
      break;
    case 'reconciliation':
      next.budgets = new Map();
      break;
  }

  return next;
}

/**
 * Apply a delta to a world state. Returns a NEW WorldState — never
 * mutates the input. The PRNG instance is preserved by reference (a PRNG
 * is intrinsically stateful; sharing the same stream across passes is
 * exactly what we want for determinism).
 *
 * Conflict semantics:
 *   - populations: deltas append (a population is an ordered roster; the
 *     population planner is the only writer, but multiple passes during
 *     regeneration may extend the same roster).
 *   - lifecycleEvents: deltas append.
 *   - anchors / identities / budgets: idempotent on equal-content
 *     overwrites; throws `WorldStateConflictError` on a disagreement.
 */
export function mergeDelta(state: WorldState, delta: WorldStateDelta): WorldState {
  const next = cloneWorldState(state);

  if (delta.populations) {
    for (const block of delta.populations) {
      const existing = next.populations.get(block.populationId) ?? [];
      next.populations.set(block.populationId, [...existing, ...block.entities]);
    }
  }
  if (delta.lifecycleEvents && delta.lifecycleEvents.length > 0) {
    next.lifecycleEvents = [...next.lifecycleEvents, ...delta.lifecycleEvents];
  }
  if (delta.anchors) {
    for (const [id, binding] of delta.anchors) {
      const existing = next.anchors.get(id);
      if (existing && !sameAnchor(existing, binding)) {
        throw new WorldStateConflictError('anchors', id);
      }
      next.anchors.set(id, binding);
    }
  }
  if (delta.identities) {
    for (const [id, record] of delta.identities) {
      const existing = next.identities.get(id);
      if (existing && !sameIdentity(existing, record)) {
        throw new WorldStateConflictError('identities', id);
      }
      next.identities.set(id, record);
    }
  }
  if (delta.budgets) {
    for (const [id, ledger] of delta.budgets) {
      const existing = next.budgets.get(id);
      if (existing && !sameLedger(existing, ledger)) {
        throw new WorldStateConflictError('budgets', id);
      }
      next.budgets.set(id, ledger);
    }
  }
  return next;
}

function cloneWorldState(state: WorldState): WorldState {
  return {
    populations: new Map(state.populations),
    lifecycleEvents: [...state.lifecycleEvents],
    anchors: new Map(state.anchors),
    identities: new Map(state.identities),
    budgets: new Map(state.budgets),
    prng: state.prng,
    personaIndex: state.personaIndex,
  };
}

// ---------------------------------------------------------------------------
// Equality helpers — keyed-object idempotence is allowed; disagreements throw
// ---------------------------------------------------------------------------

function sameAnchor(a: AnchorBinding, b: AnchorBinding): boolean {
  if (a.anchorId !== b.anchorId) return false;
  if (a.entityId !== b.entityId) return false;
  return shallowEqualRecord(a.dates, b.dates);
}

function sameIdentity(a: IdentityRecord, b: IdentityRecord): boolean {
  if (a.entityId !== b.entityId) return false;
  if (a.slots.length !== b.slots.length) return false;
  for (let i = 0; i < a.slots.length; i++) {
    const sa = a.slots[i]!;
    const sb = b.slots[i]!;
    if (sa.surface !== sb.surface) return false;
    if (sa.objectKind !== sb.objectKind) return false;
    if (sa.deterministicSeed !== sb.deterministicSeed) return false;
  }
  return true;
}

function sameLedger(a: BudgetLedger, b: BudgetLedger): boolean {
  if (a.id !== b.id) return false;
  if (a.total !== b.total) return false;
  if (a.tolerance !== b.tolerance) return false;
  if (a.parts.size !== b.parts.size) return false;
  for (const [k, v] of a.parts) {
    if (b.parts.get(k) !== v) return false;
  }
  return true;
}

function shallowEqualRecord(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false;
    const k = aKeys[i]!;
    if (a[k] !== b[k]) return false;
  }
  return true;
}
