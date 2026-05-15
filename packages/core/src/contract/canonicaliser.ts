/**
 * V5 — Phase 3: Canonicaliser.
 *
 * Maps the fuzzy persona language already captured on each clause onto a
 * precise canonical vocabulary the planners and validators read. Strictly
 * deterministic — no LLM. Mutates the contract in place: every clause gets
 * a `canonicalTarget`; clauses the rule table cannot resolve get a
 * `canonicalisationGap` instead, which the Phase 4 gate folds into its
 * combined `ContradictionAndCoverageReport`.
 *
 * Source of truth: this file. There is no parallel canonical-contract
 * type and no canonical-targets map keyed by clause id. Canonical meaning
 * lives on the clause itself.
 *
 * Population seed comes from `semantic-capabilities.ts`: the existing
 * `billing_customer_cohort` vocabulary is the kernel V5 builds on.
 */

import type {
  AggregateClause,
  AnchorClause,
  CanonicalisationGap,
  CanonicalTarget,
  CanonicalWindow,
  Clause,
  CohortRule,
  CountClause,
  CrossSurfaceClause,
  DistributionClause,
  MetricId,
  NarrativeClause,
  PopulationId,
  ReconciliationClause,
  SemanticTarget,
  TemporalClause,
} from './clause-types.js';
import type { PersonaContract } from './persona-contract.js';
import type { Filter, ResourceTarget } from '../types/claim.js';

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Enrich every clause in `contract` with a canonical interpretation. The
 * returned contract is the same object — clauses are mutated in place.
 */
export function canonicaliseContract(contract: PersonaContract): PersonaContract {
  for (const clause of contract.clauses) {
    const result = canonicaliseClause(clause);
    clause.canonicalTarget = result.target;
    if (result.gap) {
      clause.canonicalisationGap = result.gap;
    } else {
      delete clause.canonicalisationGap;
    }
  }
  return contract;
}

// ---------------------------------------------------------------------------
// Per-clause dispatch
// ---------------------------------------------------------------------------

interface CanonicaliseResult {
  target: CanonicalTarget;
  gap?: CanonicalisationGap;
}

function canonicaliseClause(clause: Clause): CanonicaliseResult {
  switch (clause.family) {
    case 'count':
      return canonicaliseCount(clause);
    case 'aggregate':
      return canonicaliseAggregate(clause);
    case 'distribution':
      return canonicaliseDistribution(clause);
    case 'temporal':
      return canonicaliseTemporal(clause);
    case 'anchor':
      return canonicaliseAnchor(clause);
    case 'cross_surface':
      return canonicaliseCrossSurface(clause);
    case 'reconciliation':
      return canonicaliseReconciliation(clause);
    case 'narrative':
      return canonicaliseNarrative(clause);
  }
}

// ---------------------------------------------------------------------------
// count
// ---------------------------------------------------------------------------

function canonicaliseCount(clause: CountClause): CanonicaliseResult {
  const subject = resolveSubject(clause.semanticTarget, clause.target);
  if (subject.populationId === 'unresolved') {
    return unresolved(clause.quote, subject.unresolvedText ?? '(no target)', 'No population matched count clause.');
  }
  return {
    target: {
      populationId: subject.populationId,
      cohortRule: subject.cohortRule,
      metricId: 'count',
    },
  };
}

// ---------------------------------------------------------------------------
// aggregate
// ---------------------------------------------------------------------------

function canonicaliseAggregate(clause: AggregateClause): CanonicaliseResult {
  const subject = resolveSubject(clause.semanticTarget, clause.target);
  if (subject.populationId === 'unresolved') {
    return unresolved(clause.quote, subject.unresolvedText ?? '(no target)', 'No population matched aggregate clause.');
  }
  return {
    target: {
      populationId: subject.populationId,
      cohortRule: subject.cohortRule,
      metricId: canonicaliseMetric(clause.op, clause.field),
    },
  };
}

// ---------------------------------------------------------------------------
// distribution
// ---------------------------------------------------------------------------

function canonicaliseDistribution(clause: DistributionClause): CanonicaliseResult {
  const subject = resolveSubject(clause.semanticTarget, clause.target);
  if (subject.populationId === 'unresolved') {
    return unresolved(clause.quote, subject.unresolvedText ?? '(no target)', 'No population matched distribution clause.');
  }
  // Distribution metrics surface as count by bucket — bucket field is
  // tracked separately on the clause. The canonical metric is `count`.
  return {
    target: {
      populationId: subject.populationId,
      cohortRule: subject.cohortRule,
      metricId: 'count',
    },
  };
}

// ---------------------------------------------------------------------------
// temporal
// ---------------------------------------------------------------------------

function canonicaliseTemporal(clause: TemporalClause): CanonicaliseResult {
  if (clause.kind === 'window') {
    const subject = resolveSubject(clause.semanticTarget, clause.target);
    if (subject.populationId === 'unresolved') {
      return unresolved(clause.quote, subject.unresolvedText ?? '(no target)', 'No population matched temporal window clause.');
    }
    return {
      target: {
        populationId: subject.populationId,
        cohortRule: subject.cohortRule,
        metricId: 'count',
        window: canonicaliseWindow(clause.min, clause.max),
      },
    };
  }
  // relative_gap clauses bind two anchors. Their canonical population is
  // the anchor pair itself; there is no row-set vocabulary to canonicalise
  // beyond that, so we emit a stable populationId derived from the anchors.
  return {
    target: {
      populationId: `anchor_gap:${clause.anchorA}->${clause.anchorB}`,
      metricId: 'gap_days',
    },
  };
}

// ---------------------------------------------------------------------------
// anchor
// ---------------------------------------------------------------------------

function canonicaliseAnchor(clause: AnchorClause): CanonicaliseResult {
  return {
    target: {
      populationId: `anchor:${clause.anchorId}`,
      metricId: 'event',
      window: anchorWindow(clause.dates),
    },
  };
}

// ---------------------------------------------------------------------------
// cross_surface
// ---------------------------------------------------------------------------

function canonicaliseCrossSurface(clause: CrossSurfaceClause): CanonicaliseResult {
  const a = resolveResourceTargetOnly(clause.surfaceA);
  const b = resolveResourceTargetOnly(clause.surfaceB);
  if (a.populationId === 'unresolved' || b.populationId === 'unresolved') {
    return unresolved(
      clause.quote,
      `${a.unresolvedText ?? a.populationId} / ${b.unresolvedText ?? b.populationId}`,
      'Cross-surface clause references one or more unresolved populations.',
    );
  }
  return {
    target: {
      populationId: `cross_surface:${clause.entity}`,
      cohortRule: { [clause.field]: { in: [clause.valueA, clause.valueB] } as Filter[string] },
      metricId: 'cross_surface_field',
    },
  };
}

// ---------------------------------------------------------------------------
// reconciliation
// ---------------------------------------------------------------------------

function canonicaliseReconciliation(clause: ReconciliationClause): CanonicaliseResult {
  // Reconciliation is owned by the reconciliation planner; its population
  // is implicit (the union of bucket targets). We pick the dominant
  // population by majority vote across buckets, falling back to a stable
  // synthetic id when buckets disagree — the gate's feasibility check
  // already enforces sum identity, so canonical drift here is not load-bearing.
  const subjects = clause.buckets.map((b) => resolveResourceTargetOnly(b.target));
  const populations = subjects
    .map((s) => s.populationId)
    .filter((p) => p !== 'unresolved');
  if (populations.length === 0) {
    return unresolved(clause.quote, clause.metric, 'Reconciliation clause has no resolvable bucket populations.');
  }
  const dominant = mostCommon(populations);
  return {
    target: {
      populationId: dominant,
      metricId: clause.metric,
    },
  };
}

// ---------------------------------------------------------------------------
// narrative
// ---------------------------------------------------------------------------

function canonicaliseNarrative(clause: NarrativeClause): CanonicaliseResult {
  // Narrative clauses never block; they get a trivially-true canonical
  // interpretation so downstream code can rely on `canonicalTarget` being
  // present without special-casing the family.
  void clause;
  return {
    target: {
      populationId: 'narrative_only',
      metricId: 'style',
    },
  };
}

// ---------------------------------------------------------------------------
// Subject resolution — combines semantic + raw target into a population
// ---------------------------------------------------------------------------

interface ResolvedSubject {
  populationId: PopulationId | 'unresolved';
  cohortRule?: CohortRule;
  /** Echo of the user-visible reference for diagnostics. */
  unresolvedText?: string;
}

function resolveSubject(
  semanticTarget: SemanticTarget | undefined,
  rawTarget: ResourceTarget | undefined,
): ResolvedSubject {
  if (semanticTarget) {
    const fromSemantic = resolveSemanticSubject(semanticTarget, rawTarget);
    if (fromSemantic.populationId !== 'unresolved') return fromSemantic;
  }
  if (rawTarget) {
    return resolveResourceTargetOnly(rawTarget);
  }
  return { populationId: 'unresolved', unresolvedText: '(no target)' };
}

function resolveSemanticSubject(
  semanticTarget: SemanticTarget,
  rawTarget: ResourceTarget | undefined,
): ResolvedSubject {
  switch (semanticTarget.kind) {
    case 'billing_customer_cohort': {
      const billingState = semanticTarget.facets?.billingState;
      const tier = semanticTarget.facets?.tier;
      // Population is per-adapter: "1,200 Stripe paying customers" and
      // "412 Paddle paying customers" are different populations, NOT
      // contradictory counts on the same population.
      const adapter = semanticTarget.adapter;
      const base =
        billingState === 'paying'
          ? 'paying_customers'
          : billingState === 'free'
            ? 'free_customers'
            : 'billing_customers';
      const populationId: PopulationId = adapter ? `${base}:${adapter}` : base;
      return {
        populationId,
        cohortRule: tier != null ? { tier } : undefined,
      };
    }
    case 'product_user_cohort': {
      const table = semanticTarget.table.trim().toLowerCase();
      const billingState = semanticTarget.facets?.billingState;
      const populationId: PopulationId =
        billingState === 'paying'
          ? `product:${table}:paying`
          : billingState === 'free'
            ? `product:${table}:free`
            : `product:${table}`;
      const semanticRule: CohortRule = {};
      if (semanticTarget.facets?.tier) semanticRule.plan = semanticTarget.facets.tier;
      if (semanticTarget.facets?.linkage === 'unlinked') semanticRule.billing_platform = null;
      const rawRule =
        rawTarget && rawTarget.surface === 'db' && rawTarget.name.trim().toLowerCase() === table
          ? rawTarget.filter
          : undefined;
      return {
        populationId,
        cohortRule: mergeCohortRules(semanticRule, rawRule),
      };
    }
  }
}

function resolveResourceTargetOnly(target: ResourceTarget): ResolvedSubject {
  // Stable population id derived from the surface coordinate. Filter
  // becomes the cohort rule verbatim — the canonical world is just the
  // shared semantic projection of the same row set, so filter semantics
  // carry over.
  const populationId: PopulationId =
    target.surface === 'db' ? `db:${target.name}` : `api:${target.name}`;
  return {
    populationId,
    cohortRule: target.filter ? cloneFilter(target.filter) : undefined,
    unresolvedText: `${target.surface}.${target.name}`,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function canonicaliseMetric(op: 'sum' | 'avg', field: string): MetricId {
  // Known metrics keep their canonical name regardless of op so the
  // reconciliation planner can match a sum-of-MRR aggregate against a
  // headline MRR target.
  const norm = field.trim().toLowerCase().replace(/\s+/g, '_');
  if (/^mrr(?:_|$)/.test(norm) && /(change|delta)/.test(norm)) return 'mrr_change';
  if (/(^|_)mrr_change(?:_|$)/.test(norm)) return 'mrr_change';
  if (/(^|_)mrr(?:_|$)/.test(norm)) return 'mrr';
  if (/(^|_)arr(?:_|$)/.test(norm)) return 'arr';
  if (/(^|_)revenue(?:_|$)/.test(norm)) return 'revenue';
  return `${op}_${norm}`;
}

function mergeCohortRules(
  semanticRule: CohortRule,
  rawRule: Filter | undefined,
): CohortRule | undefined {
  const merged: CohortRule = {
    ...semanticRule,
    ...(rawRule ? cloneFilter(rawRule) : {}),
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function canonicaliseWindow(min: string, max: string): CanonicalWindow {
  return {
    start: min,
    end: max,
    granularity: inferGranularity(min, max),
  };
}

function inferGranularity(
  min: string,
  max: string,
): CanonicalWindow['granularity'] {
  const start = new Date(min).getTime();
  const end = new Date(max).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  const days = (end - start) / 86_400_000;
  if (days <= 1.5) return 'day';
  if (days <= 8) return 'week';
  if (days <= 35) return 'month';
  if (days <= 100) return 'quarter';
  return 'year';
}

function anchorWindow(dates: Record<string, string>): CanonicalWindow | undefined {
  const values = Object.values(dates);
  if (values.length === 0) return undefined;
  const sorted = [...values].sort();
  return {
    start: sorted[0]!,
    end: sorted[sorted.length - 1]!,
    granularity: 'day',
  };
}

function cloneFilter(filter: Filter): Filter {
  return JSON.parse(JSON.stringify(filter));
}

function unresolved(
  quote: string,
  unresolvedText: string,
  reason: string,
): CanonicaliseResult {
  return {
    target: { populationId: 'unresolved' },
    gap: { reason, unresolvedText, quote },
  };
}

function mostCommon<T extends string>(values: T[]): T {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T = values[0]!;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}
