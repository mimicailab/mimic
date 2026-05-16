/**
 * V4.5 — Zod schema for the contract compiler LLM call.
 *
 * The compiler emits a structured `PersonaContract` from persona text. The
 * shape here is intentionally narrower than the legacy claim-extraction
 * envelope: it forces the LLM to (1) carry the source quote on every clause,
 * (2) declare a clause family and a hard/soft strength, and (3) keep
 * style-only material in its own narrative bucket where it can't accidentally
 * lower into the generator.
 */

import { z } from 'zod';

const PersonaProfileSchema = z.object({
  name: z.string(),
  age: z.number().int().describe('Age in years'),
  occupation: z.string(),
  location: z.string(),
  salary: z.number().nullable().describe('Annual salary or null if not applicable'),
  description: z.string(),
});

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
void FilterOpSchema;

const FilterSchema = z.record(z.unknown());

const ResourceTargetSchema = z.object({
  surface: z.enum(['db', 'api']),
  name: z
    .string()
    .describe(
      'When surface="db": bare table name, e.g. "users", "invoices". ' +
        'When surface="api": "<adapter>.<resource>" with NO leading "api." prefix. ' +
        'CORRECT: "stripe.subscription", "chargebee.invoice". ' +
        'WRONG: "api.stripe.subscription", "api/stripe/subscription". ' +
        'The "api" surface is already conveyed by surface="api"; do not repeat it in name.',
    ),
  filter: FilterSchema.optional(),
});

const BillingCustomerSemanticTargetSchema = z.object({
  kind: z.literal('billing_customer_cohort'),
  adapter: z.string().describe('Adapter that owns billing truth, e.g. "stripe"'),
  facets: z
    .object({
      tier: z.string().optional().describe('Canonical business tier, e.g. starter | pro | enterprise'),
      billingState: z.enum(['paying', 'free']).optional(),
    })
    .optional(),
});

const ProductUserSemanticTargetSchema = z.object({
  kind: z.literal('product_user_cohort'),
  table: z.string().describe('Product-side database table, e.g. "users"'),
  facets: z
    .object({
      tier: z.string().optional().describe('Canonical business tier, e.g. starter | pro | enterprise'),
      billingState: z.enum(['paying', 'free']).optional(),
      linkage: z.enum(['linked', 'unlinked']).optional(),
    })
    .optional(),
});

const SemanticTargetSchema = z.discriminatedUnion('kind', [
  BillingCustomerSemanticTargetSchema,
  ProductUserSemanticTargetSchema,
]);

const CanonicalWindowSchema = z.object({
  start: z.string(),
  end: z.string(),
  granularity: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
});

const CanonicalTargetSchema = z.object({
  populationId: z.string().describe(
    'Stable canonical entity population id. Reuse the same populationId when clauses talk about the same real-world entities across surfaces.',
  ),
  cohortRule: FilterSchema.optional().describe(
    'Canonical cohort restriction over that population, e.g. { billing_platform: "stripe", plan: "starter" }.',
  ),
  metricId: z.string().optional().describe(
    'Stable canonical metric id, e.g. count | mrr | arr | revenue | mrr_change | gap_days | event.',
  ),
  window: CanonicalWindowSchema.optional(),
});

const ClauseBaseSchema = {
  id: z.string().describe('Stable kebab-case clause id'),
  quote: z.string().describe('Exact persona text this clause was extracted from'),
  strength: z.enum(['hard', 'soft']).describe(
    'hard: must be satisfied (blocks the run if unsupported). ' +
    'soft: nice-to-have (never blocks).',
  ),
  canonicalTarget: CanonicalTargetSchema.optional().describe(
    'Optional compiler-authored canonical interpretation. Use when you can confidently map the clause onto a shared canonical population. Leave absent if unsure; the deterministic canonicaliser will fill it.',
  ),
};

const CountClauseSchema = z.object({
  ...ClauseBaseSchema,
  family: z.literal('count'),
  target: ResourceTargetSchema.optional(),
  semanticTarget: SemanticTargetSchema.optional(),
  expected: z.number(),
  tolerance: z.number().optional(),
}).refine((value) => value.target != null || value.semanticTarget != null, {
  message: 'count clauses require either target or semanticTarget',
});

const AggregateClauseSchema = z.object({
  ...ClauseBaseSchema,
  family: z.literal('aggregate'),
  op: z.enum(['sum', 'avg']),
  target: ResourceTargetSchema.optional(),
  semanticTarget: SemanticTargetSchema.optional(),
  field: z.string(),
  expected: z.number(),
  tolerance: z.number().optional(),
}).refine((value) => value.target != null || value.semanticTarget != null, {
  message: 'aggregate clauses require either target or semanticTarget',
});

const DistributionClauseSchema = z.object({
  ...ClauseBaseSchema,
  family: z.literal('distribution'),
  target: ResourceTargetSchema.optional(),
  semanticTarget: SemanticTargetSchema.optional(),
  semanticField: z.enum(['tier']).optional(),
  field: z.string(),
  values: z.record(z.number()),
  tolerance: z.number().optional(),
}).refine((value) => value.target != null || value.semanticTarget != null, {
  message: 'distribution clauses require either target or semanticTarget',
});

const TemporalWindowClauseSchema = z.object({
  ...ClauseBaseSchema,
  family: z.literal('temporal'),
  kind: z.literal('window'),
  target: ResourceTargetSchema.optional(),
  semanticTarget: SemanticTargetSchema.optional(),
  field: z.string(),
  min: z.string(),
  max: z.string(),
  expected: z.number(),
  tolerance: z.number().optional(),
}).refine((value) => value.target != null || value.semanticTarget != null, {
  message: 'temporal window clauses require either target or semanticTarget',
});

const TemporalGapClauseSchema = z.object({
  ...ClauseBaseSchema,
  family: z.literal('temporal'),
  kind: z.literal('relative_gap'),
  anchorA: z.string(),
  anchorB: z.string(),
  days: z.number(),
  tolerance: z.number().optional(),
});

const AnchorClauseSchema = z.object({
  ...ClauseBaseSchema,
  family: z.literal('anchor'),
  anchorId: z.string(),
  customer: z.string().optional(),
  dates: z.record(z.string()),
});

const CrossSurfaceClauseSchema = z.object({
  ...ClauseBaseSchema,
  family: z.literal('cross_surface'),
  entity: z.string(),
  surfaceA: ResourceTargetSchema,
  surfaceB: ResourceTargetSchema,
  field: z.string(),
  valueA: z.union([z.string(), z.number(), z.boolean()]),
  valueB: z.union([z.string(), z.number(), z.boolean()]),
  driftDays: z.number().optional(),
  driftTolerance: z.number().optional(),
});

const ReconciliationBucketSchema = z.object({
  name: z.string(),
  value: z.number(),
  target: ResourceTargetSchema,
  field: z.string(),
  op: z.enum(['sum', 'count']),
  filter: FilterSchema.optional(),
});

const ReconciliationClauseSchema = z.object({
  ...ClauseBaseSchema,
  family: z.literal('reconciliation'),
  metric: z.string(),
  headline: z.number(),
  tolerance: z.number().optional(),
  buckets: z.array(ReconciliationBucketSchema),
});

const NarrativeClauseSchema = z.object({
  ...ClauseBaseSchema,
  family: z.literal('narrative'),
  note: z.string(),
});

export const ClauseSchema = z.union([
  CountClauseSchema,
  AggregateClauseSchema,
  DistributionClauseSchema,
  TemporalWindowClauseSchema,
  TemporalGapClauseSchema,
  AnchorClauseSchema,
  CrossSurfaceClauseSchema,
  ReconciliationClauseSchema,
  NarrativeClauseSchema,
]);

const AnchorSchema = z.object({
  id: z.string(),
  customer: z.object({ match: z.string() }).optional(),
  dates: z.record(z.string()),
});

export const ContractCompilerOutputSchema = z.object({
  personaId: z.string().describe('Stable kebab-case persona id'),
  domain: z.string(),
  persona: PersonaProfileSchema,
  clauses: z
    .array(ClauseSchema)
    .describe(
      'Every requirement the persona expresses, broken into clauses. Each clause carries the ' +
        'source quote, a family discriminator, and a hard/soft strength. Hard clauses block the ' +
        'run if no rule covers them; soft clauses never block. Use the "narrative" family for ' +
        'tone/style-only material that should not be lowered into the generator.',
    ),
  anchors: z
    .array(AnchorSchema)
    .optional()
    .describe(
      'Persona-narrated events that imply coherent rows across multiple tables/surfaces. The ' +
        'compiler may also derive these from anchor-family clauses — supply them here only if ' +
        'they have customer+date binding the clauses lack.',
    ),
});

export type ContractCompilerOutput = z.infer<typeof ContractCompilerOutputSchema>;
