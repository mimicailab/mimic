/**
 * V5 — Phase 5: Canonical entity, identity, lifecycle, and anchor types.
 *
 * These shapes describe the SEMANTIC world the planners agree on. They are
 * adapter-agnostic by construction: there are no Stripe `cus_` prefixes,
 * no Chargebee `id` strings, no surface-formatted identifiers anywhere on
 * these types. Surface materialisation is the projector's job (Phase 7),
 * which receives canonical records + `ProjectorHints` and is the ONLY
 * place that mints final external IDs.
 *
 * Enforced by the import-lint rule (Phase 13): nothing under `planner/`
 * may import from `projection/identity-prefix.ts`, adapter manifests, or
 * `ProjectorHints`.
 */

import type { PopulationId } from '../contract/clause-types.js';

/** Stable canonical entity id — adapter-agnostic. */
export type EntityId = string;

/** Cohort label, e.g. `starter`, `pro`, `paying`, `churn_risk`. */
export type CohortId = string;

export type LifecycleStatus =
  | 'active'
  | 'trialing'
  | 'paused'
  | 'churned'
  | 'past_due'
  | 'pending';

export interface EntityLifecycle {
  /** ISO date the entity entered the world. */
  start: string;
  /** ISO date the entity exited, when applicable. */
  end?: string;
  /** Current status — owned by the lifecycle planner. */
  status: LifecycleStatus;
}

export interface SurfaceBinding {
  /** Abstract surface key (e.g. `db`, `stripe`, `gocardless`). */
  surface: string;
  /** Canonical object class on that surface (e.g. `users`, `customer`). */
  objectKind: string;
}

export interface CanonicalEntity {
  id: EntityId;
  populationId: PopulationId;
  /** Semantic kind carried by the canonical world, when known. */
  kind?: string;
  /**
   * Cohort memberships. A single entity may belong to multiple cohorts
   * (e.g. {paying, starter, monthly}); ordering is irrelevant so we use a
   * Set.
   */
  cohorts: Set<CohortId>;
  /**
   * Free-form canonical attributes. Field names belong to the canonical
   * vocabulary (e.g. `tier`, `mrr`, `region`), NOT to any surface field
   * name. Projectors translate these to surface columns.
   */
  attrs: Record<string, unknown>;
  /**
   * Surface/object pairs this entity actually owns. Phase 6 derives
   * `IdentityRecord.slots` from these bindings instead of minting slots for
   * every coordinate mentioned anywhere in the contract.
   */
  surfaceBindings?: SurfaceBinding[];
  lifecycle: EntityLifecycle;
}

// ---------------------------------------------------------------------------
// Identity slots — Phase 6 boundary
// ---------------------------------------------------------------------------

/**
 * One surface slot reservation. Canonical only — no prefixes, no casing
 * rules, no final ID strings. The projector reads `(IdentityRecord, ProjectorHints)`
 * and mints the surface-formatted identifier from `deterministicSeed`.
 *
 * `surface` is the abstract surface key (e.g. `db`, `stripe`, `hubspot`),
 * NOT a vendor-specific URL or namespace. `objectKind` is the canonical
 * object class (e.g. `customer`, `subscription`, `contact`).
 */
export interface IdentitySlot {
  surface: string;
  objectKind: string;
  /**
   * Stable seed material the projector hashes/prefixes when minting the
   * surface ID. Must be derivable from the canonical entity alone; must
   * never contain provider-shaped text.
   */
  deterministicSeed: string;
}

export interface IdentityRecord {
  entityId: EntityId;
  slots: IdentitySlot[];
}

// ---------------------------------------------------------------------------
// Lifecycle events
// ---------------------------------------------------------------------------

export type LifecycleEventKind =
  | 'start'
  | 'renewal'
  | 'failure'
  | 'churn'
  | 'refund'
  | 'pause'
  | 'resume'
  | 'upgrade'
  | 'downgrade';

export interface LifecycleEvent {
  entityId: EntityId;
  kind: LifecycleEventKind;
  /** ISO date or full timestamp. */
  timestamp: string;
  /**
   * Canonical event attributes. Examples: refund amount in cents,
   * failure code, upgrade-from/to tier names.
   */
  attrs: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

export type AnchorId = string;

export interface AnchorBinding {
  anchorId: AnchorId;
  /** Resolved canonical entity the anchor binds to. */
  entityId: EntityId;
  /**
   * Named dates from the persona clause (preserved verbatim). At minimum
   * `event` is present.
   */
  dates: Record<string, string>;
}
