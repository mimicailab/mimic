/**
 * V5 — Persona contract clause types.
 *
 * A `Clause` is a single faithful parse of a persona requirement. The contract
 * compiler emits clauses with `source`, `family`, `strength`, and optionally
 * `canonicalTarget` populated; the canonicaliser (Phase 3) validates compiler
 * annotations and deterministically fills any gaps (and, on unresolved
 * clauses, `canonicalisationGap`); the pre-generation gate (Phase 4) finally
 * stamps `ownerId` on every hard clause that the rule table can assign.
 *
 * In keeping with the V5 design principle "the contract is the runtime plan",
 * canonical meaning, owner attribution, and gap diagnostics all live directly
 * on the clause — never in a parallel `Map<ClauseId, …>` sidecar.
 */

import type { ResourceTarget, Filter } from '../types/claim.js';

// ---------------------------------------------------------------------------
// Semantic targets
// ---------------------------------------------------------------------------

export interface BillingCustomerCohortSemanticTarget {
  kind: 'billing_customer_cohort';
  /** Adapter that owns the billing truth, e.g. stripe. */
  adapter: string;
  facets?: {
    /** Canonical business tier, e.g. starter | pro | enterprise. */
    tier?: string;
    /** Paying/free lifecycle bucket. */
    billingState?: 'paying' | 'free';
  };
}

export interface ProductUserCohortSemanticTarget {
  kind: 'product_user_cohort';
  /** Product-side user table, e.g. users. */
  table: string;
  facets?: {
    /** Canonical business tier, e.g. starter | pro | enterprise. */
    tier?: string;
    /** Paying/free lifecycle bucket in the product database. */
    billingState?: 'paying' | 'free';
    /** Whether the user is linked to a billing platform record. */
    linkage?: 'linked' | 'unlinked';
  };
}

export type SemanticTarget = BillingCustomerCohortSemanticTarget | ProductUserCohortSemanticTarget;

export type SemanticFieldHint = 'tier';

// ---------------------------------------------------------------------------
// Canonical target — compiler-authored when available, validated by Phase 3
// ---------------------------------------------------------------------------

/**
 * Stable identifier for a named population. Examples:
 *   - `paying_customers`
 *   - `free_customers`
 *   - `pro_customers`
 *
 * The canonicaliser maps persona language onto these IDs so every planner
 * downstream agrees on the entity set being talked about.
 */
export type PopulationId = string;

/**
 * Stable identifier for a metric. Examples: `mrr`, `arr`, `mrr_change`,
 * `count`. Reconciliation, aggregate, and temporal clauses share this name
 * so the budgets they imply can be cross-referenced.
 */
export type MetricId = string;

/**
 * Filter expression over a canonical entity's attributes. Reuses the
 * existing `Filter` shape because canonical entities live in the same
 * `Record<string, unknown>` space as raw rows — the semantic field
 * vocabulary is just stable across surfaces.
 */
export type CohortRule = Filter;

/** Time window attached to a canonical target. */
export interface CanonicalWindow {
  /** ISO date or full timestamp — inclusive lower bound. */
  start: string;
  /** ISO date or full timestamp — inclusive upper bound. */
  end: string;
  /** Granularity hint — left undefined when irrelevant. */
  granularity?: 'day' | 'week' | 'month' | 'quarter' | 'year';
}

/**
 * Canonical interpretation of a clause's subject. May be authored by the
 * compiler and is validated/finalised by the canonicaliser; required on every
 * clause after Phase 3 (the
 * pre-generation gate (Phase 4) reads it directly).
 *
 * `populationId === 'unresolved'` is the canonicaliser's signal that the
 * persona language could not be resolved; the matching
 * `canonicalisationGap` carries the diagnostic.
 */
export interface CanonicalTarget {
  populationId: PopulationId | 'unresolved';
  cohortRule?: CohortRule;
  metricId?: MetricId;
  window?: CanonicalWindow;
}

/**
 * Diagnostic for a clause the canonicaliser could not resolve. Folded into
 * the Phase 4 combined contradiction + coverage report. Absent on success.
 */
export interface CanonicalisationGap {
  reason: string;
  unresolvedText: string;
  /** Echoes `clause.quote` for report-rendering convenience. */
  quote: string;
}

// ---------------------------------------------------------------------------
// Owner — populated by Phase 4 (pre-generation gate)
// ---------------------------------------------------------------------------

/**
 * Identifier of the V5 planner that owns a clause's execution. Hard clauses
 * MUST carry one after the gate passes; the rule table in `planner/owners.ts`
 * is the single source of truth for assignment.
 */
export type OwnerId =
  | 'population'
  | 'lifecycle'
  | 'anchor'
  | 'identity'
  | 'reconciliation';

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

/**
 * Hard clauses are allowed to block the run if they cannot be covered.
 * Soft clauses are nice-to-have and never block.
 */
export type ClauseStrength = 'hard' | 'soft';

export type ClauseFamily =
  | 'count'
  | 'aggregate'
  | 'distribution'
  | 'temporal'
  | 'anchor'
  | 'cross_surface'
  | 'reconciliation'
  | 'narrative';

interface ClauseBase {
  /** Stable clause id (kebab-case-ish, e.g. "overdue-invoice-count") */
  id: string;
  /** Exact quote / source span from the persona description */
  quote: string;
  /** Family discriminator (mirrored in payload-specific kind for clarity) */
  family: ClauseFamily;
  /** Hard or soft */
  strength: ClauseStrength;
  /**
  * Canonical interpretation. Optional in the raw compiler output; validated
  * and normalised by the canonicaliser (Phase 3), and required after
  * canonicalisation.
   *
   * When `canonicalTarget.populationId === 'unresolved'`, the matching
   * `canonicalisationGap` describes why.
   */
  canonicalTarget?: CanonicalTarget;
  /**
   * Owner planner identifier. Populated by the pre-generation gate (Phase 4)
   * once every hard clause has been matched to a planner via `planner/owners.ts`.
   * Soft / narrative clauses may remain unowned without blocking the gate.
   */
  ownerId?: OwnerId;
  /**
   * Diagnostic from the canonicaliser. Set ONLY on clauses Phase 3 could not
   * resolve; the Phase 4 gate reads this to fold canonicalisation gaps into
   * the single combined `ContradictionAndCoverageReport`.
   */
  canonicalisationGap?: CanonicalisationGap;
}

// ---------------------------------------------------------------------------
// Per-family payloads
// ---------------------------------------------------------------------------

/** Count of rows on a resource, with an optional filter. */
export interface CountClause extends ClauseBase {
  family: 'count';
  target?: ResourceTarget;
  semanticTarget?: SemanticTarget;
  expected: number;
  tolerance?: number;
}

/** Aggregate sum/avg on a numeric field of a resource. */
export interface AggregateClause extends ClauseBase {
  family: 'aggregate';
  op: 'sum' | 'avg';
  target?: ResourceTarget;
  semanticTarget?: SemanticTarget;
  field: string;
  expected: number;
  tolerance?: number;
}

/** Distribution of a categorical field across buckets, as percentages 0-100. */
export interface DistributionClause extends ClauseBase {
  family: 'distribution';
  target?: ResourceTarget;
  semanticTarget?: SemanticTarget;
  semanticField?: SemanticFieldHint;
  field: string;
  values: Record<string, number>;
  tolerance?: number;
}

/**
 * Temporal constraints. Two shapes:
 *   - `window`: rows whose date field falls in [min,max] → expected count.
 *   - `relative_gap`: between two anchor events, anchorA happened N days before
 *     anchorB. Only checkable when both anchors are bound and dated.
 */
export type TemporalClause = ClauseBase &
  ({
    family: 'temporal';
    kind: 'window';
    target?: ResourceTarget;
    semanticTarget?: SemanticTarget;
    field: string;
    min: string;
    max: string;
    expected: number;
    tolerance?: number;
  } | {
    family: 'temporal';
    kind: 'relative_gap';
    anchorA: string;
    anchorB: string;
    /** Positive: anchorB is N days after anchorA. Negative: anchorB precedes. */
    days: number;
    tolerance?: number;
  });

/** A named persona event: a customer + dates that must materialise in the data. */
export interface AnchorClause extends ClauseBase {
  family: 'anchor';
  /** Stable anchor id, referenced by archetypes (e.g. "klein_double_charge") */
  anchorId: string;
  /**
   * Free-text customer descriptor (e.g. "Klein Records"). The lowering step
   * turns this into an anchor.customer.match.
   */
  customer?: string;
  /** Named dates — at minimum, `event`. */
  dates: Record<string, string>;
}

/**
 * Cross-surface state disagreement between two surfaces. Example:
 *   "Larkspur is active in Postgres and canceled in Stripe with a 9-day drift".
 */
export interface CrossSurfaceClause extends ClauseBase {
  family: 'cross_surface';
  /** Required to match between the two surfaces */
  entity: string;
  surfaceA: ResourceTarget;
  surfaceB: ResourceTarget;
  /** Field to compare, e.g. "status" */
  field: string;
  /** Expected value on surface A */
  valueA: string | number | boolean;
  /** Expected value on surface B */
  valueB: string | number | boolean;
  /** Optional drift in days (positive = surfaceB lags surfaceA) */
  driftDays?: number;
  driftTolerance?: number;
}

/**
 * Reconciliation: a headline metric equals the sum of named bucket
 * contributions. Example: "MRR drop of -$4,820 explained by 5 named causes".
 */
export interface ReconciliationClause extends ClauseBase {
  family: 'reconciliation';
  /** Stable metric name (e.g. "mrr_delta") */
  metric: string;
  /** Headline / target value */
  headline: number;
  /** Tolerance for the reconciliation equality */
  tolerance?: number;
  /**
   * Named buckets. Each bucket says "contribution `value` comes from rows
   * matching `target`+`filter` aggregated by `field`/`op`".
   */
  buckets: Array<{
    name: string;
    value: number;
    target: ResourceTarget;
    field: string;
    op: 'sum' | 'count';
    filter?: Filter;
  }>;
}

/** Style-only / qualitative requirement. Never executable, never blocking. */
export interface NarrativeClause extends ClauseBase {
  family: 'narrative';
  note: string;
}

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export type Clause =
  | CountClause
  | AggregateClause
  | DistributionClause
  | TemporalClause
  | AnchorClause
  | CrossSurfaceClause
  | ReconciliationClause
  | NarrativeClause;

export type ClauseId = Clause['id'];

export type TargetBearingClause =
  | CountClause
  | AggregateClause
  | DistributionClause
  | Extract<TemporalClause, { kind: 'window' }>;
