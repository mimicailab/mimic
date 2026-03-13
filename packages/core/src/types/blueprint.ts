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
    | 'sequence';
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
}

/** Per-table archetype configuration */
export interface EntityArchetypeConfig {
  /** Target count of entities to generate for this table */
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
  /** API field name (e.g. "id") */
  apiField: string;
  /** Whether this DB table is a "bridge table" — a projection of API data into the DB */
  isBridgeTable: boolean;
}

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
