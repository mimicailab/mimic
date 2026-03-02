import { z } from 'zod';

// ---------------------------------------------------------------------------
// Sub-schemas  (mirror types/blueprint.ts exactly)
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
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    dayOfWeek: z.number().int().min(0).max(6).optional(),
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
  probability: z.number().min(0).max(1),
});

const DataPatternSchema = z.discriminatedUnion('type', [
  z.object({
    targetTable: z.string(),
    type: z.literal('recurring'),
    recurring: RecurringSchema,
    variable: VariableSchema.optional(),
    periodic: PeriodicSchema.optional(),
    event: EventSchema.optional(),
  }),
  z.object({
    targetTable: z.string(),
    type: z.literal('variable'),
    recurring: RecurringSchema.optional(),
    variable: VariableSchema,
    periodic: PeriodicSchema.optional(),
    event: EventSchema.optional(),
  }),
  z.object({
    targetTable: z.string(),
    type: z.literal('periodic'),
    recurring: RecurringSchema.optional(),
    variable: VariableSchema.optional(),
    periodic: PeriodicSchema,
    event: EventSchema.optional(),
  }),
  z.object({
    targetTable: z.string(),
    type: z.literal('event'),
    recurring: RecurringSchema.optional(),
    variable: VariableSchema.optional(),
    periodic: PeriodicSchema.optional(),
    event: EventSchema,
  }),
]);

const PersonaProfileSchema = z.object({
  name: z.string(),
  age: z.number().int().min(1).max(150),
  occupation: z.string(),
  location: z.string(),
  salary: z.number().optional(),
  description: z.string(),
});

const PersonaDataSchema = z.object({
  entities: z.record(z.array(z.record(z.unknown()))),
  patterns: z.array(DataPatternSchema),
  annotations: z.record(z.unknown()),
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
