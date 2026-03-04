import { z } from 'zod';

// ---------------------------------------------------------------------------
// Sub-schemas  (mirror types/blueprint.ts exactly)
//
// NOTE: Using Anthropic's jsonTool structured output mode which supports
// z.record() and z.unknown() but NOT min/max on integers.
// ---------------------------------------------------------------------------

const RandomSpecSchema = z.object({
  type: z.enum(['pick', 'range', 'decimal_range', 'date_in_period']),
  values: z.array(z.unknown()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

const FrequencySpecSchema = z.object({
  min: z.number(),
  max: z.number(),
  period: z.enum(['day', 'week', 'month']),
});

const RecurringSchema = z.object({
  fields: z.record(z.unknown()),
  schedule: z.object({
    frequency: z.enum([
      'daily',
      'weekly',
      'biweekly',
      'monthly',
      'quarterly',
      'yearly',
    ]),
    dayOfMonth: z.number().int().optional().describe('Day of month (1-31)'),
    dayOfWeek: z.number().int().optional().describe('Day of week (0=Sun, 6=Sat)'),
  }),
});

const VariableSchema = z.object({
  fields: z.record(z.unknown()),
  randomFields: z.record(RandomSpecSchema),
  frequency: FrequencySpecSchema,
  timeBias: z.string().optional(),
});

const PeriodicSchema = z.object({
  fields: z.record(z.unknown()),
  frequency: z.enum(['weekly', 'biweekly', 'monthly']),
});

const EventSchema = z.object({
  fields: z.record(z.unknown()),
  probability: z.number().describe('Probability between 0 and 1'),
});

/**
 * Data pattern schema — uses a permissive object with all sub-schemas optional.
 * The downstream expander code checks `type` at runtime and uses the relevant
 * sub-object.
 */
const DataPatternSchema = z.object({
  targetTable: z.string(),
  type: z.enum(['recurring', 'variable', 'periodic', 'event']),
  recurring: RecurringSchema.optional(),
  variable: VariableSchema.optional(),
  periodic: PeriodicSchema.optional(),
  event: EventSchema.optional(),
});

const PersonaProfileSchema = z.object({
  name: z.string(),
  age: z.number().int().describe('Age in years'),
  occupation: z.string(),
  location: z.string(),
  salary: z.number().optional(),
  description: z.string(),
});

// ---------------------------------------------------------------------------
// Archetype schemas
// ---------------------------------------------------------------------------

const FieldVariationSchema = z.object({
  type: z.enum([
    'firstName', 'lastName', 'fullName', 'email', 'phone', 'companyName',
    'pick', 'range', 'decimal_range', 'uuid', 'derived', 'sequence',
  ]),
  values: z.array(z.unknown()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  template: z.string().optional().describe('For derived: template with {{fieldName}} placeholders'),
  prefix: z.string().optional().describe('For sequence: prefix string, e.g. "cus_p1_"'),
});

const EntityArchetypeSchema = z.object({
  label: z.string().describe('Human-readable label, e.g. "starter-plan"'),
  weight: z.number().describe('Fraction 0-1, all weights for a table should sum to ~1.0'),
  fields: z.record(z.unknown()).describe('Constant fields shared by all clones of this archetype'),
  vary: z.record(FieldVariationSchema).describe('Fields that get randomized per clone'),
});

const EntityArchetypeConfigSchema = z.object({
  count: z.number().int().describe('Target number of entities to generate'),
  archetypes: z.array(EntityArchetypeSchema),
});

// ---------------------------------------------------------------------------

const PersonaDataSchema = z.object({
  entities: z.record(z.array(z.record(z.unknown()))),
  patterns: z.array(DataPatternSchema),
  annotations: z.record(z.unknown()),
  apiEntities: z
    .record(z.record(z.array(z.record(z.unknown()))))
    .optional()
    .describe('API entity seeds keyed by adapter ID then resource type'),
  entityArchetypes: z
    .record(EntityArchetypeConfigSchema)
    .optional()
    .describe('Archetype definitions for scalable entity generation, keyed by table name'),
  apiEntityArchetypes: z
    .record(z.record(EntityArchetypeConfigSchema))
    .optional()
    .describe('API entity archetypes keyed by adapter ID then resource type'),
});

/** PersonaData variant where apiEntityArchetypes is required (used when APIs are configured) */
const PersonaDataWithApisSchema = z.object({
  entities: z.record(z.array(z.record(z.unknown()))),
  patterns: z.array(DataPatternSchema),
  annotations: z.record(z.unknown()),
  apiEntities: z
    .record(z.record(z.array(z.record(z.unknown()))))
    .optional()
    .describe('API entity seeds keyed by adapter ID then resource type — use for small reference data like products, prices (<10 items)'),
  entityArchetypes: z
    .record(EntityArchetypeConfigSchema)
    .optional()
    .describe('Archetype definitions for scalable entity generation, keyed by table name'),
  apiEntityArchetypes: z
    .record(z.record(EntityArchetypeConfigSchema))
    .describe('REQUIRED: API entity archetypes keyed by adapter ID then resource type. Use for resource types with 10+ entities (customers, subscriptions, invoices, etc.)'),
});

// ---------------------------------------------------------------------------
// Top-level Blueprint schema
// ---------------------------------------------------------------------------

export const BlueprintSchema = z.object({
  version: z.literal('1.0'),
  personaId: z.string(),
  domain: z.string(),
  generatedAt: z.string(),
  generatedBy: z.string(),
  checksum: z.string(),

  persona: PersonaProfileSchema,
  data: PersonaDataSchema,
});

/**
 * The Zod schema for the LLM-generated portion of a Blueprint.
 *
 * This omits metadata fields (`version`, `generatedAt`, `generatedBy`,
 * `checksum`) that are filled in by the engine after generation, leaving only
 * the fields the LLM is responsible for producing.
 */
export const BlueprintLLMOutputSchema = z.object({
  personaId: z.string().describe('A kebab-case unique identifier for this persona, e.g. "sarah-chen"'),
  domain: z.string().describe('The domain this data belongs to, e.g. "personal-finance"'),

  persona: PersonaProfileSchema.describe('Detailed persona profile'),
  data: PersonaDataSchema.describe('Domain-specific entities and data patterns'),
});

/**
 * Variant of BlueprintLLMOutputSchema where apiEntityArchetypes is REQUIRED.
 * Used when APIs are configured — forces the LLM to generate API entity data
 * in structured output (jsonTool) mode where optional fields are easily skipped.
 */
export const BlueprintLLMOutputWithApisSchema = z.object({
  personaId: z.string().describe('A kebab-case unique identifier for this persona, e.g. "sarah-chen"'),
  domain: z.string().describe('The domain this data belongs to, e.g. "personal-finance"'),

  persona: PersonaProfileSchema.describe('Detailed persona profile'),
  data: PersonaDataWithApisSchema.describe('Domain-specific entities, data patterns, and API entity archetypes'),
});

export type BlueprintLLMOutput = z.infer<typeof BlueprintLLMOutputSchema>;
