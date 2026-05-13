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

const ForEachParentSchema = z.object({
  table: z.string().describe('Parent table to iterate over (e.g. "customers")'),
  foreignKey: z.string().optional()
    .describe('FK column in the target table that references the parent. Inferred from schema if omitted.'),
});

/**
 * Data pattern schema — uses a permissive object with all sub-schemas optional.
 * The downstream expander code checks `type` at runtime and uses the relevant
 * sub-object.
 */
const DataPatternSchema = z.object({
  targetTable: z.string(),
  type: z.enum(['recurring', 'variable', 'periodic', 'event']),
  forEachParent: ForEachParentSchema.optional()
    .describe('When set, run the pattern once per entity in the parent table instead of once globally. Use for transactional tables (invoices, payments, events, usage_metrics) that need per-customer/per-account rows.'),
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
  salary: z.number().nullable().describe('Annual salary or null if not applicable'),
  description: z.string(),
});

// ---------------------------------------------------------------------------
// Archetype schemas
// ---------------------------------------------------------------------------

const FieldVariationSchema = z.object({
  type: z.enum([
    'firstName', 'lastName', 'fullName', 'email', 'phone', 'companyName',
    'pick', 'range', 'decimal_range', 'uuid', 'timestamp', 'date', 'derived', 'sequence',
    'anchor_date', 'anchor_field',
  ]),
  values: z.array(z.unknown()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  template: z.string().optional().describe('For derived: template with {{fieldName}} placeholders'),
  prefix: z.string().optional().describe('For sequence: prefix string, e.g. "cus_p1_"'),
  anchor: z.string().optional().describe('For anchor_date/anchor_field: anchor id reference'),
  key: z.string().optional().describe('For anchor_date: which date key on the anchor (default "event"). For anchor_field: which resolved attribute (e.g. "id", "stripe_customer_id")'),
  format: z.enum(['iso', 'epoch_seconds']).optional().describe('For anchor_date: output format (iso default; epoch_seconds for API archetypes)'),
});

const EntityArchetypeSchema = z
  .object({
    label: z.string().describe('Human-readable label, e.g. "starter-plan"'),
    weight: z.number().describe('Fraction 0-1, all weights for a table should sum to ~1.0. Set to 0 ONLY when paired with an explicit `count`, `anchor`, or `apiOnly`.'),
    fields: z.record(z.unknown()).describe('Constant fields shared by all clones of this archetype'),
    vary: z.record(FieldVariationSchema).describe('Fields that get randomized per clone'),
    anchor: z.string().optional().describe('Anchor id this archetype is bound to. Causes the archetype to emit exactly `count` rows tied to the resolved anchor (no weight redistribution).'),
    count: z.number().int().optional().describe('Explicit row count. Required when weight is 0 (or omitted) on a non-anchor, non-apiOnly archetype. For anchor-bound archetypes, defaults to 1 if omitted. For apiOnly archetypes, additive on top of the matched count.'),
    apiOnly: z.boolean().optional().describe('When true, this archetype emits API-only rows with no DB counterpart (e.g. Stripe-only orphans). Pair with explicit `count`.'),
    cites: z.array(z.string()).optional().describe('Claim ids (from data.claims) this archetype is responsible for satisfying. Archetypes that satisfy a persona-narrated number MUST cite the claim id; ambient archetypes (broad distributions filling capacity) can omit cites.'),
  })
  .refine(
    (a) => {
      // An archetype must emit rows. The mechanisms are: weight > 0 (share of
      // the table's count), explicit count > 0 (fixed emission), anchor
      // (anchor-bound emission, count optional, defaults to 1), or apiOnly
      // (additive). weight: 0 alone with none of the above produces zero rows
      // — almost always a mistake.
      const hasWeight = typeof a.weight === 'number' && a.weight > 0;
      const hasCount = typeof a.count === 'number' && a.count > 0;
      const hasAnchor = typeof a.anchor === 'string' && a.anchor.length > 0;
      const isApiOnly = a.apiOnly === true;
      return hasWeight || hasCount || hasAnchor || isApiOnly;
    },
    {
      message:
        'Archetype emits zero rows: it has weight 0 (or undefined) AND no count, no anchor, and no apiOnly. ' +
        'Set one of: weight > 0 (share of table count), count > 0 (exact rows), anchor (cross-table coherence), or apiOnly: true (additive API-only).',
    },
  );

const AnchorSchema = z.object({
  id: z.string().describe('Stable id referenced by archetypes (e.g. "klein_double_charge")'),
  customer: z.object({
    match: z.string().describe('Customer name or company to look up; expander creates one if no row matches'),
  }).optional(),
  dates: z.record(z.string()).describe('Named ISO date or timestamp strings. Use `event` for the canonical date.'),
});

const EntityArchetypeConfigSchema = z.object({
  count: z.number().int().describe('Target number of entities to generate'),
  archetypes: z.array(EntityArchetypeSchema),
});

// ---------------------------------------------------------------------------
// Fact schema (legacy — descriptive only, not validated by the auditor)
// ---------------------------------------------------------------------------

const FactSchema = z.object({
  id: z.string().describe('Unique fact ID, e.g. "fact_001"'),
  type: z.enum(['anomaly', 'overdue', 'pending', 'integrity', 'growth', 'risk', 'dispute', 'churn', 'fraud', 'compliance', 'refund', 'upgrade', 'downgrade', 'payment', 'cancellation'])
    .describe('Category of the fact'),
  platform: z.string().describe('Source platform or "database", e.g. "stripe", "chargebee", "database"'),
  severity: z.enum(['info', 'warn', 'critical'])
    .describe('info = basic recognition, warn = reasoning required, critical = hallucination guard'),
  detail: z.string().describe('Human-readable summary of the fact, e.g. "3 overdue invoices totalling £12,400 — oldest 34 days"'),
  data: z.record(z.unknown()).describe('Structured values for assertion generation — numbers, counts, percentages, dates'),
});

// ---------------------------------------------------------------------------
// Claim schema — checkable predicates extracted from the persona NL.
//
// The LLM extracts these in Phase 1; the auditor evaluates them after
// expansion. Unsatisfied claims trigger the repair loop and ultimately
// fail generation with the persona quote shown back to the user.
//
// Filter operators support equality, membership, comparison, null check,
// and date-age (today − row[field] >= N days). See types/claim.ts.
// ---------------------------------------------------------------------------

const FilterOpSchema = z.union([
  z.object({ eq: z.unknown() }),
  z.object({ neq: z.unknown() }),
  z.object({ in: z.array(z.unknown()) }),
  z.object({ nin: z.array(z.unknown()) }),
  z.object({ gte: z.union([z.number(), z.string()]) }),
  z.object({ lte: z.union([z.number(), z.string()]) }),
  z.object({ gt: z.union([z.number(), z.string()]) }),
  z.object({ lt: z.union([z.number(), z.string()]) }),
  z.object({ is_null: z.boolean() }),
  z.object({ age_days_gte: z.number() }),
  z.object({ age_days_lte: z.number() }),
]);

const FilterSchema = z.record(z.unknown()).describe(
  'Conjunction of per-field predicates. Bare value = equality. ' +
  'Use { op: value } for operators: eq, neq, in, nin, gte/lte/gt/lt, is_null, age_days_gte, age_days_lte. ' +
  'Example: { plan: "pro", status: { in: ["active", "past_due"] }, last_login_at: { age_days_gte: 30 } }',
);

const ResourceTargetSchema = z.object({
  surface: z.enum(['db', 'api']).describe('"db" for DB tables, "api" for API resources'),
  name: z.string().describe('DB table name (e.g. "users") OR "<adapter>.<resource>" (e.g. "stripe.charges")'),
  filter: FilterSchema.optional(),
});

const ClaimBaseSchema = {
  id: z.string().describe('Stable claim id (e.g. "claim_overdue_total"). Archetypes cite this id in their `cites` array.'),
  quote: z.string().describe('Exact persona text this claim was extracted from. Quoted back in audit errors.'),
};

const ClaimSchema = z.union([
  z.object({
    ...ClaimBaseSchema,
    kind: z.literal('row_count'),
    target: ResourceTargetSchema,
    expected: z.number().int(),
    tolerance: z.number().optional(),
  }),
  z.object({
    ...ClaimBaseSchema,
    kind: z.literal('aggregate_sum'),
    target: ResourceTargetSchema,
    field: z.string(),
    expected: z.number(),
    tolerance: z.number().optional(),
  }),
  z.object({
    ...ClaimBaseSchema,
    kind: z.literal('aggregate_avg'),
    target: ResourceTargetSchema,
    field: z.string(),
    expected: z.number(),
    tolerance: z.number().optional(),
  }),
  z.object({
    ...ClaimBaseSchema,
    kind: z.literal('pinned_field'),
    target: ResourceTargetSchema,
    field: z.string(),
    expected: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    perRow: z.boolean().describe('true: every selected row must hold this value. false: at least one row must.'),
  }),
  z.object({
    ...ClaimBaseSchema,
    kind: z.literal('distribution_pct'),
    target: ResourceTargetSchema,
    field: z.string(),
    values: z.record(z.number()),
    tolerance: z.number().optional(),
  }),
  z.object({
    ...ClaimBaseSchema,
    kind: z.literal('date_window'),
    target: ResourceTargetSchema,
    field: z.string(),
    min: z.string().describe('ISO date or ISO timestamp — inclusive lower bound'),
    max: z.string().describe('ISO date or ISO timestamp — inclusive upper bound'),
    expected: z.number().int(),
    tolerance: z.number().optional(),
  }),
  z.object({
    ...ClaimBaseSchema,
    kind: z.literal('orphans_exactly'),
    target: ResourceTargetSchema,
    expected: z.number().int(),
  }),
  z.object({
    ...ClaimBaseSchema,
    kind: z.literal('no_row_with'),
    target: ResourceTargetSchema,
  }),
]);
// Quiet unused-var warning — FilterOpSchema is the documented shape for
// FilterSchema operators but Zod accepts the record at parse time.
void FilterOpSchema;

// ---------------------------------------------------------------------------

const PersonaDataSchema = z.object({
  entities: z.record(z.array(z.record(z.unknown()))),
  patterns: z.array(DataPatternSchema),
  annotations: z.record(z.unknown()).optional().default({}),
  claims: z
    .array(ClaimSchema)
    .optional()
    .describe('Structured persona claims — checkable predicates extracted from the persona NL. Each claim names a `target` (db table or api resource), a `kind` (row_count, aggregate_sum, pinned_field, distribution_pct, date_window, orphans_exactly, no_row_with), and the expected value. Archetypes that satisfy a claim MUST cite it via `cites: [claim_id]`. The auditor evaluates every claim after expansion; unsatisfied claims trigger a 2-attempt repair loop and ultimately fail generation with the persona quote.'),
  facts: z
    .array(FactSchema)
    .optional()
    .describe('Legacy descriptive facts — kept for the post-hoc test-scenario generator. New work should use `claims` instead.'),
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
  anchors: z
    .array(AnchorSchema)
    .optional()
    .describe('Persona-narrated events that imply coherent rows across multiple tables. Each anchor names a customer + date(s); archetypes opt in via `anchor` to share them.'),
});

/** PersonaData variant where apiEntityArchetypes is required (used when APIs are configured) */
const PersonaDataWithApisSchema = z.object({
  entities: z.record(z.array(z.record(z.unknown()))),
  patterns: z.array(DataPatternSchema),
  annotations: z.record(z.unknown()).optional().default({}),
  claims: z
    .array(ClaimSchema)
    .optional()
    .describe('Structured persona claims — checkable predicates extracted from the persona NL. Each claim names a `target` (db table or api resource), a `kind` (row_count, aggregate_sum, pinned_field, distribution_pct, date_window, orphans_exactly, no_row_with), and the expected value. Archetypes that satisfy a claim MUST cite it via `cites: [claim_id]`. The auditor evaluates every claim after expansion; unsatisfied claims trigger a 2-attempt repair loop and ultimately fail generation with the persona quote.'),
  facts: z
    .array(FactSchema)
    .optional()
    .describe('Legacy descriptive facts — kept for the post-hoc test-scenario generator. New work should use `claims` instead.'),
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
  anchors: z
    .array(AnchorSchema)
    .optional()
    .describe('Persona-narrated events that imply coherent rows across multiple tables. Each anchor names a customer + date(s); archetypes opt in via `anchor` to share them.'),
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

// ---------------------------------------------------------------------------
// Schema mapping output schema (DB↔API field correspondence)
// ---------------------------------------------------------------------------

/**
 * Create a schema mapping output schema with `adapterId` constrained to
 * the actual adapter IDs configured in the project.
 *
 * This forces the LLM to emit one mapping entry per adapter rather than
 * using wildcards like "all". Different platforms use different resource
 * names (e.g. Stripe "charges" vs PayPal "payments"), so per-adapter
 * mappings are essential for correct bridge table derivation.
 */
export function createSchemaMappingOutputSchema(adapterIds: [string, ...string[]]) {
  const SchemaMappingEntrySchema = z.object({
    dbTable: z.string().describe('DB table name (e.g. "customers")'),
    dbColumn: z.string().describe('DB column name (e.g. "external_id")'),
    adapterId: z.enum(adapterIds).describe(
      `Exact adapter/platform ID. Must be one of: ${adapterIds.join(', ')}. Do NOT use wildcards like "all".`,
    ),
    apiResource: z.string().describe('API resource type as listed for this specific platform (e.g. "customers", "charges", "payments")'),
    apiField: z.string().describe('API field name (e.g. "id")'),
    isBridgeTable: z.boolean().describe(
      'True if this DB table is a projection of API data (has billing_platform + external_id columns)',
    ),
    direction: z.enum(['mirror', 'drift_capable']).describe(
      'Reconciliation direction for anchor-paired rows. ' +
      '"mirror": DB and API must hold the same value (amounts, currencies, FKs to shared entities, ids, immutable timestamps). ' +
      'Reconciler enforces DB→API equality on anchor-paired rows. ' +
      '"drift_capable": DB and API may intentionally diverge to model real-world inconsistency (row status, ' +
      'cancellation timestamps, period rollovers — any state-at-a-moment field). Reconciler leaves alone. ' +
      'Always "mirror" for id mappings. Default to "mirror" when in doubt — reconciliation expects equality unless told otherwise.',
    ),
  });

  return z.object({
    mappings: z
      .array(SchemaMappingEntrySchema)
      .describe(
        'All field-level mappings between DB columns and API resource fields. ' +
        'Emit one entry PER adapter PER column — never use wildcards. ' +
        'Different platforms may have different resource names for the same concept.',
      ),
    bridgeTables: z
      .array(z.string())
      .describe(
        'DB table names that are projections of API platform data (e.g. tables with billing_platform + external_id)',
      ),
  });
}

export type SchemaMappingOutput = z.infer<ReturnType<typeof createSchemaMappingOutputSchema>>;

// ---------------------------------------------------------------------------
// Distribution output schema (ResourceSpec-based, PR3)
//
// OpenAI structured outputs require all objects to have explicit `properties`
// and `additionalProperties: false`. z.record() is not supported. We use
// arrays of named entries and convert to records after parsing.
// ---------------------------------------------------------------------------

const FieldOverrideEntrySchema = z.object({
  field: z.string().describe('Field name from the ResourceSpec'),
  value: z.string().describe('Override value (numbers/booleans as strings, e.g. "active", "2999", "true")'),
});

const VaryEntrySchema = z.object({
  field: z.string().describe('Field name to vary per clone'),
  type: z.enum([
    'firstName', 'lastName', 'fullName', 'email', 'phone', 'companyName',
    'pick', 'range', 'decimal_range', 'uuid', 'timestamp', 'date', 'derived', 'sequence',
    'anchor_date', 'anchor_field',
  ]).describe('Variation strategy'),
  values: z.array(z.string()).optional().describe('For pick: enum values to choose from'),
  min: z.number().optional().describe('For range/decimal_range: minimum'),
  max: z.number().optional().describe('For range/decimal_range: maximum'),
  template: z.string().optional().describe('For derived: template with {{fieldName}} placeholders'),
  prefix: z.string().optional().describe('For sequence: prefix string'),
  anchor: z.string().optional().describe('For anchor_date/anchor_field: the anchor id to read from'),
  key: z.string().optional().describe('For anchor_date: which date key on the anchor (default "event"). For anchor_field: which resolved attribute (e.g. "id", "stripe_customer_id")'),
  format: z.enum(['iso', 'epoch_seconds']).optional().describe('For anchor_date: output format. Use "epoch_seconds" for APIs that store created times as Unix integers (Stripe, etc.)'),
});

const ArchetypeDistributionSchema = z.object({
  label: z.string().describe('Human-readable archetype label, e.g. "starter-plan"'),
  weight: z.number().describe('Fraction 0-1. Matched-archetype weights should sum to ~1.0; apiOnly and anchor-bound archetypes are additive and do not count toward that sum. Set to 0 ONLY when paired with explicit count, anchor, or apiOnly.'),
  fieldOverrides: z
    .array(FieldOverrideEntrySchema)
    .optional()
    .describe('Constant field values that define this archetype. Use dotted paths for nested-object fields: {field:"unit_price.amount", value:"2900"} sets unit_price.amount=2900 in the nested object.'),
  vary: z
    .array(VaryEntrySchema)
    .optional()
    .describe('Fields that should vary per clone with a specific strategy the LLM chooses (e.g. amount ranges, name types). Omit fields the assembler can derive from the spec.'),
  apiOnly: z
    .boolean()
    .optional()
    .describe('Set true when entities of this archetype have NO database counterpart (e.g. "Stripe-only orphans from a botched import", "abandoned Plaid items"). The system will emit them into API responses but skip DB row creation, producing deliberate cross-platform asymmetry. Use ONLY when the persona explicitly declares such asymmetry; never as a generic flag.'),
  count: z
    .number()
    .int()
    .optional()
    .describe('Explicit row count for this archetype. Required when weight is 0 (or omitted) and the archetype is not anchor-bound. For apiOnly archetypes, additive on top of the matched count. For anchor-bound archetypes, defaults to 1 if omitted.'),
  anchor: z
    .string()
    .optional()
    .describe('Anchor id this archetype is bound to. Causes the archetype to emit exactly `count` rows tied to the resolved anchor (no weight redistribution). Use for persona events declared in `data.anchors`.'),
  cites: z
    .array(z.string())
    .optional()
    .describe('Claim ids (from data.claims, set in Phase 1) this archetype is responsible for satisfying. Persona-pinned archetypes MUST cite the claim(s) they satisfy; ambient archetypes can omit cites.'),
});

const DistributionFactSchema = z.object({
  id: z.string().describe('Unique fact ID, e.g. "fact_001"'),
  type: z.enum(['anomaly', 'overdue', 'pending', 'integrity', 'growth', 'risk', 'dispute', 'churn', 'fraud', 'compliance', 'refund', 'upgrade', 'downgrade', 'payment', 'cancellation'])
    .describe('Category of the fact'),
  platform: z.string().describe('Source platform or "database"'),
  severity: z.enum(['info', 'warn', 'critical'])
    .describe('info = basic recognition, warn = reasoning required, critical = hallucination guard'),
  detail: z.string().describe('Human-readable summary, e.g. "3 overdue invoices totalling £12,400"'),
});

const ResourceDistributionSchema = z.object({
  count: z.number().int().describe('Target number of entities to generate'),
  archetypes: z
    .array(ArchetypeDistributionSchema)
    .describe('2-8 representative sub-groups with labels and weights'),
});

const ResourceDistributionEntrySchema = z.object({
  resource: z.string().describe('Resource type key (e.g. "customers", "subscriptions")'),
  distribution: ResourceDistributionSchema,
});

/**
 * Zod schema for distribution-only LLM output (OpenAI-compatible).
 *
 * Uses arrays instead of records because OpenAI structured outputs
 * reject z.record(). Converted to DistributionOutput records via
 * toDistributionOutput() after parsing.
 */
export const DistributionOutputSchema = z.object({
  resources: z
    .array(ResourceDistributionEntrySchema)
    .describe('Distribution plan for each resource type'),
  facts: z
    .array(DistributionFactSchema)
    .optional()
    .describe('Testable facts about distribution choices — anomalies, overdue items, risk signals, growth trends. Used for auto-scenario generation.'),
}).describe(
  'Distribution plan: counts, archetypes with weights, field overrides, vary specs, and testable facts.',
);

export type DistributionOutputRaw = z.infer<typeof DistributionOutputSchema>;

export interface DistributionOutputConverted {
  distributions: DistributionOutput;
  facts: DistributionFact[];
}

/**
 * Convert the OpenAI-compatible array-based output to the record-based
 * DistributionOutput that the resource assembler expects, plus extracted facts.
 */
export function toDistributionOutput(raw: DistributionOutputRaw): DistributionOutputConverted {
  const distributions: DistributionOutput = {};
  for (const entry of raw.resources) {
    distributions[entry.resource] = {
      count: entry.distribution.count,
      archetypes: entry.distribution.archetypes.map(a => ({
        label: a.label,
        weight: a.weight,
        fieldOverrides: a.fieldOverrides
          ? Object.fromEntries(a.fieldOverrides.map(o => [o.field, coerceValue(o.value)]))
          : undefined,
        vary: a.vary
          ? Object.fromEntries(a.vary.map(v => {
              const spec: Record<string, unknown> = { type: v.type };
              if (v.values) spec.values = v.values;
              if (v.min !== undefined) spec.min = v.min;
              if (v.max !== undefined) spec.max = v.max;
              if (v.template) spec.template = v.template;
              if (v.prefix) spec.prefix = v.prefix;
              if (v.anchor) spec.anchor = v.anchor;
              if (v.key) spec.key = v.key;
              if (v.format) spec.format = v.format;
              return [v.field, spec];
            }))
          : undefined,
        apiOnly: a.apiOnly,
        count: a.count,
        anchor: a.anchor,
        cites: a.cites,
      })),
    };
  }

  const facts: DistributionFact[] = (raw.facts ?? []).map(f => ({
    id: f.id,
    type: f.type as FactType,
    platform: f.platform,
    severity: f.severity as FactSeverity,
    detail: f.detail,
    data: {},
  }));

  return { distributions, facts };
}

function coerceValue(v: string): unknown {
  if (v === 'true') return true;
  if (v === 'false') return false;
  const n = Number(v);
  if (!Number.isNaN(n) && v.trim() !== '') return n;
  return v;
}

import type { Fact, FactType, FactSeverity } from '../types/fact-manifest.js';

export type DistributionFact = Fact;

/** Re-export-compatible shape — matches resource-assembler's DistributionOutput */
export type DistributionOutput = Record<string, {
  count: number;
  archetypes: {
    label: string;
    weight: number;
    fieldOverrides?: Record<string, unknown>;
    vary?: Record<string, Record<string, unknown>>;
    apiOnly?: boolean;
    count?: number;
    anchor?: string;
    cites?: string[];
  }[];
}>;

// ---------------------------------------------------------------------------
// BlueprintPatch schema — repair LLM output
//
// The repair LLM emits structured ops against the existing blueprint. The
// applier walks the ops list and mutates the blueprint in place; the result
// is then re-expanded and re-audited.
// ---------------------------------------------------------------------------

const PatchSetFieldSchema = z.object({
  op: z.literal('set_field'),
  path: z.string().describe('Dotted path to the field, e.g. "data.apiEntityArchetypes.stripe.price[starter-monthly].fields.unit_amount"'),
  value: z.unknown().describe('New value. Number/string/boolean/object/null — whatever the field type expects.'),
});

const PatchSetVarySchema = z.object({
  op: z.literal('set_vary'),
  path: z.string().describe('Dotted path to the vary entry, e.g. "data.entityArchetypes.users.archetypes[pro-churn-risk].vary.last_login_at"'),
  variation: FieldVariationSchema,
});

const PatchSetCountSchema = z.object({
  op: z.literal('set_count'),
  path: z.string().describe('Dotted path to an archetype, e.g. "data.entityArchetypes.users.archetypes[pro-churn-risk]". `count` field is updated on that archetype.'),
  count: z.number().int(),
});

const PatchAddArchetypeSchema = z.object({
  op: z.literal('add_archetype'),
  target: z.string().describe('DB table name OR "<adapter>.<resource>" — where to insert the archetype'),
  surface: z.enum(['db', 'api']),
  archetype: EntityArchetypeSchema,
});

const PatchRemoveArchetypeSchema = z.object({
  op: z.literal('remove_archetype'),
  target: z.string().describe('DB table name OR "<adapter>.<resource>"'),
  surface: z.enum(['db', 'api']),
  label: z.string().describe('Label of the archetype to remove'),
});

const PatchOpSchema = z.union([
  PatchSetFieldSchema,
  PatchSetVarySchema,
  PatchSetCountSchema,
  PatchAddArchetypeSchema,
  PatchRemoveArchetypeSchema,
]);

export const BlueprintPatchSchema = z.object({
  ops: z.array(PatchOpSchema).describe('Ordered list of patch operations. Applied in order, deterministically.'),
  rationale: z.string().describe('1-2 sentence explanation of the fix strategy. Goes to telemetry; not data.'),
});

export type BlueprintPatchOutput = z.infer<typeof BlueprintPatchSchema>;

// =============================================================================
// V2 — narrow, layered schemas
//
// V2 splits the monolithic Phase 1 LLM call into three focused calls:
//   1. Claim extraction  — persona NL → claims + anchors + persona profile
//   2. Per-slot content  — slot spec → archetypes (no count/weight; solver
//                           assigns counts via the cites graph downstream)
//
// Bridge rewrite, topology slot derivation, and count solving are
// deterministic (no LLM) and run between/after these calls. The legacy
// schemas above are retained for backwards compatibility with cached
// blueprints; they will be removed once V2 is the default in all entry
// points.
// =============================================================================

// ---------------------------------------------------------------------------
// V2: Claim Extraction output schema
// ---------------------------------------------------------------------------

/**
 * Output of the narrow claim-extraction LLM call. Contains only the
 * structured persona contract — no archetypes, no counts, no weights.
 *
 * Downstream layers (bridge rewriter, topology, content generator, count
 * solver) consume this output deterministically or by routing each claim
 * to its target slot.
 */
export const ClaimExtractionOutputSchema = z.object({
  personaId: z
    .string()
    .describe('A kebab-case unique identifier for this persona, e.g. "sarah-chen"'),
  domain: z
    .string()
    .describe('The domain this data belongs to, e.g. "personal-finance" or "billing-ops"'),
  persona: PersonaProfileSchema.describe(
    'A coherent persona profile — name, age, occupation, location, salary (or null), description',
  ),
  claims: z
    .array(ClaimSchema)
    .describe(
      'Every checkable predicate extracted from the persona NL. Each entry names a target ' +
        '(db table or api adapter.resource), a kind, and the expected value. Include ALL ' +
        'numeric claims, pinned fields, and distribution statements the persona makes.',
    ),
  anchors: z
    .array(AnchorSchema)
    .optional()
    .describe(
      'Persona-narrated events that imply coherent rows across multiple tables/surfaces ' +
        '("Klein\'s double-charge on Apr 29"). Use one anchor per concrete event — not ' +
        'per ambient distribution. Each anchor names a customer + named dates.',
    ),
});

export type ClaimExtractionOutput = z.infer<typeof ClaimExtractionOutputSchema>;

// ---------------------------------------------------------------------------
// V2: Per-slot Content schema
//
// Content archetypes drop `count` and `weight` from the LLM-facing surface —
// the count solver assigns counts deterministically from the cites graph
// downstream, and weight defaults to a uniform 1/N at orchestrator-assembly
// time. The LLM's job is reduced to: label, fields, vary, citations,
// optional anchor binding, optional apiOnly flag.
//
// Two flavors:
//   - DbContentArchetypeSchema   — used for DB slots; emitted as-is into
//                                   blueprint.data.entityArchetypes
//   - ApiContentArchetypeSchema  — used for API slots; transformed through
//                                   the existing resource-assembler so spec-
//                                   derived auto-vary stays a single concern
// ---------------------------------------------------------------------------

const DbContentArchetypeSchema = z.object({
  label: z.string().describe('Human-readable label, e.g. "free-tier", "pro-churn-risk".'),
  fields: z
    .record(z.unknown())
    .describe('Constant fields shared by every row of this archetype.'),
  vary: z
    .record(FieldVariationSchema)
    .optional()
    .describe('Fields that get randomized per cloned row (names, emails, ids, dates, ranges).'),
  cites: z
    .array(z.string())
    .optional()
    .describe(
      'Claim ids this archetype is responsible for satisfying. The solver uses cites to ' +
        'assign exact row counts; ambient archetypes filling capacity can omit cites.',
    ),
  anchor: z
    .string()
    .optional()
    .describe(
      'Anchor id this archetype is bound to. When set, the expander emits rows tied to ' +
        'the resolved anchor (no weight redistribution). Use for persona events declared ' +
        'in the anchors list.',
    ),
});

const ApiContentArchetypeSchema = z.object({
  label: z.string().describe('Human-readable label, e.g. "starter-monthly", "overdue-oldest".'),
  fieldOverrides: z
    .array(FieldOverrideEntrySchema)
    .optional()
    .describe(
      'Constant field values that define this archetype. Use dotted paths for nested ' +
        'object fields ({field:"unit_price.amount", value:"2900"}). Values are strings ' +
        '— the assembler coerces numerics.',
    ),
  vary: z
    .array(VaryEntrySchema)
    .optional()
    .describe(
      'Per-archetype variation overrides — emit only when the spec\'s auto-derivation is ' +
        'wrong for this archetype (e.g. amount must range 500-2000 instead of the spec default).',
    ),
  cites: z
    .array(z.string())
    .optional()
    .describe(
      'Claim ids this archetype is responsible for satisfying.',
    ),
  anchor: z
    .string()
    .optional()
    .describe(
      'Anchor id this archetype is bound to. For MIRROR events, bind on the API side only; ' +
        'the mirror flow propagates the resulting row to DB.',
    ),
  apiOnly: z
    .boolean()
    .optional()
    .describe(
      'Set true when entities of this archetype have NO database counterpart (e.g. ' +
        '"3 deliberate Stripe-only orphans from a botched import"). Use ONLY for ' +
        'persona-declared cross-platform asymmetry.',
    ),
});

/**
 * LLM output schema for a DB slot's content. Returns archetypes only —
 * count/weight are assigned by the solver and orchestrator downstream.
 */
export const DbSlotContentOutputSchema = z.object({
  archetypes: z
    .array(DbContentArchetypeSchema)
    .describe(
      'Two to ten representative archetypes for this table. Each archetype is a coherent ' +
        'sub-group with its own field values; the expander clones each into many rows.',
    ),
});

/**
 * LLM output schema for an API slot's content.
 */
export const ApiSlotContentOutputSchema = z.object({
  archetypes: z
    .array(ApiContentArchetypeSchema)
    .describe(
      'Two to ten representative archetypes for this resource. Constant values go in ' +
        'fieldOverrides; let the assembler auto-derive ids, timestamps, and emails ' +
        'unless you have a specific opinion.',
    ),
});

export type DbSlotContentOutput = z.infer<typeof DbSlotContentOutputSchema>;
export type ApiSlotContentOutput = z.infer<typeof ApiSlotContentOutputSchema>;
