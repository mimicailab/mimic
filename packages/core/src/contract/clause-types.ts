/**
 * V4.5 — Persona contract clause types.
 *
 * A `Clause` is a single faithful parse of a persona requirement. It is richer
 * than the legacy `Claim` (which is the lowered execution-plan input the
 * generator consumes). Clauses preserve the source quote, the requirement
 * family, and the strength (hard | soft), and they survive lowering so the
 * fidelity validator can still check them against the final output.
 *
 * Reference: private/v4.5.md — "Layer 1: Contract compiler".
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

export type SemanticTarget = BillingCustomerCohortSemanticTarget;

export type SemanticFieldHint = 'tier';

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
