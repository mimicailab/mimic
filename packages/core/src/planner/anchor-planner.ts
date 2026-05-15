/**
 * V5 — Phase 6: Anchor planner.
 *
 * Owns: anchor clauses. Binds each named anchor to a canonical entity
 * (resolved by customer descriptor when present, otherwise by stable
 * draw from the matched population) and writes the `AnchorBinding`
 * into the world state.
 */

import type { AnchorClause } from '../contract/clause-types.js';
import type { PersonaContract } from '../contract/persona-contract.js';
import type { AnchorBinding } from '../world/entity.js';
import type { WorldState, WorldStateDelta } from '../world/world-state.js';
import type { ObligationGraph } from './obligation-graph.js';
import type { PlannerEvidence, PlannerResult } from './planner-result.js';

export function runAnchorPlanner(
  contract: PersonaContract,
  graph: ObligationGraph,
  state: WorldState,
): PlannerResult {
  const nodes = graph.byOwnerId.get('anchor') ?? [];
  const bindings: Array<[string, AnchorBinding]> = [];
  const evidence: PlannerEvidence[] = [];

  for (const node of nodes) {
    if (node.budgetClaim.kind !== 'anchor') continue;
    const clause = contract.clauses.find((c) => c.id === node.clauseId) as
      | AnchorClause
      | undefined;
    if (!clause) continue;

    const entityId = resolveAnchorEntity(clause, state);
    if (!entityId) {
      evidence.push({
        clauseId: node.clauseId,
        observed: { anchorId: clause.anchorId, status: 'unresolved' },
        note: 'anchor planner could not resolve an entity for this anchor (no populated entity matched the customer descriptor).',
      });
      continue;
    }

    const binding: AnchorBinding = {
      anchorId: clause.anchorId,
      entityId,
      dates: { ...clause.dates },
    };
    bindings.push([clause.anchorId, binding]);
    evidence.push({
      clauseId: node.clauseId,
      observed: { anchorId: clause.anchorId, entityId, dates: clause.dates },
      note: `anchor planner bound ${clause.anchorId} → ${entityId}`,
    });
  }

  const delta: WorldStateDelta = { anchors: bindings };
  return { delta, evidence };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveAnchorEntity(clause: AnchorClause, state: WorldState): string | null {
  // 1. If the customer descriptor names a known entity attr (e.g. attrs.name
  //    === "Klein Records"), prefer that.
  if (clause.customer) {
    const target = normaliseText(clause.customer);
    for (const [, entities] of state.populations) {
      for (const e of entities) {
        const candidates = [e.attrs.name, e.attrs.company, e.attrs.customer_reference];
        if (candidates.some((value) => normaliseText(value) === target)) return e.id;
      }
    }
  }
  // 2. Fallback: pick the first entity from any population. Anchor clauses
  //    without a named customer still need an entity to attach to.
  for (const [, entities] of state.populations) {
    if (entities.length > 0) return entities[0]!.id;
  }
  return null;
}

function normaliseText(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, ' ')
    : '';
}
