/**
 * Row-selection primitives shared between the contract clause types and the
 * shape/contract validators.
 *
 * V5 note: in V4.5 this file was the home of the legacy `Claim` /
 * `AuditResult` / `BlueprintPatch` types that powered the lowered execution
 * plan. Those were deleted in Phase 1. What remains are the small, neutral
 * shapes describing *where* in the materialised dataset a clause's predicate
 * is evaluated — they survive because clause-types.ts, semantic-capabilities,
 * the helper checkers, and `validation/select-rows.ts` all share this
 * vocabulary.
 */

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
 */
export type Filter = Record<string, unknown | FilterOp>;

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
