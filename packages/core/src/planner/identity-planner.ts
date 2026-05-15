/**
 * V5 — Phase 6: Identity planner.
 *
 * Owns: cross_surface clauses. Reserves one canonical IdentityRecord per
 * entity, with surface slots for every (surface, objectKind) the contract
 * references. The slots carry a `deterministicSeed` derived from the
 * canonical entity id — projectors mint final surface IDs from this seed
 * plus adapter `ProjectorHints`.
 *
 * Phase 6 boundary (Phase 13 lint enforces it): no import of
 * `projection/identity-prefix.ts`, adapter manifests, or `ProjectorHints`
 * here or anywhere under `planner/`. IdentityRecord carries reservations
 * only — never vendor-shaped strings.
 */

import type { Clause, CrossSurfaceClause } from '../contract/clause-types.js';
import type { PersonaContract } from '../contract/persona-contract.js';
import type {
  CanonicalEntity,
  IdentityRecord,
  IdentitySlot,
} from '../world/entity.js';
import type { ResourceTarget } from '../types/claim.js';
import type { WorldState, WorldStateDelta } from '../world/world-state.js';
import type { ObligationGraph } from './obligation-graph.js';
import type { PlannerEvidence, PlannerResult } from './planner-result.js';

export function runIdentityPlanner(
  contract: PersonaContract,
  graph: ObligationGraph,
  state: WorldState,
): PlannerResult {
  // Collect surface coordinates referenced by ANY clause in the contract.
  // This is what an entity might need a slot for. Population planner already
  // wrote canonical entities; we attach slots to each one.
  const surfaceCoords = collectSurfaceCoords(contract);

  const identities: Array<[string, IdentityRecord]> = [];
  const evidence: PlannerEvidence[] = [];

  for (const [populationId, entities] of state.populations) {
    for (const entity of entities) {
      const slots = buildSlotsFor(entity, surfaceCoords);
      identities.push([entity.id, { entityId: entity.id, slots }]);
    }
    evidence.push({
      clauseId: `identity:${populationId}`,
      observed: { populationId, entities: entities.length, surfaceCount: surfaceCoords.length },
      note: `identity planner reserved ${surfaceCoords.length} slot(s) for each of ${entities.length} entities`,
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

function collectSurfaceCoords(contract: PersonaContract): SurfaceCoord[] {
  const seen = new Set<string>();
  const out: SurfaceCoord[] = [];

  function add(t: ResourceTarget | undefined): void {
    if (!t) return;
    const coord = toCoord(t);
    if (!coord) return;
    const key = `${coord.surface}::${coord.objectKind}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(coord);
  }

  for (const clause of contract.clauses) {
    switch (clause.family) {
      case 'count':
      case 'aggregate':
      case 'distribution':
        add(clause.target);
        break;
      case 'temporal':
        if (clause.kind === 'window') add(clause.target);
        break;
      case 'cross_surface':
        add(clause.surfaceA);
        add(clause.surfaceB);
        break;
      case 'reconciliation':
        for (const b of clause.buckets) add(b.target);
        break;
      case 'anchor':
      case 'narrative':
        break;
    }
  }
  return out;
}

function toCoord(t: ResourceTarget): SurfaceCoord | null {
  if (t.surface === 'db') return { surface: 'db', objectKind: t.name };
  // api: "<adapter>.<resource>"
  const dot = t.name.indexOf('.');
  if (dot < 0) return null;
  return { surface: t.name.slice(0, dot), objectKind: t.name.slice(dot + 1) };
}

function buildSlotsFor(entity: CanonicalEntity, coords: SurfaceCoord[]): IdentitySlot[] {
  return coords.map((c) => ({
    surface: c.surface,
    objectKind: c.objectKind,
    deterministicSeed: `${entity.id}::${c.surface}::${c.objectKind}`,
  }));
}

void ({} as Clause);
