/**
 * Persona constraint extraction.
 *
 * Reads the persona description and produces a list of imperative,
 * platform-scoped pinning instructions for the distribution LLM. The goal
 * is to make persona-pinned values impossible for the distribution call
 * to miss — instead of asking the model to find £4,800 buried in the
 * persona prose, we extract it once up front and surface it as a
 * "MUST APPEAR EXACTLY" block on the resource that owns it.
 *
 * Constraints are produced once per persona (single LLM call) and then
 * scoped at injection time into each per-resource distribution call.
 *
 * Constraint shape is deliberately prescriptive (human-readable
 * instruction) rather than structured (typed predicate). The distribution
 * LLM is the consumer, and it's better at following imperative prose than
 * synthesising values from a typed predicate graph.
 */
import { z } from 'zod';
import type { ILLMClient } from '../llm/client.js';
import { logger, debugFile } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const ScopeSchema = z.object({
  /** Adapter id this constraint applies to. Omit for a constraint that spans
   * platforms (rare — usually a constraint targets one platform's resource). */
  adapter: z.string().optional(),
  /** API resource name this constraint applies to. Omit for table-only
   * constraints. */
  resource: z.string().optional(),
  /** DB table this constraint applies to. Omit for API-only constraints. */
  table: z.string().optional(),
});

const PersonaConstraintSchema = z.object({
  id: z
    .string()
    .describe('Stable kebab-case slug ("chargebee-3-overdue-totals").'),
  scope: ScopeSchema,
  description: z
    .string()
    .describe('One short sentence paraphrasing the persona claim.'),
  instruction: z
    .string()
    .describe(
      'IMPERATIVE prose for the distribution LLM. Tell it EXACTLY which ' +
        "archetypes and field literals to emit. Include counts, field names, " +
        'literal values in minor units (pence/cents), and dates in ISO form. ' +
        'Use bullet points if there are multiple sub-requirements. ' +
        'Example: "Emit 3 archetypes each with count=1 and status=payment_due. ' +
        'Their `total` fields must be exactly 480000, 420000, 340000 pence in ' +
        'fieldOverrides (NOT vary.range). The oldest must have date=\\"2026-04-11T00:00:00Z\\"."',
    ),
});

export type PersonaConstraint = z.infer<typeof PersonaConstraintSchema>;

const PersonaConstraintListSchema = z.object({
  constraints: z
    .array(PersonaConstraintSchema)
    .describe(
      'All testable pinning claims extracted from the persona. Skip vague ' +
        'statements like "growth-stage" or "8.2% growth" if they cannot be ' +
        'expressed as exact archetype field values.',
    ),
});

// ---------------------------------------------------------------------------
// Extraction prompt
// ---------------------------------------------------------------------------

const EXTRACTION_SYSTEM = `You are a persona-fact extractor for a synthetic data pipeline. You read a persona description and produce JSON \`constraints\` — imperative instructions the downstream distribution LLM will follow when designing archetypes.

Your output is consumed VERBATIM. Each constraint's \`instruction\` field is injected into the distribution prompt for the platform/resource it scopes to.

## What counts as a constraint

Extract one constraint per concrete, testable persona claim:

- EXACT counts:           "Exactly 71 customers" → count target
- EXACT amounts:          "MRR is exactly £77,200" → sum target + per-row literal in pence
- EXACT value sets:       "overdue totals are £4,800, £4,200, £3,400" → 3 dedicated archetypes
- PINNED DATES:           "oldest dated 2026-04-11" → date literal on a specific archetype
- GLOBAL INVARIANTS:      "currency is GBP only" → field literal on every archetype
- BATCH EVENTS:           "71 payments in the 2026-05-11 batch with charge_date 2026-05-13" → cluster as one archetype
- ENUM ALLOWLISTS:        "every row has status=active" → field literal on every archetype

Skip vague/qualitative claims ("growth-stage", "%-of-revenue narrative") — only extract what can be expressed as an exact archetype field value or count.

## How to scope

For each constraint, set \`scope\`:
- \`{ adapter: "<platform>", resource: "<resource>" }\` for API-side claims (most claims).
- \`{ table: "<table>" }\` for DB-table claims ("every users row has status=active").
- A constraint may have BOTH adapter and resource set, but it should always be as narrow as possible.

The distribution LLM is called once per (adapter, resource); your constraint will only be injected into matching calls. Scope precisely.

## How to write the instruction

The \`instruction\` field is imperative prose for the distribution LLM. Be EXPLICIT about:

1. **Which archetype(s).** "Emit one archetype with count=N". Don't ask for weights when exact counts are needed.
2. **Which fields go in \`fieldOverrides\` (pinned literals) vs \`vary\` (ranges).** When a persona names an exact value, the literal goes in fieldOverrides, NEVER vary. Say so explicitly.
3. **Pence/cents conversion.** Always convert £/$ to integer minor units in your instruction. "£4,800" becomes "480000 pence" in the instruction.
4. **Date format.** Use ISO 8601 ("2026-04-11T00:00:00Z"). The distribution LLM may convert to unix seconds; that's fine.

## CRITICAL — Substates are NOT additive

When a persona says "Exactly N customers" AND "Of those, M are in <state>", the M is a SUBSTATE of the N. It is NOT additive. Total count remains N; M of them have the substate.

Example persona text: "RevenueCat: Exactly 618 active subscribers. Exactly 22 subscribers are in in_billing_retry state."

The 22 in_billing_retry are PART of the 618 total. NOT 618 + 22 = 640. Make this explicit in the constraint's instruction so the distribution LLM doesn't emit additive counts.

GOOD instruction: "RevenueCat must have EXACTLY 618 subscriber records total. Of those 618, emit 22 with count-based archetype where status=\\"in_billing_retry\\". The remaining 596 are split across active/expired archetypes by weight. The 22 in retry are a SUBSET of the 618, not on top of them."

BAD instruction: "Emit 618 customers AND 22 in_billing_retry subscribers." (This wording invites additive interpretation.)

Always write substate counts as a subset clause: "Of those N, M have <substate>". Never juxtapose two raw counts that share a parent population without saying which is the parent.

### Example output

For persona text: "Chargebee has 3 overdue invoices with status='payment_due'. The totals are exactly £4,800, £4,200, and £3,400. The oldest invoice has date=2026-04-11."

\`\`\`jsonc
{
  "constraints": [
    {
      "id": "chargebee-3-overdue-totals",
      "scope": { "adapter": "chargebee", "resource": "invoice" },
      "description": "3 overdue Chargebee invoices with pinned totals and an explicit oldest date.",
      "instruction": "Emit 3 dedicated archetypes for Chargebee invoices, each with count=1. ALL three must have fieldOverrides including status=\\"payment_due\\". Their total fields (in pence) must be 480000, 420000, 340000 — set each total as a LITERAL in fieldOverrides, NEVER in vary.range. One of the three (the oldest) must have date=\\"2026-04-11T00:00:00Z\\" in fieldOverrides. due_date on each of the three must be strictly after date."
    }
  ]
}
\`\`\`

## Output rules

- Output ONLY valid JSON matching the schema. No markdown.
- Each \`id\` is unique kebab-case.
- Each \`instruction\` is imperative and complete — the distribution LLM should not need to refer back to the persona for this constraint.
- Coverage: a rich persona produces 15-40 constraints. Don't over-extract trivia, but don't under-extract either. Every pinned numeric and every pinned date should produce at least one constraint.
`;

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export interface ExtractPersonaConstraintsOptions {
  persona: { name: string; description: string };
  domain: string;
  /** Adapter ids configured for this persona — surfaced so scope can name them. */
  adapterIds: string[];
  /** API resources per adapter — surfaced so scope can name them. */
  adapterResources?: Record<string, string[]>;
  /** DB table names — surfaced so table-scoped constraints have known targets. */
  tableNames?: string[];
}

export async function extractPersonaConstraints(
  llm: ILLMClient,
  opts: ExtractPersonaConstraintsOptions,
): Promise<PersonaConstraint[]> {
  const { persona, domain, adapterIds, adapterResources, tableNames } = opts;

  const surfaceLines: string[] = ['## Available scopes', ''];
  surfaceLines.push('### API platforms (use scope.adapter + scope.resource)');
  for (const ad of adapterIds) {
    const resList = adapterResources?.[ad] ?? [];
    surfaceLines.push(`- ${ad}: ${resList.join(', ') || '(no resource list available)'}`);
  }
  if (tableNames && tableNames.length > 0) {
    surfaceLines.push('', '### DB tables (use scope.table)');
    for (const t of tableNames) surfaceLines.push(`- ${t}`);
  }

  const prompt = [
    `Domain: ${domain}`,
    `Persona: "${persona.name}"`,
    '',
    persona.description,
    '',
    surfaceLines.join('\n'),
    '',
    'Extract all testable persona-pinning constraints. Return JSON.',
  ].join('\n');

  try {
    const result = await llm.generateObject({
      schema: PersonaConstraintListSchema,
      schemaName: 'PersonaConstraints',
      schemaDescription:
        'Imperative pinning instructions extracted from the persona description, scoped to platforms/resources/tables.',
      system: EXTRACTION_SYSTEM,
      prompt,
      label: `persona-constraints:${persona.name}`,
      category: 'generation',
      temperature: 0.1,
    });

    const constraints = result.object.constraints;
    debugFile(`PERSONA_CONSTRAINTS [${persona.name}]`, {
      count: constraints.length,
      constraints,
    });
    logger.success(
      `Extracted ${constraints.length} persona constraint(s) for ${persona.name}`,
    );
    return constraints;
  } catch (err) {
    logger.warn(
      `Persona constraint extraction failed: ${
        err instanceof Error ? err.message : String(err)
      }. ` + `Continuing without pinned constraints — distribution LLM will rely on persona text alone.`,
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Filtering for downstream consumers
// ---------------------------------------------------------------------------

/**
 * Return constraints that apply to a given (adapter, resource) pair.
 * Matches when the constraint's scope names this adapter+resource exactly,
 * OR when it names only the adapter (resource-agnostic), OR when it has no
 * adapter/resource set (table-only — exclude here, those go to DB calls).
 */
export function constraintsForResource(
  constraints: readonly PersonaConstraint[],
  adapter: string,
  resource: string,
): PersonaConstraint[] {
  const out: PersonaConstraint[] = [];
  for (const c of constraints) {
    const { adapter: a, resource: r, table } = c.scope;
    if (table && !a && !r) continue; // pure-table constraint, skip for API call
    if (a && a !== adapter) continue;
    if (r && r !== resource) continue;
    out.push(c);
  }
  return out;
}

/**
 * Return constraints that apply to a given DB table.
 * Matches when scope.table === table, OR when scope is empty (rare cross-cutting
 * constraints that the caller decides to surface everywhere).
 */
export function constraintsForTable(
  constraints: readonly PersonaConstraint[],
  table: string,
): PersonaConstraint[] {
  return constraints.filter((c) => c.scope.table === table);
}

/**
 * Render a list of constraints into a "PERSONA-PINNED REQUIREMENTS" prose
 * block for direct injection into a distribution prompt.
 */
export function renderConstraintsBlock(
  constraints: readonly PersonaConstraint[],
): string {
  if (constraints.length === 0) return '';
  const lines = [
    '## PERSONA-PINNED REQUIREMENTS — HARD CONSTRAINTS',
    '',
    'The following requirements were extracted from the persona description. Each is a ' +
      'HARD CONSTRAINT: your archetypes MUST satisfy every requirement exactly. Numeric ' +
      'values are already in minor units (pence/cents) — write them as literals in ' +
      'fieldOverrides, NEVER as vary.range. Dates are already ISO 8601.',
    '',
  ];
  for (const c of constraints) {
    lines.push(`### ${c.id}`);
    lines.push(`_${c.description}_`);
    lines.push('');
    lines.push(c.instruction);
    lines.push('');
  }
  return lines.join('\n');
}
