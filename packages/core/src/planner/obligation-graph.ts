/**
 * V5 — Phase 4: Obligation graph.
 *
 * Output of a passing pre-generation gate. Every hard clause that the gate
 * approves becomes one `ObligationNode`. The graph is the contract the
 * planners must satisfy and the proof report (Phase 11) cites.
 *
 * Build is fused with the gate: `pre-generation-gate.ts` constructs the
 * graph during the same pass that assigned owners, so we never re-walk
 * clauses just to build it.
 */

import type { Clause, ClauseId, OwnerId } from '../contract/clause-types.js';

/** What the owning planner must produce or budget to satisfy a clause. */
export type BudgetClaim =
  | { kind: 'count'; expected: number; tolerance: number }
  | { kind: 'aggregate'; op: 'sum' | 'avg'; metricId: string; expected: number; tolerance: number }
  | { kind: 'distribution'; field: string; values: Record<string, number>; tolerance: number }
  | { kind: 'temporal_window'; field: string; min: string; max: string; expected: number; tolerance: number }
  | { kind: 'temporal_gap'; anchorA: string; anchorB: string; days: number; tolerance: number }
  | { kind: 'anchor'; anchorId: string; customer?: string; dates: Record<string, string> }
  | {
      kind: 'cross_surface';
      entity: string;
      field: string;
      valueA: string | number | boolean;
      valueB: string | number | boolean;
      driftDays?: number;
    }
  | {
      kind: 'reconciliation';
      metric: string;
      headline: number;
      tolerance: number;
      buckets: Array<{ name: string; value: number }>;
    };

export interface ObligationNode {
  clauseId: ClauseId;
  ownerId: OwnerId;
  /** The persona quote — kept for proof + error reporting. */
  quote: string;
  /** Quantitative obligation the owner must satisfy. */
  budgetClaim: BudgetClaim;
  /** Population ids the clause touches; ordering is deterministic. */
  canonicalEntities: string[];
  /**
   * Stable path describing where to verify this clause in the materialised
   * dataset. Phase 11 uses this to render proof records.
   */
  evidencePath: string;
}

export interface ObligationGraph {
  nodes: ObligationNode[];
  /** Convenience: clause-id index. */
  byClauseId: Map<ClauseId, ObligationNode>;
  /** Convenience: owner-id index. */
  byOwnerId: Map<OwnerId, ObligationNode[]>;
}

/**
 * Build a single node from an already-canonicalised + already-owned clause.
 * Exported so the gate can call it once per hard clause as part of the same
 * walk that approves the clause.
 */
export function buildObligationNode(
  clause: Clause,
  ownerId: OwnerId,
): ObligationNode {
  const canonicalEntities = collectCanonicalEntities(clause);
  return {
    clauseId: clause.id,
    ownerId,
    quote: clause.quote,
    budgetClaim: deriveBudgetClaim(clause),
    canonicalEntities,
    evidencePath: deriveEvidencePath(clause, canonicalEntities),
  };
}

export function buildObligationGraph(nodes: ObligationNode[]): ObligationGraph {
  const byClauseId = new Map<ClauseId, ObligationNode>();
  const byOwnerId = new Map<OwnerId, ObligationNode[]>();
  for (const node of nodes) {
    byClauseId.set(node.clauseId, node);
    const bucket = byOwnerId.get(node.ownerId) ?? [];
    bucket.push(node);
    byOwnerId.set(node.ownerId, bucket);
  }
  return { nodes, byClauseId, byOwnerId };
}

// ---------------------------------------------------------------------------
// Derivation helpers
// ---------------------------------------------------------------------------

function deriveBudgetClaim(clause: Clause): BudgetClaim {
  switch (clause.family) {
    case 'count':
      return { kind: 'count', expected: clause.expected, tolerance: clause.tolerance ?? 0 };
    case 'aggregate':
      return {
        kind: 'aggregate',
        op: clause.op,
        metricId: clause.canonicalTarget?.metricId ?? `${clause.op}_${clause.field}`,
        expected: clause.expected,
        tolerance: clause.tolerance ?? 0,
      };
    case 'distribution':
      return {
        kind: 'distribution',
        field: clause.field,
        values: clause.values,
        tolerance: clause.tolerance ?? 0,
      };
    case 'temporal':
      if (clause.kind === 'window') {
        return {
          kind: 'temporal_window',
          field: clause.field,
          min: clause.min,
          max: clause.max,
          expected: clause.expected,
          tolerance: clause.tolerance ?? 0,
        };
      }
      return {
        kind: 'temporal_gap',
        anchorA: clause.anchorA,
        anchorB: clause.anchorB,
        days: clause.days,
        tolerance: clause.tolerance ?? 0,
      };
    case 'anchor':
      return {
        kind: 'anchor',
        anchorId: clause.anchorId,
        customer: clause.customer,
        dates: clause.dates,
      };
    case 'cross_surface':
      return {
        kind: 'cross_surface',
        entity: clause.entity,
        field: clause.field,
        valueA: clause.valueA,
        valueB: clause.valueB,
        driftDays: clause.driftDays,
      };
    case 'reconciliation':
      return {
        kind: 'reconciliation',
        metric: clause.metric,
        headline: clause.headline,
        tolerance: clause.tolerance ?? 0,
        buckets: clause.buckets.map((b) => ({ name: b.name, value: b.value })),
      };
    case 'narrative':
      throw new Error(
        `obligation-graph: narrative clauses must not produce nodes (clauseId=${clause.id}).`,
      );
  }
}

function collectCanonicalEntities(clause: Clause): string[] {
  const out = new Set<string>();
  const target = clause.canonicalTarget;
  if (target && target.populationId !== 'unresolved') {
    out.add(target.populationId);
  }
  if (clause.family === 'reconciliation') {
    for (const b of clause.buckets) {
      const surface =
        b.target.surface === 'db' ? `db:${b.target.name}` : `api:${b.target.name}`;
      out.add(surface);
    }
  }
  if (clause.family === 'cross_surface') {
    const a = clause.surfaceA;
    const b = clause.surfaceB;
    out.add(a.surface === 'db' ? `db:${a.name}` : `api:${a.name}`);
    out.add(b.surface === 'db' ? `db:${b.name}` : `api:${b.name}`);
  }
  return [...out].sort();
}

function deriveEvidencePath(clause: Clause, canonicalEntities: string[]): string {
  const head = canonicalEntities[0] ?? 'unknown';
  const metric = clause.canonicalTarget?.metricId ?? clause.family;
  return `population/${head}/${metric}/${clause.id}`;
}
