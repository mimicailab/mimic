/**
 * Topology — Layer 3 of the V2 architecture.
 *
 * Pure deterministic function: derive a list of `ResourceSlot`s from the
 * schema, adapter resource specs, schema mapping, and (rewritten) claims.
 *
 * One slot per generation surface — a DB table or an API resource. Each slot
 * carries the schema/spec context the content LLM needs plus the claims it
 * must satisfy.
 *
 * Slot inclusion policy (V2.5):
 *   - Bridge tables: skipped UNLESS at least one claim targets the table with
 *     a cross-cutting filter (no platform discriminator). E.g. `db.users where
 *     plan='free'` or `billing_platform is_null`. Those rows live only on the
 *     DB side and the mirror flow can't produce them.
 *   - API/DB slots: kept when at least one claim targets them, the table is an
 *     identity/structural anchor, or another retained slot references them
 *     via FK. Everything else is pruned so the content LLM doesn't waste a
 *     call designing archetypes for resources the persona never mentions.
 *
 * Reference: private/v2.md — "Layer 3: Topology + count solving".
 */

import type { SchemaModel, TableInfo, AdapterResourceSpecs, ResourceSpec, TableClassification } from '../types/index.js';
import type { SchemaMapping } from '../types/blueprint.js';
import type { Claim } from '../types/claim.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One concrete generation surface. Inputs for the per-slot content LLM call.
 */
export interface ResourceSlot {
  /** Surface — DB table or API resource */
  surface: 'db' | 'api';
  /** Slot identifier — table name for db, "<adapter>.<resource>" for api */
  name: string;
  /** Stable join key for downstream code: `${surface}:${name}` */
  key: string;
  /** Schema info for DB slots (column types, FKs, required columns) */
  dbTable?: TableInfo;
  /** Adapter id for API slots */
  adapterId?: string;
  /** Resource type within the adapter (e.g. "customer", "subscription") */
  resourceType?: string;
  /** Adapter platform metadata for API slots */
  apiPlatform?: AdapterResourceSpecs['platform'];
  /** Resource spec for API slots */
  apiResource?: ResourceSpec;
  /** Claims this slot must satisfy (filtered from the rewritten claim list) */
  claims: Claim[];
  /**
   * Suggested total row count for the slot's EntityArchetypeConfig.count.
   * Used as a default when assembling; the count solver may override per-
   * archetype counts via the cites graph downstream.
   */
  suggestedCount: number;
  /**
   * True when this is a DB slot for a bridge table, included specifically
   * to produce cross-cutting (DB-only) rows the mirror flow can't generate.
   * The content prompt must instruct the LLM to emit only DB-only
   * archetypes (free-tier, orphan, billing_platform is_null).
   */
  dbOnlyBridge?: boolean;
}

export interface DeriveSlotsOptions {
  schema?: SchemaModel;
  resourceSpecs?: Record<string, AdapterResourceSpecs>;
  schemaMapping?: SchemaMapping;
  /** Used to exclude tables flagged external-mirrored or covered by the API */
  tableClassifications?: TableClassification[];
  /** Persona claims, post bridge-rewrite. Used to attach claims to slots. */
  claims: ReadonlyArray<Claim>;
  /**
   * Volume hint from config (e.g. "6 months"). Influences the default
   * row-count suggestion when a slot has no row_count claim.
   */
  volume?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive the full list of ResourceSlots for V2 content generation.
 */
export function deriveSlots(options: DeriveSlotsOptions): ResourceSlot[] {
  const {
    schema,
    resourceSpecs,
    schemaMapping,
    tableClassifications,
    claims,
  } = options;

  const bridgeTables = new Set<string>(schemaMapping?.bridgeTables ?? []);
  const classificationByTable = new Map<string, TableClassification>();
  for (const c of tableClassifications ?? []) {
    classificationByTable.set(c.table, c);
  }

  // FK target set — DB tables referenced by another table. We must produce
  // them so dependent rows can resolve their foreign keys, even when the
  // persona doesn't name them.
  const fkTargets = new Set<string>();
  if (schema) {
    for (const t of schema.tables) {
      for (const fk of t.foreignKeys) {
        fkTargets.add(fk.referencedTable);
      }
    }
  }

  const slots: ResourceSlot[] = [];

  // ── DB slots ──────────────────────────────────────────────────────────
  if (schema) {
    for (const table of schema.tables) {
      const slotClaims = claims.filter(
        (c) => c.target.surface === 'db' && c.target.name === table.name,
      );

      const classification = classificationByTable.get(table.name);
      const isExternalMirrored = classification?.role === 'external-mirrored';
      const isBridge = bridgeTables.has(table.name);

      // Bridge tables: skip unless a claim targets the table with a
      // cross-cutting filter (free-tier users, orphan paid-no-billing, etc).
      // Those rows live only on the DB side and the mirror flow won't emit
      // them, so we DO need a slot to design archetypes that produce them.
      if (isBridge) {
        const crossCuttingClaims = slotClaims.filter(claimIsCrossCutting);
        if (crossCuttingClaims.length === 0) continue;
        slots.push({
          surface: 'db',
          name: table.name,
          key: `db:${table.name}`,
          dbTable: table,
          claims: crossCuttingClaims,
          suggestedCount: suggestForDbSlot(table, crossCuttingClaims),
          // Tag so the content prompt knows to emit ONLY cross-cutting
          // archetypes — the mirror flow handles platform-tagged rows.
          dbOnlyBridge: true,
        });
        continue;
      }

      // External-mirrored tables (per classification): their rows come from
      // API mirror flow. Skip unless there's a claim that forces a DB slot.
      if (isExternalMirrored && slotClaims.length === 0) continue;

      // Pruning: only keep DB slots that have claims OR are structurally
      // required (identity tables, FK targets, primary entity tables).
      const structurallyRequired =
        classification?.role === 'identity' ||
        fkTargets.has(table.name);

      if (slotClaims.length === 0 && !structurallyRequired) continue;

      slots.push({
        surface: 'db',
        name: table.name,
        key: `db:${table.name}`,
        dbTable: table,
        claims: slotClaims,
        suggestedCount: suggestForDbSlot(table, slotClaims),
      });
    }
  }

  // ── API slots ─────────────────────────────────────────────────────────
  // Per-adapter resource sets that are claim-cited — used to decide which
  // sibling resources to include for FK/coherence even without their own
  // claims (e.g. if `stripe.subscription` is cited, keep `stripe.price` too
  // because subscriptions reference prices).
  const claimsByAdapter = new Map<string, Set<string>>();
  for (const c of claims) {
    if (c.target.surface !== 'api') continue;
    const dot = c.target.name.indexOf('.');
    if (dot < 0) continue;
    const adapter = c.target.name.slice(0, dot);
    if (!claimsByAdapter.has(adapter)) claimsByAdapter.set(adapter, new Set());
    claimsByAdapter.get(adapter)!.add(c.target.name);
  }

  if (resourceSpecs) {
    for (const [adapterId, specs] of Object.entries(resourceSpecs)) {
      const adapterHasClaims = claimsByAdapter.has(adapterId);

      for (const [resourceType, spec] of Object.entries(specs.resources)) {
        const slotName = `${adapterId}.${resourceType}`;
        // Two forms of "api.<adapter>.<resource>" targets may appear in
        // claims — the spec key (e.g. "customer") or the assembler's
        // alias (e.g. "customers" plural). Match either; topology is
        // permissive here and the auditor evaluates against the
        // materialised data regardless.
        const slotClaims = claims.filter((c) => {
          if (c.target.surface !== 'api') return false;
          if (c.target.name === slotName) return true;
          // Plural/singular flexibility: "<adapter>.<plural>" matches
          // when stripping a trailing 's' lands on the spec key.
          const dot = c.target.name.indexOf('.');
          if (dot < 0) return false;
          const adapter = c.target.name.slice(0, dot);
          if (adapter !== adapterId) return false;
          const rest = c.target.name.slice(dot + 1);
          // Allow simple plural form
          return singularise(rest) === resourceType;
        });

        if (slotClaims.length === 0) {
          // Persona doesn't mention this resource. Skip unless the adapter
          // is engaged AND this resource is a structural primary (customer
          // is the canonical entity; the mirror flow always needs it for
          // identity binding).
          if (!adapterHasClaims) continue;
          if (!isStructuralPrimary(resourceType, spec)) continue;
        }

        slots.push({
          surface: 'api',
          name: slotName,
          key: `api:${slotName}`,
          adapterId,
          resourceType,
          apiPlatform: specs.platform,
          apiResource: spec,
          claims: slotClaims,
          suggestedCount: suggestForApiSlot(spec, slotClaims),
        });
      }
    }
  }

  return slots;
}

/**
 * A claim is "cross-cutting" if its filter doesn't pin a specific
 * `billing_platform` (or analogous platform discriminator). Such claims
 * describe rows that live only on the DB side of a bridge table — the
 * mirror flow won't produce them.
 */
function claimIsCrossCutting(claim: Claim): boolean {
  const filter = claim.target.filter;
  if (!filter || Object.keys(filter).length === 0) return true;
  // If filter pins a billing platform (eq), it's a platform-tagged row
  // and the mirror flow handles it. If it says is_null on billing_platform
  // (or omits it entirely), it's cross-cutting.
  const platform = filter['billing_platform'] ?? filter['platform'];
  if (platform == null) return true;
  if (typeof platform === 'object' && platform !== null && 'op' in platform) {
    const op = (platform as { op?: string }).op;
    if (op === 'is_null' || op === 'eq_null') return true;
  }
  return false;
}

/**
 * Heuristic: is `<resource>` the structural primary entity for an adapter?
 * Used to keep customer-like resources when sibling resources are cited but
 * customer itself isn't.
 */
function isStructuralPrimary(resourceType: string, spec: ResourceSpec): boolean {
  if (resourceType === 'customer' || resourceType === 'customers') return true;
  if (resourceType === 'account' || resourceType === 'accounts') return true;
  if (resourceType === 'subscriber' || resourceType === 'subscribers') return true;
  // Any resource that other resources reference is a structural primary.
  return spec.volumeHint === 'entity' && (spec.refs?.length ?? 0) === 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a default `EntityArchetypeConfig.count` for a DB slot.
 *
 *  1. If any unfiltered row_count claim names this exact table, use its
 *     expected — that's the explicit total.
 *  2. Else if any row_count claims name this table, use the SUM of their
 *     expected counts (cover all narrated sub-groups).
 *  3. Else fall back to a small default (50) — the schema asked for the
 *     table so we need at least some rows. The count solver may scale
 *     this once it sees cites.
 */
function suggestForDbSlot(table: TableInfo, claims: Claim[]): number {
  void table;
  const rowCounts = claims.filter(
    (c): c is Extract<Claim, { kind: 'row_count' }> => c.kind === 'row_count',
  );
  if (rowCounts.length === 0) return DEFAULT_DB_SLOT_COUNT;

  const unfiltered = rowCounts.find((c) => !c.target.filter || Object.keys(c.target.filter).length === 0);
  if (unfiltered) return unfiltered.expected;

  return rowCounts.reduce((sum, c) => sum + c.expected, 0);
}

/**
 * Compute a default `EntityArchetypeConfig.count` for an API slot.
 *
 * Mirrors the DB version but uses the spec's volumeHint for the fallback:
 *   - "reference" → small fixed count (e.g. products, prices)
 *   - "entity"    → larger default
 */
function suggestForApiSlot(spec: ResourceSpec, claims: Claim[]): number {
  const rowCounts = claims.filter(
    (c): c is Extract<Claim, { kind: 'row_count' }> => c.kind === 'row_count',
  );
  if (rowCounts.length > 0) {
    const unfiltered = rowCounts.find((c) => !c.target.filter || Object.keys(c.target.filter).length === 0);
    if (unfiltered) return unfiltered.expected;
    return rowCounts.reduce((sum, c) => sum + c.expected, 0);
  }
  return spec.volumeHint === 'reference' ? DEFAULT_REFERENCE_COUNT : DEFAULT_API_SLOT_COUNT;
}

/** Strip a single trailing 's' for plural→singular matching. */
function singularise(s: string): string {
  if (s.endsWith('ies')) return s.slice(0, -3) + 'y';
  if (s.endsWith('ses') || s.endsWith('xes') || s.endsWith('zes')) return s.slice(0, -2);
  if (s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1);
  return s;
}

const DEFAULT_DB_SLOT_COUNT = 50;
const DEFAULT_API_SLOT_COUNT = 50;
const DEFAULT_REFERENCE_COUNT = 5;
