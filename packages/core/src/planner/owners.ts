/**
 * V5 — Phase 4: Owner assignment rule table.
 *
 * Maps (clause family + canonical target) → owner planner. The rule table
 * is the SINGLE source of truth for owner attribution; nothing else in the
 * pipeline is allowed to invent owners. Owner planners are listed in
 * `OwnerId` (clause-types.ts).
 *
 * Rule IDs are stable so the Phase 4 report can cite them. The
 * `OWNERS_REGISTRY_VERSION` bumps on every change to the rule table.
 */

import type {
  AggregateClause,
  CanonicalTarget,
  Clause,
  ClauseFamily,
  CountClause,
  OwnerId,
} from '../contract/clause-types.js';

export const OWNERS_REGISTRY_VERSION = 'v5.0';

export interface OwnerAssignmentDecision {
  clauseId: string;
  family: ClauseFamily;
  ownerId: OwnerId | null;
  /** Rule that fired. `no-match` when no rule covers the clause. */
  ruleId: string;
  explanation: string;
}

interface OwnerRule {
  id: string;
  description: string;
  /** Returns the owner this rule assigns, or null when it does not match. */
  match(clause: Clause): { ownerId: OwnerId; explanation: string } | null;
}

const REVENUE_METRICS = new Set(['mrr', 'arr', 'revenue', 'mrr_change']);

function isRevenueAggregate(clause: AggregateClause): boolean {
  const metric = clause.canonicalTarget?.metricId ?? '';
  return REVENUE_METRICS.has(metric);
}

function hasResolvedCanonicalTarget(target: CanonicalTarget | undefined): boolean {
  return target != null && target.populationId !== 'unresolved';
}

const RULES: OwnerRule[] = [
  // Narrative is never owned — see the `assignOwner` short-circuit. No
  // rule entry needed; it's handled before the RULES walk.
  // Anchor clauses → anchor planner.
  {
    id: 'anchor.to.anchor.v1',
    description: 'Anchor-family clauses bind named singleton events; owned by the anchor planner.',
    match: (c) =>
      c.family === 'anchor'
        ? {
            ownerId: 'anchor',
            explanation: `Anchor clause ${(c as { anchorId?: string }).anchorId ?? c.id} owned by anchor planner.`,
          }
        : null,
  },
  // Cross-surface drift → identity planner (it owns the canonical entity
  // whose representations on each surface must agree or intentionally
  // disagree).
  {
    id: 'cross_surface.to.identity.v1',
    description: 'Cross-surface clauses describe how a canonical identity appears on each surface.',
    match: (c) =>
      c.family === 'cross_surface'
        ? {
            ownerId: 'identity',
            explanation: 'Cross-surface drift is the identity planner\'s responsibility.',
          }
        : null,
  },
  // Reconciliation clauses → reconciliation planner.
  {
    id: 'reconciliation.to.reconciliation.v1',
    description: 'Headline-equals-sum-of-buckets clauses are owned by the reconciliation planner.',
    match: (c) =>
      c.family === 'reconciliation'
        ? {
            ownerId: 'reconciliation',
            explanation: 'Reconciliation clauses produce a budget ledger.',
          }
        : null,
  },
  // Revenue aggregates (MRR/ARR/revenue) → reconciliation planner, because
  // they are budget-shaped headlines even when the persona doesn't enumerate
  // buckets.
  {
    id: 'aggregate.revenue.to.reconciliation.v1',
    description: 'Sum/avg on revenue metrics produces a reconciliation budget.',
    match: (c) => {
      if (c.family !== 'aggregate') return null;
      if (!isRevenueAggregate(c as AggregateClause)) return null;
      return {
        ownerId: 'reconciliation',
        explanation: `Aggregate over ${c.canonicalTarget?.metricId} routed to reconciliation planner.`,
      };
    },
  },
  // Temporal window clauses → lifecycle planner (windowed counts are
  // event time series the lifecycle planner emits).
  {
    id: 'temporal.window.to.lifecycle.v1',
    description: 'Temporal window clauses are lifecycle event counts.',
    match: (c) => {
      if (c.family !== 'temporal') return null;
      if ((c as { kind?: string }).kind !== 'window') return null;
      return {
        ownerId: 'lifecycle',
        explanation: 'Temporal window clauses are owned by the lifecycle planner.',
      };
    },
  },
  // Temporal relative_gap → lifecycle planner (gap between two lifecycle
  // events on the same canonical entity).
  {
    id: 'temporal.gap.to.lifecycle.v1',
    description: 'Anchor-to-anchor temporal gaps describe lifecycle event ordering.',
    match: (c) => {
      if (c.family !== 'temporal') return null;
      if ((c as { kind?: string }).kind !== 'relative_gap') return null;
      return {
        ownerId: 'lifecycle',
        explanation: 'Relative_gap clauses are owned by the lifecycle planner.',
      };
    },
  },
  // Generic count clauses → population planner.
  {
    id: 'count.to.population.v1',
    description: 'Count of entities in a population is owned by the population planner.',
    match: (c) =>
      c.family === 'count'
        ? hasResolvedCanonicalTarget((c as CountClause).canonicalTarget)
          ? {
              ownerId: 'population',
              explanation: `Count over ${(c as CountClause).canonicalTarget?.populationId} owned by population planner.`,
            }
          : null
        : null,
  },
  // Distribution clauses → population planner.
  {
    id: 'distribution.to.population.v1',
    description: 'Distribution of entities by a categorical field is owned by the population planner.',
    match: (c) =>
      c.family === 'distribution'
        ? hasResolvedCanonicalTarget(c.canonicalTarget)
          ? {
              ownerId: 'population',
              explanation: `Distribution over ${c.canonicalTarget?.populationId} owned by population planner.`,
            }
          : null
        : null,
  },
  // Non-revenue aggregates → population planner (e.g. average login count
  // per user; sum of orders by tier).
  {
    id: 'aggregate.nonrevenue.to.population.v1',
    description: 'Non-revenue aggregates are owned by the population planner.',
    match: (c) =>
      c.family === 'aggregate' && !isRevenueAggregate(c as AggregateClause)
        ? hasResolvedCanonicalTarget(c.canonicalTarget)
          ? {
              ownerId: 'population',
              explanation: `Aggregate over ${c.canonicalTarget?.populationId} owned by population planner.`,
            }
          : null
        : null,
  },
];

/**
 * Pure rule-table evaluation. Returns the assignment decision for one clause.
 * Narrative clauses are NEVER owned — they short-circuit to `{ ownerId: null,
 * ruleId: 'narrative.unowned.v1' }`.
 */
export function assignOwner(clause: Clause): OwnerAssignmentDecision {
  if (clause.family === 'narrative') {
    return {
      clauseId: clause.id,
      family: clause.family,
      ownerId: null,
      ruleId: 'narrative.unowned.v1',
      explanation: 'Narrative clauses are stylistic only and have no runtime owner.',
    };
  }

  for (const rule of RULES) {
    const decision = rule.match(clause);
    if (decision) {
      return {
        clauseId: clause.id,
        family: clause.family,
        ownerId: decision.ownerId,
        ruleId: rule.id,
        explanation: decision.explanation,
      };
    }
  }

  return {
    clauseId: clause.id,
    family: clause.family,
    ownerId: null,
    ruleId: 'no-match',
    explanation: `No rule in ${OWNERS_REGISTRY_VERSION} matched ${clause.family} clause ${clause.id}.`,
  };
}

/** Snapshot of every rule the table currently knows, for diagnostics / docs. */
export function listRules(): Array<{ id: string; description: string }> {
  return RULES.map((r) => ({ id: r.id, description: r.description }));
}
