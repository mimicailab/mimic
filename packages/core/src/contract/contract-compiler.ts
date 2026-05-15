/**
 * V4.5 — Layer 1: Contract compiler.
 *
 * One narrow LLM call: turn persona text into a `PersonaContract` made of
 * clauses. The compiler is the only place where natural language enters the
 * pipeline; everything downstream consumes structured clauses.
 *
 * The contract is the source of truth. The execution plan that the V2/V3
 * generator consumes is a LOWERED subset of these clauses — see
 * `lowering.ts`. The fidelity validator still checks the original clauses
 * after generation, so a clause cannot disappear silently the way a
 * pre-V4.5 unrepresented requirement could.
 *
 * Reference: private/v4.5.md — "Layer 1: Contract compiler".
 */

import type {
  AdapterResourceSpecs,
  PromptContext,
  SchemaModel,
} from '../types/index.js';
import type { ILLMClient } from '../llm/client.js';
import { ContractCompilerOutputSchema, type ContractCompilerOutput } from './contract-zod.js';
import { buildCompilerUserPrompt } from './compiler-prompt.js';
import { BlueprintGenerationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { PersonaContract } from './persona-contract.js';
import type { Clause, AnchorClause } from './clause-types.js';
import { canonicaliseSemanticClauses } from './semantic-capabilities.js';

/** Bumped when the clause shape changes — used in PersonaContract.compilerVersion. */
export const CONTRACT_COMPILER_VERSION = 'v5';

export interface CompileContractOptions {
  temperature?: number;
  maxRetries?: number;
  currentDate?: string;
  volume?: string;
  personaIndex?: number;
  totalPersonas?: number;
}

const SYSTEM_PROMPT = `You are a synthetic data architect. Your single job is to compile a persona description into a PersonaContract — a structured list of clauses that downstream code will route, lower, and validate.

##############################################################################
# OUTPUT
##############################################################################

Return a JSON object matching the provided schema, with:
  - personaId: stable kebab-case id (e.g. "sarah-chen").
  - domain: the domain string from the user prompt, verbatim.
  - persona: coherent profile { name, age, occupation, location, salary?, description }.
  - clauses: every requirement the persona expresses, one per checkable point.
  - anchors: persona-narrated events that pin a customer + named date(s). Only
    needed when the binding (customer name, dates) doesn't already live on an
    anchor-family clause.

##############################################################################
# CLAUSES — THE SOURCE OF TRUTH
##############################################################################

The persona description is the contract. Every numeric, factual, distributional, or anchored statement it makes is a CLAUSE the data must reflect. Be exhaustive — uncited persona facts become silent data drift downstream.

Each clause MUST carry:
  - id: kebab-case stable id (e.g. "stripe-overdue-count").
  - quote: the EXACT persona text the clause was extracted from, verbatim.
  - family: one of count | aggregate | distribution | temporal | anchor | cross_surface | reconciliation | narrative.
  - strength: "hard" if the run should block when no rule covers it, otherwise "soft".

Pick "hard" by default for any explicit number, named event, or cross-surface assertion. Pick "soft" only for style/tone/qualitative material.

## Target shape — read this carefully

Every clause that talks about rows carries a "target" object:

  target = { surface: "db" | "api", name: <string>, filter?: { ... } }

Naming rules — there is exactly ONE correct form per surface:

  - surface="db"  → name is a bare table name. Examples: "users", "invoices", "subscriptions".
  - surface="api" → name is "<adapter>.<resource>", with NO "api." prefix.
                     CORRECT:   { "surface": "api", "name": "stripe.subscription" }
                     WRONG:     { "surface": "api", "name": "api.stripe.subscription" }
                     WRONG:     { "surface": "api", "name": "api/stripe/subscription" }
                     WRONG:     { "surface": "api", "name": "stripe/subscription" }

The "api" prefix is already conveyed by surface="api". Repeating it in "name" produces a target nothing matches and silently breaks the downstream audit.

## Semantic targets — use these when the persona is describing business cohorts

When the persona describes a BUSINESS COHORT rather than a literal implementation surface,
prefer a semanticTarget and only fall back to a raw target when the persona explicitly names the
surface/table/resource or when no semantic target fits.

The currently supported semantic target is:

  semanticTarget = {
    kind: "billing_customer_cohort",
    adapter: "stripe",
    facets?: {
      billingState?: "paying" | "free",
      tier?: "starter" | "pro" | "enterprise" | <other canonical tier label>
    }
  }

  semanticTarget = {
    kind: "product_user_cohort",
    table: "users",
    facets?: {
      billingState?: "paying" | "free",
      tier?: "starter" | "pro" | "enterprise" | <other canonical tier label>,
      linkage?: "linked" | "unlinked"
    }
  }

Examples:
  - "100 starter customers on Stripe" -> family="count", semanticTarget={kind:"billing_customer_cohort",adapter:"stripe",facets:{billingState:"paying",tier:"starter"}}
  - "60% starter / 30% pro / 10% enterprise among paid customers" -> family="distribution", semanticTarget={kind:"billing_customer_cohort",adapter:"stripe",facets:{billingState:"paying"}}, semanticField="tier"
  - "847 free-tier users in the product database" -> family="count", target={surface:"db",name:"users",filter:{plan:"free"}}, semanticTarget={kind:"product_user_cohort",table:"users",facets:{billingState:"free"}}
  - "34 users with paid plan flags but no corresponding billing platform record" -> family="count", target={surface:"db",name:"users",filter:{plan:{neq:"free"},billing_platform:null}}, semanticTarget={kind:"product_user_cohort",table:"users",facets:{billingState:"paying",linkage:"unlinked"}}

Semantic targets are the contract-level source of truth. Downstream code lowers them into executable surface predicates deterministically.

## Clause families

- **count** — "1,200 Stripe customers", "847 free-tier users". A count of rows matching a filter.
  Use family="count" with target + expected. Filters are field-equality conjunctions; use only fields that appear on the named resource.

- **aggregate** — "3 overdue invoices totalling £12,400", "average MRR per pro user is $29". op = "sum" | "avg" on a numeric field.

- **distribution** — "60% on starter, 30% pro, 10% enterprise". A categorical mix across buckets, in percentage points 0-100.

- **temporal** —
    * kind="window": "47 logins in the last 7 days". A count of rows whose date field falls in [min,max].
    * kind="relative_gap": "canceled 9 days after the duplicate charge". An anchorA→anchorB temporal offset. Use the anchor IDs you also declare in anchor-family clauses or in the anchors block.

- **anchor** — A named persona event: customer + dates. Use one anchor clause per concrete event the persona names ("Klein Records duplicate charge on 2026-04-29"). Always include the customer descriptor and at least an "event" date.

- **cross_surface** — A disagreement / agreement between two surfaces about the same entity. Example: "Larkspur is active in Postgres and canceled in Stripe with a 9-day drift". Set surfaceA + surfaceB, the disagreeing field, and the two expected values. driftDays is the lag from surfaceA to surfaceB if the persona says so.

- **reconciliation** — A headline metric that should equal the sum of named sub-contributions. Example: "MRR drop of $4,820 explained by 5 causes". metric is a short stable name (e.g. "mrr_delta"), headline is the target, and buckets enumerate each named cause with its own filter/aggregation.

- **narrative** — Style or tone only ("believable support notes", "tone is friendly but firm"). Never numeric. These will be marked soft_only and never block.

## Hard vs soft

If the persona names a specific number, dates, customer, or surface, the clause is HARD. Soft is reserved for genuinely qualitative material.

If a hard clause cannot be expressed faithfully in any of the families above, still emit it under the closest matching family with the persona quote — downstream coverage planning will mark it unsupported_blocking, which is the desired loud failure rather than silent loss.

## Quoting

The quote MUST be a contiguous substring of the persona description, not a paraphrase. The fidelity validator surfaces these quotes in failure reports.`;

export async function compileContract(
  llm: ILLMClient,
  persona: { name: string; description: string },
  domain: string,
  schema: SchemaModel,
  promptContexts: Record<string, PromptContext> | undefined,
  resourceSpecs: Record<string, AdapterResourceSpecs> | undefined,
  options: CompileContractOptions = {},
): Promise<PersonaContract> {
  const adapterResources: Record<string, string[]> = {};
  if (resourceSpecs) {
    for (const [adapterId, specs] of Object.entries(resourceSpecs)) {
      adapterResources[adapterId] = Object.keys(specs.resources);
    }
  } else if (promptContexts) {
    for (const [adapterId, ctx] of Object.entries(promptContexts)) {
      adapterResources[adapterId] = ctx.resources;
    }
  }

  const user = buildCompilerUserPrompt({
    schema,
    persona,
    domain,
    adapterResources: Object.keys(adapterResources).length > 0 ? adapterResources : undefined,
    resourceSpecs,
    currentDate: options.currentDate,
    volume: options.volume,
    personaIndex: options.personaIndex,
    totalPersonas: options.totalPersonas,
  });

  logger.step(`Compiling persona contract for "${persona.name}"...`);

  let output: ContractCompilerOutput;
  try {
    const result = await llm.generateObject({
      schema: ContractCompilerOutputSchema,
      schemaName: 'PersonaContract',
      schemaDescription:
        'Compiled persona contract — personaId, domain, profile, clauses, and anchors. ' +
          'Clauses carry source quote + family + strength; the contract is the source of truth.',
      system: SYSTEM_PROMPT,
      prompt: user,
      label: `contract-compile:${persona.name}`,
      category: 'generation',
      temperature: options.temperature,
      maxRetries: options.maxRetries,
    });
    output = result.object;
  } catch (error) {
    if (error instanceof BlueprintGenerationError) throw error;
    throw new BlueprintGenerationError(
      `Failed to compile persona contract for "${persona.name}"`,
      'Contract compilation is the first LLM call in the V4.5 pipeline. ' +
        'Check your LLM configuration, API key, and network connectivity, then retry.',
      error instanceof Error ? error : undefined,
    );
  }

  // Defensive normalisation — strip stray "api." prefixes the LLM occasionally
  // adds to api-surface target names (e.g. "api.stripe.subscription"). The
  // surface="api" discriminator already conveys the prefix; repeating it in
  // `name` produces a target nothing matches.
  const normaliseStripped = normaliseTargets(output.clauses as Clause[]);
  if (normaliseStripped > 0) {
    logger.warn(
      `Contract compiler emitted ${normaliseStripped} target(s) with a leading "api." prefix — normalised to "<adapter>.<resource>".`,
    );
  }

  const canonicalised = canonicaliseSemanticClauses(output.clauses as Clause[]);
  if (canonicalised > 0) {
    logger.info(
      `Contract compiler canonicalised ${canonicalised} clause change(s) onto semantic targets before coverage planning.`,
    );
  }

  const softenedReconciliations = softenIncompletePlatformReconciliations(output.clauses as Clause[]);
  if (softenedReconciliations > 0) {
    logger.warn(
      `Contract compiler softened ${softenedReconciliations} incomplete platform reconciliation clause(s) whose quoted platform count exceeded the emitted bucket count.`,
    );
  }

  if (output.clauses.length === 0) {
    logger.warn(
      `Contract compiler produced 0 clauses for "${persona.name}". ` +
        'The persona description may be too qualitative; the fidelity validator will have nothing to check.',
    );
  } else {
    const hard = output.clauses.filter((c) => c.strength === 'hard').length;
    logger.success(
      `Persona contract: ${output.clauses.length} clause${output.clauses.length === 1 ? '' : 's'} ` +
        `(${hard} hard, ${output.clauses.length - hard} soft)` +
        (output.anchors && output.anchors.length > 0
          ? `, ${output.anchors.length} anchor${output.anchors.length === 1 ? '' : 's'}`
          : ''),
    );
  }

  // Derive anchors from anchor-family clauses when the LLM didn't supply
  // them in the dedicated `anchors` block — keeps the lowering step simple
  // and the contract self-consistent.
  const anchors = mergeAnchors(output.clauses as Clause[], output.anchors ?? []);

  return {
    personaId: output.personaId,
    domain: output.domain,
    persona: output.persona,
    source: { name: persona.name, description: persona.description },
    clauses: output.clauses as Clause[],
    anchors,
    compiledAt: new Date().toISOString(),
    compilerVersion: CONTRACT_COMPILER_VERSION,
  };
}

function mergeAnchors(
  clauses: Clause[],
  declared: Array<{ id: string; customer?: { match: string }; dates: Record<string, string> }>,
): PersonaContract['anchors'] {
  const byId = new Map<string, PersonaContract['anchors'][number]>();
  for (const a of declared) byId.set(a.id, { id: a.id, customer: a.customer, dates: a.dates });

  for (const c of clauses) {
    if (c.family !== 'anchor') continue;
    const ac = c as AnchorClause;
    const existing = byId.get(ac.anchorId);
    if (existing) {
      // Merge: declared block wins on conflicts; fill in missing dates/customer.
      const merged = { ...existing };
      if (!merged.customer && ac.customer) merged.customer = { match: ac.customer };
      merged.dates = { ...ac.dates, ...existing.dates };
      byId.set(ac.anchorId, merged);
    } else {
      byId.set(ac.anchorId, {
        id: ac.anchorId,
        customer: ac.customer ? { match: ac.customer } : undefined,
        dates: ac.dates,
      });
    }
  }

  return [...byId.values()];
}

/**
 * Guard against the compiler inventing a blocking platform-wide
 * reconciliation from a headline like "across 8 billing platforms" while only
 * emitting a subset of platform buckets. The headline aggregate remains hard;
 * only the incomplete derived reconciliation is softened.
 */
export function softenIncompletePlatformReconciliations(clauses: Clause[]): number {
  let softened = 0;
  for (const clause of clauses) {
    if (clause.family !== 'reconciliation' || clause.strength !== 'hard') continue;
    const expectedBucketCount = quotedPlatformCount(clause.quote);
    if (expectedBucketCount == null || clause.buckets.length >= expectedBucketCount) continue;
    clause.strength = 'soft';
    softened++;
  }
  return softened;
}

function quotedPlatformCount(quote: string): number | undefined {
  const match = quote.match(/\bacross\s+(\d+)\s+billing platforms?\b/i)
    ?? quote.match(/\bacross\s+(\d+)\s+platforms?\b/i);
  if (!match) return undefined;
  const value = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Walk every clause that carries a ResourceTarget and strip a leading
 * "api." prefix from api-surface target names. Returns the number of
 * targets that had to be normalised.
 *
 * The contract compiler's system prompt and schema description tell the
 * LLM not to put "api." into `name` (surface="api" already conveys it),
 * but the model occasionally slips. Without this normalisation, the
 * lowered claim ends up with `target.name="api.stripe.subscription"`,
 * which selects no rows and silently fails the audit.
 */
function normaliseTargets(clauses: Clause[]): number {
  let count = 0;
  for (const clause of clauses) {
    const targets = collectTargets(clause);
    for (const t of targets) {
      if (t.surface === 'api' && typeof t.name === 'string' && t.name.startsWith('api.')) {
        t.name = t.name.slice(4);
        count++;
      }
    }
  }
  return count;
}

function collectTargets(
  clause: Clause,
): Array<{ surface: 'db' | 'api'; name: string }> {
  const out: Array<{ surface: 'db' | 'api'; name: string }> = [];
  // Each family's payload may or may not carry targets — read carefully
  // by family to avoid touching unrelated string fields.
  switch (clause.family) {
    case 'count':
    case 'aggregate':
    case 'distribution':
      if (clause.target) {
        out.push(clause.target as { surface: 'db' | 'api'; name: string });
      }
      break;
    case 'temporal':
      if (clause.kind === 'window') {
        if (clause.target) {
          out.push(clause.target as { surface: 'db' | 'api'; name: string });
        }
      }
      break;
    case 'cross_surface':
      out.push(clause.surfaceA as { surface: 'db' | 'api'; name: string });
      out.push(clause.surfaceB as { surface: 'db' | 'api'; name: string });
      break;
    case 'reconciliation':
      for (const b of clause.buckets) {
        out.push(b.target as { surface: 'db' | 'api'; name: string });
      }
      break;
    case 'anchor':
    case 'narrative':
      break;
  }
  return out;
}
