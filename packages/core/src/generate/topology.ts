/**
 * Topology — Layer 3 of the V2 architecture.
 *
 * Pure deterministic function: derive a list of `ResourceSlot`s from the
 * schema, adapter resource specs, schema mapping, and (rewritten) claims.
 *
 * One slot per generation surface — a DB table or an API resource. Bridge
 * tables are excluded because the mirror flow produces their rows from
 * the corresponding API slots. Each slot carries the schema/spec context
 * the content LLM needs plus the claims it must satisfy.
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

  const slots: ResourceSlot[] = [];

  // ── DB slots ──────────────────────────────────────────────────────────
  if (schema) {
    for (const table of schema.tables) {
      // Bridge tables are produced by the mirror flow from API slots.
      // The bridge rewriter strips any DB archetypes for them; we mirror
      // that decision here by skipping slot generation.
      if (bridgeTables.has(table.name)) continue;

      // External-mirrored tables (per classification): also skipped — their
      // rows come from the API side via the mirror flow.
      const classification = classificationByTable.get(table.name);
      if (classification?.role === 'external-mirrored') continue;

      const slotClaims = claims.filter(
        (c) => c.target.surface === 'db' && c.target.name === table.name,
      );
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
  if (resourceSpecs) {
    for (const [adapterId, specs] of Object.entries(resourceSpecs)) {
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
