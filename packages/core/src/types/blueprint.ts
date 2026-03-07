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
  salary?: number;
  description: string;
}

/** Domain-specific data — varies by domain, validated by Zod */
export interface PersonaData {
  entities: Record<string, EntityData[]>;
  patterns: DataPattern[];
  annotations: Record<string, unknown>;
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
