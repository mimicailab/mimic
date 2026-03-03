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

const PersonaDataSchema = z.object({
  entities: z.record(z.array(z.record(z.unknown()))),
  patterns: z.array(DataPatternSchema),
  annotations: z.record(z.unknown()),
  apiEntities: z
    .record(z.record(z.array(z.record(z.unknown()))))
    .optional()
    .describe('API entity seeds keyed by adapter ID then resource type'),
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

export type BlueprintLLMOutput = z.infer<typeof BlueprintLLMOutputSchema>;
