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
  /** API entity seeds, keyed by adapter ID then resource type */
  apiEntities?: Record<string, Record<string, EntityData[]>>;
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
