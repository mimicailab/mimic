/**
 * Claim extractor — Layer 2 of the V2 architecture.
 *
 * One narrow LLM call: turn a persona description in natural language into
 * a structured contract { personaProfile, claims, anchors }. Nothing else.
 *
 * Downstream layers (bridge rewriter, topology, content generator, count
 * solver) consume this output deterministically or by routing each claim
 * to its target slot. The LLM is no longer load-bearing for archetypes,
 * counts, weights, or bridge-table compliance — those are owned by code.
 *
 * Reference: private/v2.md — "Layer 2: Claim extraction".
 */

import type { SchemaModel, AdapterResourceSpecs, PromptContext } from '../types/index.js';
import type { SchemaMapping, PersonaProfile, Anchor } from '../types/blueprint.js';
import type { Claim } from '../types/claim.js';
import type { LLMClient } from '../llm/client.js';
import { ClaimExtractionOutputSchema } from './blueprint-zod.js';
import type { ClaimExtractionOutput } from './blueprint-zod.js';
import { buildClaimExtractionPrompt } from './prompts.js';
import { BlueprintGenerationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ExtractClaimsOptions {
  /** LLM temperature override */
  temperature?: number;
  /** Maximum retries for the LLM call */
  maxRetries?: number;
  /** Current date (ISO YYYY-MM-DD) */
  currentDate?: string;
  /** Volume string from config (e.g. "6 months") */
  volume?: string;
  /** 1-based persona index */
  personaIndex?: number;
  totalPersonas?: number;
}

export interface ExtractClaimsResult {
  personaId: string;
  domain: string;
  persona: PersonaProfile;
  claims: Claim[];
  anchors: Anchor[];
}

/**
 * Run the claim-extraction LLM call.
 *
 * The output is structurally validated by the Zod schema; downstream layers
 * can trust that `claims` is a Claim[] and `anchors` is an Anchor[].
 */
export async function extractClaims(
  llm: LLMClient,
  persona: { name: string; description: string },
  domain: string,
  schema: SchemaModel,
  promptContexts: Record<string, PromptContext> | undefined,
  resourceSpecs: Record<string, AdapterResourceSpecs> | undefined,
  schemaMapping: SchemaMapping | undefined,
  options: ExtractClaimsOptions = {},
): Promise<ExtractClaimsResult> {
  // Build the adapter → resources map used to ground claim targets.
  // Prefer resourceSpecs (canonical) over promptContexts (legacy).
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

  const { system, user } = buildClaimExtractionPrompt({
    schema,
    persona,
    domain,
    adapterResources: Object.keys(adapterResources).length > 0 ? adapterResources : undefined,
    schemaMapping,
    currentDate: options.currentDate,
    volume: options.volume,
    personaIndex: options.personaIndex,
    totalPersonas: options.totalPersonas,
  });

  logger.step(`Extracting persona contract for "${persona.name}"...`);

  let output: ClaimExtractionOutput;
  try {
    const result = await llm.generateObject({
      schema: ClaimExtractionOutputSchema,
      schemaName: 'PersonaContract',
      schemaDescription:
        'Structured persona contract — personaId, domain, profile, claims, and anchors. ' +
        'No archetypes, counts, or weights — those are produced downstream.',
      system,
      prompt: user,
      label: `claim-extract:${persona.name}`,
      category: 'generation',
      temperature: options.temperature,
      maxRetries: options.maxRetries,
    });
    output = result.object;
  } catch (error) {
    if (error instanceof BlueprintGenerationError) throw error;
    throw new BlueprintGenerationError(
      `Failed to extract persona contract for "${persona.name}"`,
      'Check your LLM configuration, API key, and network connectivity. ' +
        'Claim extraction is the first LLM call in the V2 pipeline — if it fails, no other ' +
        'work has happened, so this is safe to retry.',
      error instanceof Error ? error : undefined,
    );
  }

  // Soft validation — surface a warning when no claims were extracted.
  // A persona description with zero numeric/factual predicates is unusual;
  // generation will still proceed but the auditor will have nothing to check.
  if (output.claims.length === 0) {
    logger.warn(
      `Claim extraction produced 0 claims for "${persona.name}". ` +
        'The persona description may be too qualitative; no audit will run.',
    );
  } else {
    logger.success(
      `Persona contract: ${output.claims.length} claim${output.claims.length === 1 ? '' : 's'}` +
        (output.anchors && output.anchors.length > 0
          ? `, ${output.anchors.length} anchor${output.anchors.length === 1 ? '' : 's'}`
          : ''),
    );
  }

  return {
    personaId: output.personaId,
    domain: output.domain,
    persona: output.persona,
    claims: output.claims as Claim[],
    anchors: output.anchors ?? [],
  };
}
