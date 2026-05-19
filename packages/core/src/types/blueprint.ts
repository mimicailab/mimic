/** The full persona blueprint — output of LLM generation */
export interface Blueprint {
  version: '1.0';
  personaId: string;
  domain: string;
  generatedAt: string;
  generatedBy: string;
  checksum: string;

  persona: PersonaProfile;
  data: PersonaData;
}

export interface PersonaProfile {
  name: string;
  age: number;
  occupation: string;
  location: string;
  salary?: number | null;
  description: string;
}

/** Domain-specific data — varies by domain, validated by Zod */
export interface PersonaData {
  entities: Record<string, EntityData[]>;
  patterns: DataPattern[];
  annotations?: Record<string, unknown>;
  /** Testable facts about the generated data — used for auto-scenario generation */
  facts?: import('./fact-manifest.js').Fact[];
  /** API entity seeds, keyed by adapter ID then resource type */
  apiEntities?: Record<string, Record<string, EntityData[]>>;
  /** Archetype definitions for scalable entity generation, keyed by table name */
  entityArchetypes?: Record<string, EntityArchetypeConfig>;
  /** API entity archetypes: adapterId → resourceType → EntityArchetypeConfig */
  apiEntityArchetypes?: Record<string, Record<string, EntityArchetypeConfig>>;
  /**
   * Persona-narrated events that imply coherent rows across multiple tables
   * and surfaces (e.g. "Klein Records double-charge on 2026-04-29" implies
   * two payments + two Stripe payment_intents + an invoice — all sharing the
   * same date, customer, and amount). Each anchor names a customer + date(s);
   * archetypes opt in via `EntityArchetype.anchor` to consume the resolved
   * values via `anchor_date` / `anchor_field` vary rules.
   */
  anchors?: Anchor[];
}

/**
 * A persona-narrated event whose implications span multiple tables and
 * possibly multiple surfaces (DB + API). Anchors give the LLM a way to say
 * "these N rows on T tables share a customer and a date" without enumerating
 * every row — the same scaling property `sequence` prefixes give for IDs.
 */
export interface Anchor {
  /** Stable id referenced by archetypes (e.g. "klein_double_charge") */
  id: string;
  /**
   * Customer pinning. `match` looks up the customer by `name` or `company`
   * (case-insensitive); if no row matches, the expander creates one. Single
   * customer for now — multi-customer pick is a future extension.
   */
  customer?: { match: string };
  /**
   * Named dates. Use `event` for the canonical anchor date. Future versions
   * will support derived dates with relative offsets — for now, all dates
   * are ISO strings (date or full timestamp).
   */
  dates: Record<string, string>;
}

/** A single entity row to insert */
export interface EntityData {
  [column: string]: unknown;
}

/** A pattern the expander stamps out into multiple rows */
export interface DataPattern {
  targetTable: string;
  type: 'recurring' | 'variable' | 'periodic' | 'event';

  /**
   * When set, run the pattern **once per entity** in the parent table instead
   * of once globally. Produces realistic per-customer/per-account row volumes
   * for transactional tables (invoices, payments, events, usage_metrics).
   *
   * Any `{{parentTable.column}}` references in the pattern's fields are
   * resolved to the current parent row's values automatically.
   */
  forEachParent?: {
    /** Parent table to iterate over (e.g. "customers") */
    table: string;
    /**
     * FK column in the target table that references the parent.
     * If omitted, inferred from the schema's foreign key constraints.
     */
    foreignKey?: string;
  };

  recurring?: {
    fields: Record<string, unknown>;
    schedule: {
      frequency:
        | 'daily'
        | 'weekly'
        | 'biweekly'
        | 'monthly'
        | 'quarterly'
        | 'yearly';
      dayOfMonth?: number;
      dayOfWeek?: number;
    };
  };

  variable?: {
    fields: Record<string, unknown>;
    randomFields: Record<string, RandomSpec>;
    frequency: FrequencySpec;
    timeBias?: string;
  };

  periodic?: {
    fields: Record<string, unknown>;
    frequency: 'weekly' | 'biweekly' | 'monthly';
  };

  event?: {
    fields: Record<string, unknown>;
    probability: number;
  };
}

export interface RandomSpec {
  type: 'pick' | 'range' | 'decimal_range' | 'date_in_period';
  values?: unknown[];
  min?: number;
  max?: number;
}

export interface FrequencySpec {
  min: number;
  max: number;
  period: 'day' | 'week' | 'month';
}

// ---------------------------------------------------------------------------
// Archetype-based entity generation
// ---------------------------------------------------------------------------

/** Specifies how to vary a single field when cloning an archetype */
export interface FieldVariation {
  /** Strategy for generating varied values */
  type:
    | 'firstName'
    | 'lastName'
    | 'fullName'
    | 'email'
    | 'phone'
    | 'companyName'
    | 'pick'
    | 'range'
    | 'decimal_range'
    | 'uuid'
    | 'timestamp'
    | 'date'
    | 'derived'
    | 'sequence'
    | 'anchor_date'
    | 'anchor_field';
  /** For 'pick': array of possible values */
  values?: unknown[];
  /** For 'range'/'decimal_range': min value */
  min?: number;
  /** For 'range'/'decimal_range': max value */
  max?: number;
  /** For 'derived': template string with {{fieldName}} placeholders, e.g. "{{firstName}}.{{lastName}}@company.com" */
  template?: string;
  /** For 'sequence': prefix string, e.g. "cus_p1_" produces "cus_p1_001", "cus_p1_002" */
  prefix?: string;
  /**
   * For 'anchor_date'/'anchor_field': the anchor id this rule resolves against.
   * Only meaningful when the enclosing archetype is anchor-bound; otherwise
   * the resolver falls back to `null`.
   */
  anchor?: string;
  /**
   * For 'anchor_date': which date key on the anchor to use (defaults to 'event').
   * For 'anchor_field': which resolved attribute of the anchor to read
   * (e.g. 'id' for customer_id, 'stripe_customer_id' for cross-surface FK).
   */
  key?: string;
  /**
   * For 'anchor_date': output format. 'iso' (default) emits an ISO-8601
   * string; 'epoch_seconds' emits a Unix timestamp (used by API archetypes
   * whose targets store dates as integers).
   */
  format?: 'iso' | 'epoch_seconds';
}

/** A representative template row + distribution weight + variation rules */
export interface EntityArchetype {
  /** Human-readable label, e.g. "starter-plan", "enterprise-customer" */
  label: string;
  /** Weight as a fraction (0-1). All archetype weights for a table should sum to ~1.0 */
  weight: number;
  /** The template row — fields that stay constant across all clones */
  fields: Record<string, unknown>;
  /** Fields that get randomized per clone, keyed by column name */
  vary: Record<string, FieldVariation>;
  /**
   * When true on an apiEntityArchetypes archetype, entities derived from it
   * have NO database counterpart. The expander emits them into API responses
   * but skips DB row creation, producing deliberate cross-platform asymmetry
   * (e.g. Stripe-only orphans, Plaid items linked to closed bank accounts).
   *
   * Has no effect on entityArchetypes (DB-side); always false there.
   */
  apiOnly?: boolean;
  /**
   * Explicit row count for this archetype. When set:
   *
   *   - On a plain (non-anchor, non-apiOnly) archetype: emit exactly `count`
   *     rows, bypassing weight redistribution. The remaining
   *     `EntityArchetypeConfig.count - sum(explicitCount archetypes)` is
   *     distributed across weight-only archetypes. Use this for persona-
   *     pinned counts ("exactly 4 card_expired failures") where weight
   *     approximation isn't precise enough.
   *   - On `apiOnly: true`: count is ADDITIVE on top of the matched count
   *     (no DB↔API coordination, since the entity has no DB counterpart).
   *   - On an anchor-bound archetype: count is the number of rows tied to
   *     the resolved anchor (no weight redistribution).
   *
   * If omitted on a plain archetype, the count is derived from
   * `weight × EntityArchetypeConfig.count`.
   */
  count?: number;
  /**
   * Anchor reference. When set, this archetype emits exactly `count` rows
   * (no weight redistribution) bound to the named anchor — every row gets
   * the anchor's resolved customer FK, dates, and other fields wherever
   * `anchor_field`/`anchor_date` vary rules reference them. Enables
   * cross-table coherence: a DB payments archetype and an API
   * payment_intent archetype that share the same anchor will agree on
   * customer, date, and (with a shared sequence prefix) ids.
   */
  anchor?: string;
}

/** Per-table archetype configuration */
export interface EntityArchetypeConfig {
  /**
   * Target MATCHED entity count. apiOnly archetypes contribute additively
   * on top of this — see EntityArchetype.apiOnly + EntityArchetype.count.
   */
  count: number;
  /** The archetype templates */
  archetypes: EntityArchetype[];
}

// ---------------------------------------------------------------------------
// Table classification — deterministic role assignment
// ---------------------------------------------------------------------------

export type TableRole = 'identity' | 'external-mirrored' | 'internal-only';

/** A single mirror source — one adapter+resource pair contributing rows to a mirrored table */
export interface MirrorSource {
  /** Adapter ID (e.g. "stripe", "chargebee") */
  adapter: string;
  /** Resource type within that adapter (e.g. "invoices", "subscriptions") */
  resource: string;
  /** How to distinguish this source's rows — typically a platform discriminator column */
  discriminator?: {
    /** Column that identifies the source platform (e.g. "billing_platform") */
    column: string;
    /** Value for this source (e.g. "stripe", "chargebee") */
    value: string;
  };
}

export interface TableClassification {
  table: string;
  role: TableRole;

  /**
   * For external-mirrored: one or more adapter+resource pairs that contribute rows.
   * A single DB table (e.g. "invoices") can mirror data from Stripe, Chargebee, Paddle, etc.
   * Each source produces its own rows, distinguished by a discriminator column.
   */
  sources?: MirrorSource[];

  /** For external-mirrored: how to resolve FKs back to identity tables */
  identityFks?: {
    /** FK column in this table (e.g. "customer_id") */
    column: string;
    /** Identity table it points to (e.g. "customers") */
    identityTable: string;
    /** Column pair used to match: billing_platform + external_id on the identity table */
    matchOn: { platformColumn: string; externalIdColumn: string };
    /** API field on the mirrored resource that contains the identity reference (e.g. "customer") */
    apiField: string;
  }[];
}

// ---------------------------------------------------------------------------
// Schema mapping — LLM-derived DB↔API field correspondence
// ---------------------------------------------------------------------------

/**
 * Describes how a single DB table/column maps to an API adapter resource/field.
 * Generated by an LLM call that inspects the DB schema and adapter resource list.
 */
export interface SchemaMappingEntry {
  /** DB table name (e.g. "customers") */
  dbTable: string;
  /** DB column name (e.g. "external_id") */
  dbColumn: string;
  /** Adapter ID (e.g. "stripe") */
  adapterId: string;
  /** API resource type (e.g. "customers") */
  apiResource: string;
  /**
   * API field name (e.g. "id"). Used as the source for a blind copy when no
   * `derivation` is set. When `derivation` is set, this is informational only —
   * the derivation's `from` path takes over as the value source.
   */
  apiField: string;
  /** Whether this DB table is a "bridge table" — a projection of API data into the DB */
  isBridgeTable: boolean;
  /**
   * Whether DB and API are required to hold the same value on logically-paired
   * rows (`mirror`) or are permitted to intentionally diverge (`drift_capable`).
   *
   * - `mirror`: anchor-bound row reconciliation enforces DB→API equality on
   *   this column. Use for cross-surface facts that can't legitimately
   *   differ — amounts, currencies, FK references to shared entities,
   *   immutable timestamps, id mappings. An agent reading either side
   *   expects the same value.
   *
   * - `drift_capable`: reconciliation leaves the field alone so persona-
   *   narrated divergence survives expansion. Use for state-at-a-moment
   *   fields where real-world systems frequently lag — row status, period
   *   rollover dates, cancellation timestamps. (Non-anchor rows still get
   *   the API value pulled into the DB by the mirror flow; only the
   *   anchor-paired reconciler skips it.)
   *
   * Required on every mapping. For id mappings the value is always
   * `mirror` — cross-surface IDs by definition must match.
   */
  direction: 'mirror' | 'drift_capable';
  /**
   * Optional derivation rule. When ABSENT, the mirror does a blind copy of
   * `body[apiField] → row[dbColumn]`. Use this default whenever the source
   * field's value space already equals the destination column's value space
   * (e.g. both are open strings, or both are the same enum).
   *
   * When PRESENT, the derivation determines what gets written. Two shapes:
   *
   * - `{ from, cases, default? }` — read the value at the dot-path `from` on
   *   the API body, look it up in `cases` (the source-value → destination-
   *   value map), and write the destination value. If no case matches, use
   *   `default` (or fail if `default` is absent). Required when the source
   *   field's vocabulary doesn't equal the destination's (e.g. mapping a
   *   numeric `price.unit_amount` to a categorical `plan` enum).
   *
   * - `{ value }` — write the constant `value` regardless of the API body.
   *   Used when no API field encodes the destination column (e.g. every
   *   GoCardless customer is on the starter plan by persona declaration).
   */
  derivation?: MappingDerivation;
}

/** Discriminated union of derivation shapes. See SchemaMappingEntry.derivation. */
export type MappingDerivation =
  | {
      kind: 'derive';
      /**
       * Dot-path on the API response body. Supports both array index forms:
       *   `items.data[0].price.unit_amount`
       *   `items.data.0.price.unit_amount`
       * Numeric path segments are array indices; string segments are keys.
       */
      from: string;
      /**
       * Source value → destination value. Keys are stringified source values
       * (numbers stringify naturally — "2900" matches `unit_amount: 2900`).
       * Every destination value must be in the destination column's enum
       * (validated post-LLM).
       */
      cases: Record<string, string | number | boolean>;
      /**
       * Fallback when the source value doesn't appear in `cases`. Omit to
       * make the mirror fail loudly on unexpected source values — useful
       * for catching new tiers or out-of-spec data.
       */
      default?: string | number | boolean;
    }
  | {
      kind: 'constant';
      value: string | number | boolean;
    };

/**
 * Full schema mapping result from the LLM.
 * Maps DB tables/columns to API adapter resources/fields.
 */
export interface SchemaMapping {
  /** All field-level mappings between DB and API */
  mappings: SchemaMappingEntry[];
  /**
   * DB tables identified as "bridge tables" — tables whose rows are derived
   * from API platform data rather than being independent entities.
   * These tables typically have columns like `billing_platform` + `external_id`.
   */
  bridgeTables: string[];
}
