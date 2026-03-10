import { createHash } from 'node:crypto';
import type { Blueprint, SchemaModel, PromptContext } from '../types/index.js';
import type { LLMClient } from '../llm/client.js';
import type { CostTracker } from '../llm/cost-tracker.js';
import { BlueprintCache } from './blueprint-cache.js';
import {
  BlueprintLLMOutputSchema,
  BlueprintLLMOutputWithApisSchema,
  AdapterBatchOutputSchema,
  type BlueprintLLMOutput,
  type AdapterBatchOutput,
} from './blueprint-zod.js';
import { buildPrompt, buildAdapterBatchPrompt, type Phase1Summary } from './prompts.js';
import { BlueprintGenerationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerateOptions {
  /** Skip reading from the cache even if a cached version exists. */
  force?: boolean;
  /** LLM temperature override. */
  temperature?: number;
  /** Maximum retries for the LLM call. */
  maxRetries?: number;
  /** 1-based index of this persona in the generation batch. */
  personaIndex?: number;
  /** Total number of personas being generated. */
  totalPersonas?: number;
  /** Volume string from config (e.g. "6 months") — passed to prompt for date range. */
  volume?: string;
  /** Number of API adapters per LLM batch call. Defaults to 2. */
  adapterBatchSize?: number;
  /** Max concurrent LLM calls during Phase 2 batched generation. Defaults to 4. */
  adapterBatchConcurrency?: number;
  /**
   * Platform names to include as a hint in the prompt. Used in Phase 1 of
   * batched generation so the LLM generates correct billing_platform and
   * external_id values in DB entities without generating full API data.
   */
  apiPlatformNames?: string[];
}

export interface PersonaInput {
  name: string;
  description: string;
}

// ---------------------------------------------------------------------------
// BlueprintEngine
// ---------------------------------------------------------------------------

/**
 * Orchestrates the full blueprint lifecycle:
 *   cache-key computation  ->  cache check  ->  LLM generation  ->
 *   Zod validation  ->  metadata assembly  ->  cache write.
 */
export class BlueprintEngine {
  private readonly llmClient: LLMClient;
  private readonly cache: BlueprintCache;
  private readonly costTracker: CostTracker;

  constructor(
    llmClient: LLMClient,
    cache: BlueprintCache,
    costTracker: CostTracker,
  ) {
    this.llmClient = llmClient;
    this.cache = cache;
    this.costTracker = costTracker;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Generate (or retrieve from cache) a Blueprint for the given inputs.
   */
  async generate(
    schema: SchemaModel,
    persona: PersonaInput,
    domain: string,
    options: GenerateOptions = {},
    apis?: Record<string, { adapter?: string; config?: Record<string, unknown> }>,
    promptContexts?: Record<string, PromptContext>,
  ): Promise<Blueprint> {
    const cacheKey = this.computeCacheKey(schema, persona, domain, apis);

    // ------------------------------------------------------------------
    // 1. Cache check
    // ------------------------------------------------------------------
    if (!options.force) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        logger.step(
          `Blueprint for "${persona.name}" loaded from cache (${cacheKey.slice(0, 8)}...)`,
        );
        return cached;
      }
    }

    // ------------------------------------------------------------------
    // 2. Build prompt & call LLM
    // ------------------------------------------------------------------
    logger.step(
      `Generating blueprint for "${persona.name}" in domain "${domain}"...`,
    );

    const { system, user } = buildPrompt({
      schema,
      persona,
      domain,
      apis,
      promptContexts,
      currentDate: new Date().toISOString().split('T')[0],
      volume: options.volume,
      personaIndex: options.personaIndex,
      totalPersonas: options.totalPersonas,
      apiPlatformNames: options.apiPlatformNames,
    });

    // Use the API-aware schema when APIs are configured — this makes
    // apiEntityArchetypes required in the tool definition, forcing the LLM
    // to generate API entity data instead of silently skipping optional fields.
    const hasApis = apis && Object.keys(apis).length > 0;
    const llmSchema = hasApis ? BlueprintLLMOutputWithApisSchema : BlueprintLLMOutputSchema;

    let llmOutput: BlueprintLLMOutput;
    try {
      const result = await this.llmClient.generateObject({
        schema: llmSchema,
        schemaName: 'Blueprint',
        schemaDescription:
          'A persona-driven data blueprint containing entity seeds and data patterns',
        system,
        prompt: user,
        label: `blueprint:${persona.name}`,
        category: 'generation',
        temperature: options.temperature,
        maxRetries: options.maxRetries,
      });

      llmOutput = result.object;
    } catch (error) {
      if (error instanceof BlueprintGenerationError) {
        throw error;
      }
      throw new BlueprintGenerationError(
        `Failed to generate blueprint for persona "${persona.name}"`,
        'Check your LLM configuration, API key, and network connectivity',
        error instanceof Error ? error : undefined,
      );
    }

    // ------------------------------------------------------------------
    // 3. Normalize LLM output & assemble the full Blueprint
    // ------------------------------------------------------------------
    normalizeBlueprintData(llmOutput.data);
    validateBlueprintCoverage(llmOutput.data, schema);

    const now = new Date().toISOString();
    const blueprint: Blueprint = {
      version: '1.0',
      personaId: llmOutput.personaId,
      domain: llmOutput.domain,
      generatedAt: now,
      generatedBy: `mimic/${this.llmClient.getModelId()}`,
      checksum: '', // filled below

      persona: llmOutput.persona,
      data: llmOutput.data,
    };

    blueprint.checksum = computeChecksum(blueprint);

    // ------------------------------------------------------------------
    // 4. Write to cache
    // ------------------------------------------------------------------
    try {
      await this.cache.set(cacheKey, blueprint);
      logger.success(
        `Blueprint for "${persona.name}" cached (${cacheKey.slice(0, 8)}...)`,
      );
    } catch (error) {
      // Cache write failures are non-fatal — log and continue
      logger.warn(
        `Failed to cache blueprint: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return blueprint;
  }

  // -----------------------------------------------------------------------
  // Batched generation (many adapters)
  // -----------------------------------------------------------------------

  /**
   * Generate a Blueprint using batched API adapter generation.
   *
   * When the number of configured API adapters exceeds `batchSize`, the
   * generation is split into two phases to keep the LLM focused:
   *
   * - **Phase 1**: Generate persona profile, DB entities, patterns, and facts
   *   in a single LLM call with no API adapter context.
   * - **Phase 2**: Generate API entity data in parallel batches of ~batchSize
   *   adapters each. Each batch is an independent LLM call that receives only
   *   its subset of adapter platform schemas.
   *
   * The results are merged into a single Blueprint. When adapter count is
   * within the batch size, falls back to single-call generation.
   */
  async generateBatched(
    schema: SchemaModel,
    persona: PersonaInput,
    domain: string,
    options: GenerateOptions = {},
    apis?: Record<string, { adapter?: string; config?: Record<string, unknown> }>,
    promptContexts?: Record<string, PromptContext>,
  ): Promise<Blueprint> {
    const batchSize = options.adapterBatchSize ?? 5;
    const adapterKeys = apis ? Object.keys(apis) : [];

    // ── Fast path: few adapters → single-call generation ─────────────
    if (adapterKeys.length <= batchSize) {
      return this.generate(schema, persona, domain, options, apis, promptContexts);
    }

    // ── Check cache first (same key as single-call) ──────────────────
    const cacheKey = this.computeCacheKey(schema, persona, domain, apis);
    if (!options.force) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        logger.step(
          `Blueprint for "${persona.name}" loaded from cache (${cacheKey.slice(0, 8)}...)`,
        );
        return cached;
      }
    }

    const batchCount = Math.ceil(adapterKeys.length / batchSize);
    const maxConcurrent = Math.min(options.adapterBatchConcurrency ?? 4, batchCount);
    logger.step(
      `Batched generation: ${adapterKeys.length} adapters → ` +
        `Phase 1 (persona + DB) + Phase 2 (${batchCount} batch${batchCount > 1 ? 'es' : ''}, ` +
        `${batchSize}/batch, ${maxConcurrent} concurrent)`,
    );

    // ------------------------------------------------------------------
    // Phase 1: Generate persona + DB data (with platform awareness)
    // ------------------------------------------------------------------
    const phase1Blueprint = await this.generate(
      schema,
      persona,
      domain,
      { ...options, force: true, apiPlatformNames: adapterKeys },
      undefined, // no full API schemas — Phase 2 handles that
      promptContexts, // passed so formatPlatformHint can read adapter idPrefix values
    );

    // ------------------------------------------------------------------
    // Extract Phase 1 summary for Phase 2 cross-surface consistency
    // ------------------------------------------------------------------
    const phase1Summary = extractPhase1Summary(phase1Blueprint);

    // ------------------------------------------------------------------
    // Phase 2: Generate API data in parallel batches
    // ------------------------------------------------------------------
    const batches: Record<
      string,
      { adapter?: string; config?: Record<string, unknown> }
    >[] = [];

    for (let i = 0; i < adapterKeys.length; i += batchSize) {
      const batchKeys = adapterKeys.slice(i, i + batchSize);
      const batch: Record<
        string,
        { adapter?: string; config?: Record<string, unknown> }
      > = {};
      for (const key of batchKeys) {
        batch[key] = apis![key]!;
      }
      batches.push(batch);
    }

    const currentDate = new Date().toISOString().split('T')[0];

    const concurrency = options.adapterBatchConcurrency ?? 4;
    const batchResults = await runWithConcurrency(
      batches,
      concurrency,
      async (batchApis, batchIdx) => {
        const batchAdapterNames = Object.keys(batchApis);
        logger.step(
          `API batch ${batchIdx + 1}/${batchCount}: ${batchAdapterNames.join(', ')}`,
        );

        // Build batch-specific prompt contexts
        const batchContexts: Record<string, PromptContext> = {};
        if (promptContexts) {
          for (const key of batchAdapterNames) {
            const adapterId =
              (batchApis[key] as { adapter?: string }).adapter ?? key;
            if (promptContexts[adapterId]) {
              batchContexts[adapterId] = promptContexts[adapterId]!;
            }
          }
        }

        const { system, user } = buildAdapterBatchPrompt({
          persona: { name: persona.name, description: persona.description },
          domain,
          apis: batchApis,
          promptContexts:
            Object.keys(batchContexts).length > 0 ? batchContexts : undefined,
          currentDate,
          volume: options.volume,
          personaIndex: options.personaIndex,
          totalPersonas: options.totalPersonas,
          phase1Summary,
        });

        try {
          const result = await this.llmClient.generateObject({
            schema: AdapterBatchOutputSchema,
            schemaName: 'AdapterBatch',
            schemaDescription:
              'API entity data for a subset of adapters',
            system,
            prompt: user,
            label: `adapter-batch:${persona.name}:${batchIdx + 1}`,
            category: 'generation',
            temperature: options.temperature,
            maxRetries: options.maxRetries,
          });
          return result.object as AdapterBatchOutput;
        } catch (error) {
          logger.warn(
            `API batch ${batchIdx + 1} failed: ${error instanceof Error ? error.message : String(error)}. ` +
              `Adapters in this batch will have no pre-generated data.`,
          );
          return null;
        }
      },
    );

    // ------------------------------------------------------------------
    // Phase 3: Merge batch results into the Phase 1 blueprint
    // ------------------------------------------------------------------
    const mergedData = { ...phase1Blueprint.data };

    for (const batchResult of batchResults) {
      if (!batchResult) continue;

      if (batchResult.apiEntityArchetypes) {
        mergedData.apiEntityArchetypes = {
          ...(mergedData.apiEntityArchetypes ?? {}),
          ...batchResult.apiEntityArchetypes,
        };
      }

      if (batchResult.apiEntities) {
        mergedData.apiEntities = {
          ...(mergedData.apiEntities ?? {}),
          ...batchResult.apiEntities,
        };
      }
    }

    // Normalize merged data before caching
    normalizeBlueprintData(mergedData);

    const mergedBlueprint: Blueprint = {
      ...phase1Blueprint,
      data: mergedData,
      checksum: '', // recomputed below
    };
    mergedBlueprint.checksum = computeChecksum(mergedBlueprint);

    // Cache the merged result
    try {
      await this.cache.set(cacheKey, mergedBlueprint);
      logger.success(
        `Batched blueprint for "${persona.name}" cached (${cacheKey.slice(0, 8)}...)`,
      );
    } catch (error) {
      logger.warn(
        `Failed to cache blueprint: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return mergedBlueprint;
  }

  /**
   * Return the CostTracker so callers can inspect generation costs.
   */
  getCostTracker(): CostTracker {
    return this.costTracker;
  }

  // -----------------------------------------------------------------------
  // Cache key computation
  // -----------------------------------------------------------------------

  /**
   * Deterministic SHA-256 hash of the generation inputs.
   *
   * Any change to the schema, persona description, or domain will
   * invalidate the cache.
   */
  private computeCacheKey(
    schema: SchemaModel,
    persona: PersonaInput,
    domain: string,
    apis?: Record<string, unknown>,
  ): string {
    const payload = JSON.stringify({
      schema: {
        tables: schema.tables.map((t) => ({
          name: t.name,
          columns: t.columns.map((c) => ({
            name: c.name,
            type: c.type,
            pgType: c.pgType,
          })),
          foreignKeys: t.foreignKeys,
        })),
        insertionOrder: schema.insertionOrder,
      },
      persona: {
        name: persona.name,
        description: persona.description,
      },
      domain,
      apis: apis ? Object.keys(apis).sort() : [],
    });

    return createHash('sha256').update(payload).digest('hex');
  }
}

// ---------------------------------------------------------------------------
// Blueprint normalization & validation
// ---------------------------------------------------------------------------

/**
 * Known FieldVariation types — used to distinguish variation specs from
 * entity data that the LLM accidentally nested inside `fields`.
 */
const KNOWN_VARIATION_TYPES = new Set([
  'pick', 'range', 'decimal_range', 'sequence', 'uuid', 'derived',
  'timestamp', 'date', 'firstName', 'lastName', 'fullName', 'email', 'phone', 'companyName',
]);

/**
 * Normalize LLM-generated blueprint data to fix common structural defects
 * before the data enters the cache or the expander.
 *
 * Fixes:
 * - `arch.fields = { fields: { ... } }` → flatten the nested `fields` key
 * - Static API entities shaped as `{ id, fields: {...} }` → merge `fields` up
 */
function normalizeBlueprintData(data: Blueprint['data']): void {
  // 1. Normalize DB archetype fields
  if (data.entityArchetypes) {
    for (const config of Object.values(data.entityArchetypes)) {
      for (const arch of config.archetypes) {
        flattenNestedFields(arch.fields);
      }
    }
  }

  // 2. Normalize API archetype fields
  if (data.apiEntityArchetypes) {
    for (const resources of Object.values(data.apiEntityArchetypes)) {
      for (const config of Object.values(resources)) {
        for (const arch of config.archetypes) {
          flattenNestedFields(arch.fields);
        }
      }
    }
  }

  // 3. Normalize static API entities
  if (data.apiEntities) {
    for (const resources of Object.values(data.apiEntities)) {
      for (const entities of Object.values(resources)) {
        for (const entity of entities) {
          flattenNestedFields(entity);
        }
      }
    }
  }

  // 4. Normalize static DB entities
  for (const entities of Object.values(data.entities)) {
    for (const entity of entities) {
      flattenNestedFields(entity);
    }
  }
}

/**
 * If `obj.fields` is a plain object (not a FieldVariation spec and not an
 * array), merge its entries into `obj` and delete the nested key.
 * Values in `obj` take precedence unless they are empty/zero/null.
 */
function flattenNestedFields(obj: Record<string, unknown>): void {
  if (
    !('fields' in obj) ||
    obj.fields === null ||
    typeof obj.fields !== 'object' ||
    Array.isArray(obj.fields)
  ) {
    return;
  }

  const nested = obj.fields as Record<string, unknown>;

  // Don't flatten if it looks like a FieldVariation spec
  if (
    'type' in nested &&
    typeof nested.type === 'string' &&
    KNOWN_VARIATION_TYPES.has(nested.type)
  ) {
    return;
  }

  delete obj.fields;
  for (const [k, v] of Object.entries(nested)) {
    if (obj[k] === undefined || obj[k] === null || obj[k] === 0 || obj[k] === '') {
      obj[k] = v;
    }
  }
}

/**
 * Validate that every schema table is covered by at least one data source
 * (static entities, archetypes, or patterns). Logs warnings for uncovered tables.
 */
function validateBlueprintCoverage(
  data: Blueprint['data'],
  schema: SchemaModel,
): void {
  if (schema.tables.length === 0) return;

  const patternTargets = new Set(data.patterns.map(p => p.targetTable));

  for (const table of schema.tables) {
    const staticCount = data.entities[table.name]?.length ?? 0;
    const archetypeCount = data.entityArchetypes?.[table.name]?.archetypes?.length ?? 0;
    const hasPattern = patternTargets.has(table.name);

    if (staticCount === 0 && archetypeCount === 0 && !hasPattern) {
      // Check if any required non-FK columns exist — skip pure junction tables
      const requiredCols = table.columns.filter(
        c => !c.isNullable && !c.hasDefault && !c.isAutoIncrement && !c.isGenerated,
      );
      const fkColNames = new Set(table.foreignKeys.flatMap(fk => fk.columns));
      const nonFkRequired = requiredCols.filter(c => !fkColNames.has(c.name));

      if (nonFkRequired.length > 0) {
        logger.warn(
          `Blueprint coverage gap: table "${table.name}" has no entities, archetypes, or patterns. ` +
          `It has ${nonFkRequired.length} required non-FK column(s) that need data.`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run async tasks with a concurrency limit. Like Promise.all but caps how
 * many tasks execute simultaneously to avoid provider rate limits.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIdx = 0;

  async function worker(): Promise<void> {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await fn(items[idx]!, idx);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * Extract a summary of Phase 1 generation results (DB entities, ID prefixes)
 * to pass to Phase 2 batch prompts for cross-surface ID consistency.
 */
function extractPhase1Summary(blueprint: Blueprint): Phase1Summary {
  const tables: Phase1Summary['tables'] = [];
  const idPrefixes: Record<string, string> = {};
  const platformPrefixes: Record<string, { column: string; prefix: string }[]> = {};

  // Build a map: external_id prefix → billing_platform from static entities.
  // Scan all entities in "customers" (or any table with billing_platform + external_id)
  // to associate each prefix with its platform.
  const prefixToPlatform = new Map<string, string>();
  for (const [, entities] of Object.entries(blueprint.data.entities)) {
    if (!entities || entities.length === 0) continue;
    for (const entity of entities) {
      const platform = entity.billing_platform as string | undefined;
      const extId = entity.external_id as string | undefined;
      if (platform && extId && typeof platform === 'string' && typeof extId === 'string') {
        const seqMatch = extId.match(/^([a-z_]+p\d+_)\d+$/);
        if (seqMatch) {
          prefixToPlatform.set(seqMatch[1]!, platform);
        }
      }
    }
  }

  // Also scan archetypes for billing_platform + external_id patterns
  if (blueprint.data.entityArchetypes) {
    for (const [, config] of Object.entries(blueprint.data.entityArchetypes)) {
      for (const archetype of config.archetypes) {
        const platform = archetype.fields.billing_platform as string | undefined;
        if (!platform) continue;

        // Check vary for external_id sequence prefix
        const extIdVary = archetype.vary.external_id;
        if (extIdVary?.type === 'sequence' && extIdVary.prefix) {
          prefixToPlatform.set(extIdVary.prefix, platform);
        }

        // Check static fields for external_id
        const extId = archetype.fields.external_id as string | undefined;
        if (extId && typeof extId === 'string') {
          const seqMatch = extId.match(/^([a-z_]+p\d+_)\d+$/);
          if (seqMatch) {
            prefixToPlatform.set(seqMatch[1]!, platform);
          }
        }
      }
    }
  }

  // Build platformPrefixes from the map
  for (const [prefix, platform] of prefixToPlatform) {
    if (!platformPrefixes[platform]) platformPrefixes[platform] = [];
    const existing = platformPrefixes[platform]!.find(e => e.prefix === prefix);
    if (!existing) {
      platformPrefixes[platform]!.push({ column: 'external_id', prefix });
    }
  }

  // Extract table summaries from static entities
  for (const [tableName, entities] of Object.entries(blueprint.data.entities)) {
    if (!entities || entities.length === 0) continue;
    tables.push({ name: tableName, rowCount: entities.length });
  }

  // Extract from archetypes
  if (blueprint.data.entityArchetypes) {
    for (const [tableName, config] of Object.entries(blueprint.data.entityArchetypes)) {
      const existing = tables.find((t) => t.name === tableName);

      for (const archetype of config.archetypes) {
        for (const [col, variation] of Object.entries(archetype.vary)) {
          if (variation.type === 'sequence' && variation.prefix) {
            idPrefixes[`${tableName}.${col}`] = variation.prefix;
          }
        }
      }

      if (existing) {
        existing.rowCount = Math.max(existing.rowCount, config.count);
      } else {
        tables.push({ name: tableName, rowCount: config.count });
      }
    }
  }

  return { tables, idPrefixes, platformPrefixes };
}

/**
 * Compute a SHA-256 checksum of the blueprint's data content (excluding the
 * checksum field itself and volatile metadata).
 */
function computeChecksum(blueprint: Blueprint): string {
  const content = JSON.stringify({
    personaId: blueprint.personaId,
    domain: blueprint.domain,
    persona: blueprint.persona,
    data: blueprint.data,
  });
  return createHash('sha256').update(content).digest('hex');
}
