/**
 * Content generator — Layer 4 of the V2 architecture.
 *
 * One LLM call per resource slot. Each call is narrow: the LLM sees the
 * slot's schema/spec, the claims it must satisfy, the relevant anchors,
 * and the persona — nothing else. Output is `archetypes[]` with no count
 * and no weight; downstream layers (orchestrator default-weight, count
 * solver, expander) own those.
 *
 * Calls are fanned out in parallel with a bounded concurrency. Each call
 * is independent — a failure in one slot does NOT block the others, but
 * if any slot fails after retry the whole pipeline aborts (silent partial
 * data is the failure mode V2 is designed to eliminate).
 *
 * Reference: private/v2.md — "Layer 4: Content generation".
 */

import type {
  EntityArchetype,
  EntityArchetypeConfig,
  FieldVariation,
  Anchor,
  SchemaMapping,
} from '../types/blueprint.js';
import type { Claim } from '../types/claim.js';
import type { ResourceSlot } from './topology.js';
import type { ILLMClient } from '../llm/client.js';
import type { AdapterResourceSpecs, PromptContext } from '../types/index.js';
import {
  DbSlotContentOutputSchema,
  ApiSlotContentOutputSchema,
  type DbSlotContentOutput,
  type ApiSlotContentOutput,
} from './blueprint-zod.js';
import { buildContentPrompt, collectIdentityContract, type SlotPromptClaim } from './prompts.js';
import {
  assembleResourceArchetypes,
  type ArchetypeDistribution,
  type DistributionOutput,
} from './resource-assembler.js';
import { BlueprintGenerationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerateSlotContentOptions {
  persona: { name: string; description: string };
  domain: string;
  /** All extracted anchors — passed to every slot; the LLM picks the ones that belong */
  anchors: Anchor[];
  /** For API slots: per-adapter prompt context (id-prefix derivation) */
  promptContexts?: Record<string, PromptContext>;
  /** Full resource-spec map; needed to pass slots into the assembler */
  resourceSpecs?: Record<string, AdapterResourceSpecs>;
  /** Schema mapping — drives the identity-contract per-slot rendering */
  schemaMapping?: SchemaMapping;
  /** Maximum concurrent LLM calls. Defaults to 4. */
  concurrency?: number;
  /** LLM temperature override */
  temperature?: number;
  /** Maximum LLM retries per slot */
  maxRetries?: number;
  /** Current date (ISO YYYY-MM-DD) */
  currentDate?: string;
  /** Volume string from config (e.g. "6 months") */
  volume?: string;
  /** 1-based persona index */
  personaIndex?: number;
  totalPersonas?: number;
}

/**
 * Result of fanning out content generation across all slots.
 *
 * The orchestrator merges these into the final Blueprint:
 *   - entityArchetypes  ← merged from db slot results
 *   - apiEntityArchetypes ← merged from api slot results
 */
export interface SlotContentResult {
  slot: ResourceSlot;
  config: EntityArchetypeConfig;
}

/**
 * Run the per-slot content LLM calls in parallel, returning the assembled
 * `EntityArchetypeConfig` for each slot.
 *
 * - Empty slots (no claims AND no schema requirement) are short-circuited
 *   with a single ambient archetype so the schema still gets covered.
 * - Concurrency is bounded by `options.concurrency` (default 4).
 * - Each call is labelled with the slot's key for cost tracking.
 */
export async function generateAllSlots(
  llm: ILLMClient,
  slots: ResourceSlot[],
  options: GenerateSlotContentOptions,
): Promise<SlotContentResult[]> {
  const concurrency = Math.max(1, options.concurrency ?? 4);

  // Promise-based concurrency limiter. Vendored to avoid pulling p-limit
  // for one small need.
  const queue: Array<() => Promise<SlotContentResult>> = slots.map(
    (slot) => () => generateOneSlot(llm, slot, options),
  );

  const results: SlotContentResult[] = new Array(slots.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const myIndex = cursor++;
      if (myIndex >= queue.length) return;
      const task = queue[myIndex]!;
      results[myIndex] = await task();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, worker);
  await Promise.all(workers);

  return results;
}

// ---------------------------------------------------------------------------
// Per-slot content generation
// ---------------------------------------------------------------------------

async function generateOneSlot(
  llm: ILLMClient,
  slot: ResourceSlot,
  options: GenerateSlotContentOptions,
): Promise<SlotContentResult> {
  if (slot.surface === 'db') {
    return generateDbSlot(llm, slot, options);
  }
  return generateApiSlot(llm, slot, options);
}

async function generateDbSlot(
  llm: ILLMClient,
  slot: ResourceSlot,
  options: GenerateSlotContentOptions,
): Promise<SlotContentResult> {
  const { system, user } = buildContentPrompt({
    persona: options.persona,
    domain: options.domain,
    surface: 'db',
    name: slot.name,
    dbTable: slot.dbTable,
    claims: slot.claims.map(claimToPromptClaim),
    anchors: options.anchors,
    identityContractEntries: collectIdentityContract({
      schemaMapping: options.schemaMapping,
      personaIndex: options.personaIndex,
      promptContexts: options.promptContexts,
      resourceSpecs: options.resourceSpecs,
    }).filter((e) => e.dbTable === slot.name),
    currentDate: options.currentDate,
    volume: options.volume,
    personaIndex: options.personaIndex,
    totalPersonas: options.totalPersonas,
    defaultCountHint: slot.suggestedCount,
  });

  const label = `content:db:${slot.name}:${options.persona.name}`;

  let output: DbSlotContentOutput;
  try {
    const result = await llm.generateObject({
      schema: DbSlotContentOutputSchema,
      schemaName: 'DbSlotContent',
      schemaDescription: `Archetypes for DB table "${slot.name}"`,
      system,
      prompt: user,
      label,
      category: 'generation',
      temperature: options.temperature,
      maxRetries: options.maxRetries,
    });
    output = result.object;
  } catch (error) {
    throw wrapContentError(slot, error);
  }

  const archetypes = output.archetypes.map<EntityArchetype>((a) => ({
    label: a.label,
    weight: 1, // uniform default — count solver assigns actual counts via cites
    fields: a.fields ?? {},
    vary: (a.vary ?? {}) as Record<string, FieldVariation>,
    ...(a.cites && a.cites.length > 0 ? { cites: a.cites } : {}),
    ...(a.anchor ? { anchor: a.anchor } : {}),
  }));

  // Distribute the default weight uniformly across non-anchor archetypes
  // so the expander's weight-based distribution gives a sensible default
  // BEFORE the solver runs.
  normaliseWeights(archetypes);

  const config: EntityArchetypeConfig = {
    count: slot.suggestedCount,
    archetypes,
  };

  logger.debug(
    `Content [${label}]: ${archetypes.length} archetype${archetypes.length === 1 ? '' : 's'}, suggested count ${slot.suggestedCount}`,
  );

  return { slot, config };
}

async function generateApiSlot(
  llm: ILLMClient,
  slot: ResourceSlot,
  options: GenerateSlotContentOptions,
): Promise<SlotContentResult> {
  if (!slot.adapterId || !slot.resourceType || !slot.apiResource || !slot.apiPlatform || !options.resourceSpecs) {
    throw new BlueprintGenerationError(
      `API slot "${slot.name}" missing adapter spec context`,
      'Internal invariant violation — content generation requires the full resource spec.',
    );
  }
  const specsForAdapter = options.resourceSpecs[slot.adapterId];
  if (!specsForAdapter) {
    throw new BlueprintGenerationError(
      `API slot "${slot.name}" references adapter "${slot.adapterId}" which has no resourceSpecs entry`,
      'Add a generated/resource-specs.ts to that adapter.',
    );
  }

  const { system, user } = buildContentPrompt({
    persona: options.persona,
    domain: options.domain,
    surface: 'api',
    name: slot.name,
    apiPlatform: slot.apiPlatform,
    apiResource: slot.apiResource,
    claims: slot.claims.map(claimToPromptClaim),
    anchors: options.anchors,
    identityContractEntries: collectIdentityContract({
      schemaMapping: options.schemaMapping,
      personaIndex: options.personaIndex,
      promptContexts: options.promptContexts,
      resourceSpecs: options.resourceSpecs,
      filterAdapters: [slot.adapterId],
    }).filter((e) => e.adapterId === slot.adapterId && e.apiResource === slot.resourceType),
    currentDate: options.currentDate,
    volume: options.volume,
    personaIndex: options.personaIndex,
    totalPersonas: options.totalPersonas,
    defaultCountHint: slot.suggestedCount,
  });

  const label = `content:api:${slot.name}:${options.persona.name}`;

  let output: ApiSlotContentOutput;
  try {
    const result = await llm.generateObject({
      schema: ApiSlotContentOutputSchema,
      schemaName: 'ApiSlotContent',
      schemaDescription: `Archetypes for API resource "${slot.name}"`,
      system,
      prompt: user,
      label,
      category: 'generation',
      temperature: options.temperature,
      maxRetries: options.maxRetries,
    });
    output = result.object;
  } catch (error) {
    throw wrapContentError(slot, error);
  }

  // Translate LLM-flat content output into the assembler's ArchetypeDistribution shape.
  const archetypeDistributions: ArchetypeDistribution[] = output.archetypes.map((a) => ({
    label: a.label,
    weight: 1, // uniform default; assembler preserves it, solver overrides via counts
    fieldOverrides: a.fieldOverrides
      ? Object.fromEntries(a.fieldOverrides.map((e) => [e.field, coerceValue(e.value)]))
      : undefined,
    vary: a.vary
      ? Object.fromEntries(
          a.vary.map((v) => {
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
          }),
        )
      : undefined,
    ...(a.cites && a.cites.length > 0 ? { cites: a.cites } : {}),
    ...(a.anchor ? { anchor: a.anchor } : {}),
    ...(a.apiOnly ? { apiOnly: true } : {}),
  }));

  // Run the existing assembler so spec-derived auto-vary (sequence prefixes,
  // timestamp variation, email/name handling, FK resolution) is applied.
  // We assemble a *one-resource* distribution to scope the assembler to
  // this slot only.
  const singleResourceDistribution: DistributionOutput = {
    [slot.resourceType]: {
      count: slot.suggestedCount,
      archetypes: archetypeDistributions,
    },
  };
  // The assembler signature requires AdapterResourceSpecs — we pass the full
  // spec object so cross-resource references can still resolve, even though
  // only one resource is in the distribution.
  const assembledForAdapter = assembleResourceArchetypes(
    specsForAdapter,
    singleResourceDistribution,
    { personaIndex: options.personaIndex },
  );

  // assembleResourceArchetypes returns a record { [resourceKey]: config };
  // we only want the one we generated.
  const config = assembledForAdapter[slot.resourceType];
  if (!config) {
    throw new BlueprintGenerationError(
      `Assembler returned no config for API slot "${slot.name}"`,
      'Internal invariant violation — the slot resourceType did not match any spec key.',
    );
  }

  // After the assembler, normalise weights to uniform across non-anchor
  // archetypes so weight-based expansion is sensible until the solver runs.
  normaliseWeights(config.archetypes);

  logger.debug(
    `Content [${label}]: ${config.archetypes.length} archetype${config.archetypes.length === 1 ? '' : 's'}, suggested count ${slot.suggestedCount}`,
  );

  return { slot, config };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function claimToPromptClaim(c: Claim): SlotPromptClaim {
  // Echo every claim field back to the prompt so the LLM sees the full
  // predicate (including kind-specific extras like `expected`, `field`,
  // `perRow`, `min`/`max`, `values`, `tolerance`).
  const { id, quote, kind, target, ...extras } = c as Claim & Record<string, unknown>;
  return {
    id,
    quote,
    kind,
    target: {
      surface: target.surface,
      name: target.name,
      filter: target.filter,
    },
    ...extras,
  } as SlotPromptClaim;
}

/**
 * Normalise weights uniformly across non-anchor / non-apiOnly archetypes so
 * the expander's weight-based distribution gives a sensible default BEFORE
 * the count solver assigns explicit counts via cites. Anchor and apiOnly
 * archetypes are additive and keep weight: 0.
 */
function normaliseWeights(archetypes: EntityArchetype[]): void {
  const matched = archetypes.filter((a) => !a.anchor && !a.apiOnly);
  if (matched.length === 0) return;
  const share = 1 / matched.length;
  for (const a of archetypes) {
    if (a.anchor || a.apiOnly) {
      a.weight = 0;
    } else {
      a.weight = share;
    }
  }
}

function coerceValue(v: string | number | boolean | null): unknown {
  if (typeof v !== 'string') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v.trim() === '') return v;
  const n = Number(v);
  if (!Number.isNaN(n)) return n;
  return v;
}

function wrapContentError(slot: ResourceSlot, error: unknown): BlueprintGenerationError {
  if (error instanceof BlueprintGenerationError) return error;
  return new BlueprintGenerationError(
    `Per-slot content generation failed for ${slot.surface}.${slot.name}`,
    'Per-slot calls are independent — check the LLM logs for this slot only. ' +
      'Other slots may have succeeded; the orchestrator will retry the whole pipeline.',
    error instanceof Error ? error : undefined,
  );
}
