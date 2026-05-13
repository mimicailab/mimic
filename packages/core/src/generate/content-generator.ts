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
  AdapterBatchOutputSchema,
  DbBatchOutputSchema,
  type DbSlotContentOutput,
  type ApiSlotContentOutput,
  type AdapterBatchOutput,
  type DbBatchOutput,
} from './blueprint-zod.js';
import {
  buildContentPrompt,
  buildAdapterBatchPrompt,
  buildDbBatchPrompt,
  collectIdentityContract,
  type SlotPromptClaim,
  type BatchSlotEntry,
} from './prompts.js';
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
 * Run the content LLM calls and return the assembled `EntityArchetypeConfig`
 * for each slot.
 *
 * V2.5: slots are GROUPED before being sent to the LLM. All API slots for an
 * adapter share one call (so the LLM can wire customer/subscription/price
 * coherently); all DB slots share one call. This drops the call count from
 * ~107 → ~10 for cfo-agent-skills while preserving cross-resource
 * consistency that per-slot fanout broke.
 *
 * Concurrency is bounded by `options.concurrency` (default 4) but typically
 * there are only a handful of batches.
 */
export async function generateAllSlots(
  llm: ILLMClient,
  slots: ResourceSlot[],
  options: GenerateSlotContentOptions,
): Promise<SlotContentResult[]> {
  if (slots.length === 0) return [];

  const concurrency = Math.max(1, options.concurrency ?? 4);

  // Group slots: one batch per adapter, one batch for all DB tables.
  const apiByAdapter = new Map<string, ResourceSlot[]>();
  const dbSlots: ResourceSlot[] = [];
  for (const slot of slots) {
    if (slot.surface === 'db') {
      dbSlots.push(slot);
    } else if (slot.adapterId) {
      const existing = apiByAdapter.get(slot.adapterId);
      if (existing) existing.push(slot);
      else apiByAdapter.set(slot.adapterId, [slot]);
    }
  }

  type Task = () => Promise<SlotContentResult[]>;
  const tasks: Task[] = [];
  if (dbSlots.length > 0) {
    tasks.push(() => generateDbBatch(llm, dbSlots, options));
  }
  for (const [adapterId, adapterSlots] of apiByAdapter) {
    tasks.push(() => generateAdapterBatch(llm, adapterId, adapterSlots, options));
  }

  logger.step(
    `Content generation: ${tasks.length} batch${tasks.length === 1 ? '' : 'es'} ` +
      `covering ${slots.length} slot${slots.length === 1 ? '' : 's'} ` +
      `(${dbSlots.length} DB, ${slots.length - dbSlots.length} API across ${apiByAdapter.size} adapter${apiByAdapter.size === 1 ? '' : 's'})`,
  );

  const batchResults: SlotContentResult[][] = new Array(tasks.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const myIndex = cursor++;
      if (myIndex >= tasks.length) return;
      batchResults[myIndex] = await tasks[myIndex]!();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker);
  await Promise.all(workers);

  return batchResults.flat();
}

// ---------------------------------------------------------------------------
// V2.5 — Batched generation (one LLM call per adapter, one for all DB)
// ---------------------------------------------------------------------------

async function generateAdapterBatch(
  llm: ILLMClient,
  adapterId: string,
  adapterSlots: ResourceSlot[],
  options: GenerateSlotContentOptions,
): Promise<SlotContentResult[]> {
  if (adapterSlots.length === 0) return [];

  // Singleton fallback: a single slot in this adapter — go through the
  // existing per-slot path (cheaper prompt, simpler schema).
  if (adapterSlots.length === 1) {
    const result = await generateOneSlot(llm, adapterSlots[0]!, options);
    return [result];
  }

  const slot0 = adapterSlots[0]!;
  if (!slot0.apiPlatform || !options.resourceSpecs) {
    throw new BlueprintGenerationError(
      `Adapter batch "${adapterId}" missing platform/spec context`,
      'Internal invariant violation — batched content generation needs resourceSpecs.',
    );
  }
  const specsForAdapter = options.resourceSpecs[adapterId];
  if (!specsForAdapter) {
    throw new BlueprintGenerationError(
      `Adapter batch "${adapterId}" has no resourceSpecs entry`,
      'Add a generated/resource-specs.ts to that adapter.',
    );
  }

  const batchEntries: BatchSlotEntry[] = adapterSlots.map((slot) => ({
    key: slot.resourceType!,
    slotName: slot.name,
    apiResource: slot.apiResource,
    apiPlatform: slot.apiPlatform,
    claims: slot.claims.map(claimToPromptClaim),
    identityContractEntries: collectIdentityContract({
      schemaMapping: options.schemaMapping,
      personaIndex: options.personaIndex,
      promptContexts: options.promptContexts,
      resourceSpecs: options.resourceSpecs,
      filterAdapters: [adapterId],
    }).filter((e) => e.adapterId === adapterId && e.apiResource === slot.resourceType),
    defaultCountHint: slot.suggestedCount,
  }));

  const { system, user } = buildAdapterBatchPrompt({
    persona: options.persona,
    domain: options.domain,
    adapterId,
    apiPlatform: slot0.apiPlatform,
    slots: batchEntries,
    anchors: options.anchors,
    currentDate: options.currentDate,
    volume: options.volume,
    personaIndex: options.personaIndex,
    totalPersonas: options.totalPersonas,
  });

  const label = `content:adapter:${adapterId}:${options.persona.name}`;
  let output: AdapterBatchOutput;
  try {
    const result = await llm.generateObject({
      schema: AdapterBatchOutputSchema,
      schemaName: 'AdapterBatchContent',
      schemaDescription: `Archetypes for adapter "${adapterId}" — keyed by resource name (${adapterSlots
        .map((s) => s.resourceType)
        .join(', ')})`,
      system,
      prompt: user,
      label,
      category: 'generation',
      temperature: options.temperature,
      maxRetries: options.maxRetries,
    });
    output = result.object;
  } catch (error) {
    throw wrapBatchError(`adapter:${adapterId}`, error);
  }

  // Demux per-resource and assemble.
  const results: SlotContentResult[] = [];
  for (const slot of adapterSlots) {
    const resourceOutput = output.resources?.[slot.resourceType!];
    if (!resourceOutput) {
      logger.warn(
        `Adapter batch [${adapterId}] LLM output missing key "${slot.resourceType}". ` +
          `Filling with an empty archetype set; the auditor will catch any resulting drift.`,
      );
    }

    const archetypes = (resourceOutput?.archetypes ?? []).map((a) => ({
      label: a.label,
      weight: 1,
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
    })) as ArchetypeDistribution[];

    const singleResourceDistribution: DistributionOutput = {
      [slot.resourceType!]: {
        count: slot.suggestedCount,
        archetypes,
      },
    };
    const assembledForAdapter = assembleResourceArchetypes(
      specsForAdapter,
      singleResourceDistribution,
      { personaIndex: options.personaIndex },
    );
    const config = assembledForAdapter[slot.resourceType!];
    if (!config) {
      throw new BlueprintGenerationError(
        `Assembler returned no config for API slot "${slot.name}" in batch ${adapterId}`,
        'Internal invariant violation — the slot resourceType did not match any spec key.',
      );
    }
    normaliseWeights(config.archetypes);
    results.push({ slot, config });
  }

  logger.debug(
    `Content [${label}]: ${results.length} resource${results.length === 1 ? '' : 's'} assembled from one LLM call`,
  );

  return results;
}

async function generateDbBatch(
  llm: ILLMClient,
  dbSlots: ResourceSlot[],
  options: GenerateSlotContentOptions,
): Promise<SlotContentResult[]> {
  if (dbSlots.length === 0) return [];
  if (dbSlots.length === 1) {
    const result = await generateOneSlot(llm, dbSlots[0]!, options);
    return [result];
  }

  const batchEntries: BatchSlotEntry[] = dbSlots.map((slot) => ({
    key: slot.name,
    slotName: slot.name,
    dbTable: slot.dbTable,
    claims: slot.claims.map(claimToPromptClaim),
    identityContractEntries: collectIdentityContract({
      schemaMapping: options.schemaMapping,
      personaIndex: options.personaIndex,
      promptContexts: options.promptContexts,
      resourceSpecs: options.resourceSpecs,
    }).filter((e) => e.dbTable === slot.name),
    defaultCountHint: slot.suggestedCount,
    dbOnlyBridge: slot.dbOnlyBridge,
  }));

  const { system, user } = buildDbBatchPrompt({
    persona: options.persona,
    domain: options.domain,
    slots: batchEntries,
    anchors: options.anchors,
    currentDate: options.currentDate,
    volume: options.volume,
    personaIndex: options.personaIndex,
    totalPersonas: options.totalPersonas,
  });

  const label = `content:db-batch:${options.persona.name}`;
  let output: DbBatchOutput;
  try {
    const result = await llm.generateObject({
      schema: DbBatchOutputSchema,
      schemaName: 'DbBatchContent',
      schemaDescription: `Archetypes for DB tables ${dbSlots.map((s) => s.name).join(', ')}`,
      system,
      prompt: user,
      label,
      category: 'generation',
      temperature: options.temperature,
      maxRetries: options.maxRetries,
    });
    output = result.object;
  } catch (error) {
    throw wrapBatchError('db-batch', error);
  }

  const results: SlotContentResult[] = [];
  for (const slot of dbSlots) {
    const tableOutput = output.tables?.[slot.name];
    if (!tableOutput) {
      logger.warn(
        `DB batch LLM output missing key "${slot.name}". Filling empty; auditor will report.`,
      );
    }

    const archetypes = (tableOutput?.archetypes ?? []).map<EntityArchetype>((a) => ({
      label: a.label,
      weight: 1,
      fields: a.fields ?? {},
      vary: (a.vary ?? {}) as Record<string, FieldVariation>,
      ...(a.cites && a.cites.length > 0 ? { cites: a.cites } : {}),
      ...(a.anchor ? { anchor: a.anchor } : {}),
    }));

    normaliseWeights(archetypes);

    const config: EntityArchetypeConfig = {
      count: slot.suggestedCount,
      archetypes,
    };

    results.push({ slot, config });
  }

  logger.debug(
    `Content [${label}]: ${results.length} table${results.length === 1 ? '' : 's'} assembled from one LLM call`,
  );

  return results;
}

function wrapBatchError(label: string, error: unknown): BlueprintGenerationError {
  if (error instanceof BlueprintGenerationError) return error;
  return new BlueprintGenerationError(
    `Batched content generation failed for ${label}`,
    'The batch couldn\'t be parsed against the expected schema. Inspect the LLM logs ' +
      'for the labelled call and ensure every requested resource key was returned.',
    error instanceof Error ? error : undefined,
  );
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
