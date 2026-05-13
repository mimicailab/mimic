/**
 * Persona contract — structured predicates extracted from the persona NL.
 *
 * Each Claim is a checkable assertion the seeded data must satisfy. The LLM
 * extracts claims from the persona description, and the auditor evaluates
 * them against materialized rows after expansion. Unsatisfied claims trigger
 * a bounded repair loop; if they still fail, generation aborts with the
 * persona quote in the error.
 *
 * Replaces the old `Fact` shape, which was descriptive prose that nothing
 * checked.
 */

import type { FieldVariation, EntityArchetype } from './blueprint.js';

// ---------------------------------------------------------------------------
// Filter — how to select rows for a claim's predicate
// ---------------------------------------------------------------------------

/**
 * A single filter operator. Supports equality (bare value or `eq`),
 * membership, comparison, null check, and date-age semantics.
 */
export type FilterOp =
  | { eq: unknown }
  | { neq: unknown }
  | { in: unknown[] }
  | { nin: unknown[] }
  | { gte: number | string }
  | { lte: number | string }
  | { gt: number | string }
  | { lt: number | string }
  | { is_null: boolean }
  /** For date/timestamp fields: today − row[field] >= N days */
  | { age_days_gte: number }
  | { age_days_lte: number };

/**
 * A filter is a conjunction of per-field predicates. Field name is the key;
 * the value is either a bare expected value (treated as `eq`) or a FilterOp.
 *
 * Example: `{ plan: 'pro', status: { in: ['active', 'past_due'] }, last_login_at: { age_days_gte: 30 } }`
 */
export type Filter = Record<string, unknown | FilterOp>;

// ---------------------------------------------------------------------------
// ResourceTarget — what surface + name + filter the predicate runs against
// ---------------------------------------------------------------------------

export interface ResourceTarget {
  /** Which side of the data to query */
  surface: 'db' | 'api';
  /**
   * Resource identifier.
   * - For `db`: table name (e.g. "users", "invoices").
   * - For `api`: `<adapter>.<resource>` (e.g. "stripe.charges", "chargebee.invoice").
   */
  name: string;
  /** Optional filter narrowing the row set */
  filter?: Filter;
}

// ---------------------------------------------------------------------------
// Claim — discriminated union over predicate kinds
// ---------------------------------------------------------------------------

interface ClaimBase {
  /** Stable id used for citation by archetypes and for repair plumbing */
  id: string;
  /** Exact persona text this claim was extracted from — echoed in error messages */
  quote: string;
}

export type Claim =
  | (ClaimBase & {
      kind: 'row_count';
      target: ResourceTarget;
      expected: number;
      /** Optional absolute tolerance — `expected ± tolerance` is acceptable */
      tolerance?: number;
    })
  | (ClaimBase & {
      kind: 'aggregate_sum';
      target: ResourceTarget;
      field: string;
      /** Expected sum (in the field's native units — e.g. cents for integer_cents) */
      expected: number;
      /** Optional absolute tolerance on the sum */
      tolerance?: number;
    })
  | (ClaimBase & {
      kind: 'aggregate_avg';
      target: ResourceTarget;
      field: string;
      expected: number;
      tolerance?: number;
    })
  | (ClaimBase & {
      kind: 'pinned_field';
      target: ResourceTarget;
      field: string;
      /** Required value. Strings, numbers, booleans only — no nested structures */
      expected: string | number | boolean | null;
      /**
       * When true, EVERY selected row must hold this value (failure on any).
       * When false, at least one row must hold this value (failure on none).
       */
      perRow: boolean;
    })
  | (ClaimBase & {
      kind: 'distribution_pct';
      target: ResourceTarget;
      field: string;
      /** Map of value → expected percentage (0-100). Need not sum to 100. */
      values: Record<string, number>;
      /** Allowed absolute deviation per bucket, in percentage points */
      tolerance?: number;
    })
  | (ClaimBase & {
      kind: 'date_window';
      target: ResourceTarget;
      field: string;
      /** ISO date or full ISO timestamp — inclusive lower bound */
      min: string;
      /** ISO date or full ISO timestamp — inclusive upper bound */
      max: string;
      /** Expected count of rows whose `field` is within [min, max] */
      expected: number;
      tolerance?: number;
    })
  | (ClaimBase & {
      kind: 'orphans_exactly';
      /**
       * Cross-surface orphan check. Target should be an API resource;
       * orphans are rows whose `id` has no corresponding DB identity row.
       */
      target: ResourceTarget;
      expected: number;
    })
  | (ClaimBase & {
      kind: 'no_row_with';
      /** The predicate must hold ZERO matching rows */
      target: ResourceTarget;
    });

export type ClaimKind = Claim['kind'];

// ---------------------------------------------------------------------------
// Audit result
// ---------------------------------------------------------------------------

/** A single claim's evaluation outcome */
export interface ClaimEvaluation {
  claim: Claim;
  passed: boolean;
  /**
   * Human-readable predicate description, e.g.
   * `sum(chargebee.invoice.total where status='payment_due') = 1240000`.
   */
  predicate: string;
  /** Actual value/count observed in the data */
  actual: number | string | Record<string, number> | null;
  /** Up to 5 sample rows from the selection — for diagnostics */
  sampleRows?: unknown[];
  /** When passed=false: which archetype labels cited this claim, if any */
  citedBy?: string[];
}

export interface AuditResult {
  evaluations: ClaimEvaluation[];
  /** Convenience accessor — claims that didn't pass */
  failures: ClaimEvaluation[];
}

// ---------------------------------------------------------------------------
// BlueprintPatch — repair output the LLM emits
// ---------------------------------------------------------------------------

/**
 * A dotted path into the blueprint AST.
 *
 * Examples:
 *  - `data.entityArchetypes.users.archetypes[pro-churn-risk].fields.last_login_at`
 *  - `data.apiEntityArchetypes.stripe.price[starter-monthly].fields.unit_amount`
 *
 * Archetype lookup uses `[<label>]` rather than numeric index to survive
 * archetype reorderings between attempts.
 */
export type BlueprintPath = string;

export type PatchOp =
  | { op: 'set_field'; path: BlueprintPath; value: unknown }
  | { op: 'set_vary'; path: BlueprintPath; variation: FieldVariation }
  | { op: 'set_count'; path: BlueprintPath; count: number }
  | {
      op: 'add_archetype';
      /** Either a DB table name or `<adapter>.<resource>` */
      target: string;
      surface: 'db' | 'api';
      archetype: EntityArchetype;
    }
  | {
      op: 'remove_archetype';
      target: string;
      surface: 'db' | 'api';
      label: string;
    };

export interface BlueprintPatch {
  ops: PatchOp[];
  /** 1-2 sentence rationale — for telemetry and debugging */
  rationale: string;
}

// ---------------------------------------------------------------------------
// Repair attempt log — for surfacing history when both attempts fail
// ---------------------------------------------------------------------------

export interface RepairAttempt {
  attempt: number;
  patch: BlueprintPatch;
  /** Audit result AFTER applying this patch */
  resultingAudit: AuditResult;
}
