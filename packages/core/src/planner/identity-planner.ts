/**
 * V5 — Phase 6: Identity planner.
 *
 * Owns: cross_surface clauses. Reserves one canonical IdentityRecord per
 * entity, with surface slots derived from the entity's owned
 * `surfaceBindings`. The slots carry a `deterministicSeed` derived from the
 * canonical entity id — projectors mint final surface IDs from this seed
 * plus adapter `ProjectorHints`.
 *
 * Phase 6 boundary (Phase 13 lint enforces it): no import of
 * `projection/identity-prefix.ts`, adapter manifests, or `ProjectorHints`
 * here or anywhere under `planner/`. IdentityRecord carries reservations
 * only — never vendor-shaped strings.
 */

import type { CrossSurfaceClause } from '../contract/clause-types.js';
import type { PersonaContract } from '../contract/persona-contract.js';
import type {
  CanonicalEntity,
  IdentityRecord,
  IdentitySlot,
  SurfaceBinding,
} from '../world/entity.js';
import type { WorldState, WorldStateDelta } from '../world/world-state.js';
import type { ObligationGraph } from './obligation-graph.js';
import type { PlannerEvidence, PlannerResult } from './planner-result.js';

export function runIdentityPlanner(
  contract: PersonaContract,
  graph: ObligationGraph,
  state: WorldState,
): PlannerResult {
  const identities: Array<[string, IdentityRecord]> = [];
  const evidence: PlannerEvidence[] = [];

  for (const [populationId, entities] of state.populations) {
    let reservedSlots = 0;
    for (const entity of entities) {
      const slots = buildSlotsFor(entity);
      reservedSlots += slots.length;
      identities.push([entity.id, { entityId: entity.id, slots }]);
    }
    evidence.push({
      clauseId: `identity:${populationId}`,
      observed: { populationId, entities: entities.length, reservedSlots },
      note: `identity planner reserved ${reservedSlots} entity-owned slot(s) across ${entities.length} entities`,
    });
  }

  // Cross-surface clauses get an evidence record so Phase 11 proof can
  // cite the identity planner's involvement.
  const crossNodes = graph.byOwnerId.get('identity') ?? [];
  for (const node of crossNodes) {
    const clause = contract.clauses.find((c) => c.id === node.clauseId);
    if (!clause || clause.family !== 'cross_surface') continue;
    const cs = clause as CrossSurfaceClause;
    evidence.push({
      clauseId: node.clauseId,
      observed: { entity: cs.entity, field: cs.field, surfaceA: cs.surfaceA, surfaceB: cs.surfaceB },
      note: 'identity planner registered cross-surface drift requirement',
    });
  }

  const delta: WorldStateDelta = { identities };
  return { delta, evidence };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SurfaceCoord {
  surface: string;
  objectKind: string;
}
function buildSlotsFor(entity: CanonicalEntity): IdentitySlot[] {
  const coords = ownedSurfaceCoords(entity.surfaceBindings ?? []);
  return coords.map((c) => ({
    surface: c.surface,
    objectKind: c.objectKind,
    deterministicSeed: `${entity.id}::${c.surface}::${c.objectKind}`,
  }));
}

function ownedSurfaceCoords(bindings: SurfaceBinding[]): SurfaceCoord[] {
  const seen = new Set<string>();
  const coords: SurfaceCoord[] = [];

  for (const binding of bindings) {
    const key = `${binding.surface}::${binding.objectKind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    coords.push({ surface: binding.surface, objectKind: binding.objectKind });
  }

  return coords;
}
