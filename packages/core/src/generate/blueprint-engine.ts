import { createHash } from 'node:crypto';
import type { Blueprint, SchemaModel, PromptContext, AdapterResourceSpecs, TableClassification } from '../types/index.js';
import type { ILLMClient } from '../llm/client.js';
import type { CostTracker } from '../llm/cost-tracker.js';
import { BlueprintCache } from './blueprint-cache.js';
import type { SchemaMapping } from '../types/blueprint.js';
import {
  BlueprintLLMOutputSchema,
  BlueprintLLMOutputWithApisSchema,
  DistributionOutputSchema,
  toDistributionOutput,
  type DistributionOutputRaw,
  type DistributionFact,
  createSchemaMappingOutputSchema,
  type BlueprintLLMOutput,
} from './blueprint-zod.js';
import {
  buildPrompt,
  buildSchemaMappingPrompt,
  buildDistributionPrompt,
  collectIdentityContract,
} from './prompts.js';
import {
  validatePhase1IdentityContract,
  validatePhase2IdentityContract,
  validateApiOnlyCap,
} from './validate-identity-contract.js';
import {
  injectPhase1IdentityContract,
  injectPhase2IdentityContract,
} from './inject-identity-contract.js';
import { assembleResourceArchetypes } from './resource-assembler.js';
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
  /**
   * Identity table names from table classification.
   * When provided, Phase 2 distribution prompts receive entity count
   * constraints derived from Phase 1 DB archetypes, ensuring API entity
   * counts match the coordinated DB identity table totals.
   */
  identityTableNames?: Set<string>;
  /**
   * Maximum allowed ratio of `apiOnly: true` archetype entities to matched
   * entities, per resource. Guards against the LLM marking too many entities
   * as orphans. Defaults to 0.3 (30%). Raise only when the persona genuinely
   * declares >30% asymmetry.
   */
  maxApiOnlyRatio?: number;
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
  private readonly llmClient: ILLMClient;
  private readonly cache: BlueprintCache;
  private readonly costTracker: CostTracker;

  constructor(
    llmClient: ILLMClient,
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
    schemaMapping?: SchemaMapping,
    resourceSpecs?: Record<string, AdapterResourceSpecs>,
    tableClassifications?: TableClassification[],
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
      schemaMapping,
      resourceSpecs,
      tableClassifications,
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
    if (tableClassifications && tableClassifications.length > 0) {
      validateMirrorTargetArchetypes(llmOutput.data, tableClassifications);
    }

    // Identity contract: deterministically inject the contracted prefix into
    // every archetype's vary[<field>], then validate as a defensive net. The
    // injection makes the LLM's choice of vary type irrelevant for ID fields
    // it has no useful judgment over — see inject-identity-contract.ts.
    //
    // When apiEntityArchetypes is empty (Phase-1-only call from generateBatched)
    // the Phase 2 inject/validate is a no-op; the contract gets enforced again
    // on the merged blueprint inside generateBatched().
    const contract = collectIdentityContract({
      schemaMapping,
      personaIndex: options.personaIndex,
      promptContexts,
      resourceSpecs,
    });
    if (contract.length > 0) {
      injectPhase1IdentityContract(llmOutput.data, contract);
      injectPhase2IdentityContract(llmOutput.data, contract);
      validatePhase1IdentityContract(llmOutput.data, contract);
      validatePhase2IdentityContract(llmOutput.data, contract);
    }

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
    resourceSpecs?: Record<string, AdapterResourceSpecs>,
    tableClassifications?: TableClassification[],
    schemaMapping?: SchemaMapping,
  ): Promise<Blueprint> {
    const batchSize = options.adapterBatchSize ?? 5;
    const adapterKeys = apis ? Object.keys(apis) : [];

    // ── Fast path: few adapters → single-call generation ─────────────
    if (adapterKeys.length <= batchSize && !resourceSpecs) {
      return this.generate(schema, persona, domain, options, apis, promptContexts, schemaMapping, resourceSpecs, tableClassifications);
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
        `${batchSize}/batch, ${maxConcurrent} concurrent)` +
        (resourceSpecs ? ' [ResourceSpec path]' : ''),
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
      schemaMapping, // drives the IDENTITY CONTRACT block on the DB side
      resourceSpecs, // per-resource idPrefix lookup for the contract
      tableClassifications, // drives the TABLE CLASSIFICATION block — keeps Phase 1 from emitting paid-linked rows on mirror-target tables
    );

    // ------------------------------------------------------------------
    // Extract identity entity counts per adapter from Phase 1 archetypes.
    // This coordinates API entity counts with DB identity table totals.
    // ------------------------------------------------------------------
    const identityEntityCounts = extractIdentityEntityCounts(
      phase1Blueprint, options.identityTableNames, tableClassifications,
    );

    if (Object.keys(identityEntityCounts).length > 0) {
      logger.debug(
        `Identity entity count constraints: ${JSON.stringify(identityEntityCounts)}`,
      );
    }

    // ==================================================================
    // ResourceSpec path: use distribution prompt + deterministic assembly
    // ==================================================================
    // ResourceSpecs are required. Every adapter must export an
    // AdapterResourceSpecs (see packages/adapters/adapter-*). If a custom
    // adapter is missing one, surface that loudly rather than silently
    // generating empty data.
    if (!resourceSpecs || Object.keys(resourceSpecs).length === 0) {
      throw new Error(
        `Cannot generate API data: no resourceSpecs provided. ` +
        `Every adapter must export an AdapterResourceSpecs (see packages/adapters/adapter-stripe for an example).`,
      );
    }

    const specAdapterIds = Object.keys(resourceSpecs);
    const missingSpecs = adapterKeys.filter(k => {
      const adapterId = (apis![k] as { adapter?: string }).adapter ?? k;
      return !specAdapterIds.includes(adapterId);
    });
    if (missingSpecs.length > 0) {
      throw new Error(
        `Adapters missing resourceSpecs: ${missingSpecs.join(', ')}. ` +
        `Add a generated/resource-specs.ts to each adapter's source tree.`,
      );
    }

    const mergedData = { ...phase1Blueprint.data };
    const collectedFacts: DistributionFact[] = [];

    for (const adapterId of specAdapterIds) {
      const specs = resourceSpecs[adapterId]!;

      logger.step(`ResourceSpec distribution: ${adapterId}`);

      const { system, user } = buildDistributionPrompt({
        persona: { name: persona.name, description: persona.description },
        domain,
        resourceSpecs: { [adapterId]: specs },
        currentDate: new Date().toISOString().split('T')[0],
        volume: options.volume,
        personaIndex: options.personaIndex,
        totalPersonas: options.totalPersonas,
        identityEntityCounts: identityEntityCounts[adapterId],
        schemaMapping,
        promptContexts,
        // Forward Phase 1's declared anchors so the Phase 2 LLM has the
        // actual list of ids to bind. Without this the prompt lectures
        // the model about binding anchors with no referent.
        anchors: phase1Blueprint.data.anchors,
      });

      const result = await this.llmClient.generateObject({
        schema: DistributionOutputSchema,
        schemaName: 'DistributionOutput',
        schemaDescription: `Distribution plan for ${adapterId} resources`,
        system,
        prompt: user,
        label: `distribution:${persona.name}:${adapterId}`,
        category: 'generation',
        temperature: options.temperature,
        maxRetries: options.maxRetries,
      });

      const { distributions, facts } = toDistributionOutput(result.object as DistributionOutputRaw);
      const assembled = assembleResourceArchetypes(specs, distributions, {
        personaIndex: options.personaIndex,
      });

      mergedData.apiEntityArchetypes = {
        ...(mergedData.apiEntityArchetypes ?? {}),
        [adapterId]: assembled,
      };

      if (facts.length > 0) {
        collectedFacts.push(...facts);
        logger.debug(`Collected ${facts.length} distribution facts for ${adapterId}`);
      }

      logger.success(
        `Assembled ${Object.keys(assembled).length} resource types for ${adapterId}`,
      );
    }

    if (collectedFacts.length > 0) {
      const allFacts = [...(mergedData.facts ?? []), ...collectedFacts];
      mergedData.facts = allFacts;
      logger.debug(`Total facts in blueprint: ${allFacts.length}`);
    }

    normalizeBlueprintData(mergedData);

    // Inject + validate Phase 2 of the merged blueprint against the identity
    // contract. Phase 1 was injected/validated inside the inner generate().
    const contract = collectIdentityContract({
      schemaMapping,
      personaIndex: options.personaIndex,
      promptContexts,
      resourceSpecs,
    });
    if (contract.length > 0) {
      injectPhase2IdentityContract(mergedData, contract);
      validatePhase2IdentityContract(mergedData, contract);
    }

    // Soft-cap defense: if the LLM marked too many archetypes as apiOnly:true
    // (e.g. half the customer base as "orphans"), throw a clear error rather
    // than silently producing wildly asymmetric data.
    validateApiOnlyCap(mergedData, { maxApiOnlyRatio: options.maxApiOnlyRatio });

    // Anchor binding check: every entry in `data.anchors` must be referenced
    // by at least one archetype. Unbound anchors are silent persona-event
    // failures — the LLM declared "Klein's double-charge" but no archetype
    // emits the rows. Both DB and API archetypes are present here (Phase 1 +
    // Phase 2 merged), so this is the right point to verify.
    validateAnchorBindings(mergedData);

    const mergedBlueprint: Blueprint = {
      ...phase1Blueprint,
      data: mergedData,
      checksum: '',
    };
    mergedBlueprint.checksum = computeChecksum(mergedBlueprint);

    try {
      await this.cache.set(cacheKey, mergedBlueprint);
      logger.success(`Blueprint for "${persona.name}" cached (${cacheKey.slice(0, 8)}...)`);
    } catch (error) {
      logger.warn(`Failed to cache blueprint: ${error instanceof Error ? error.message : String(error)}`);
    }

    return mergedBlueprint;
  }

  // -----------------------------------------------------------------------
  // Schema mapping (DB↔API field correspondence)
  // -----------------------------------------------------------------------

  /**
   * Ask the LLM to map DB columns to API resource fields.
   *
   * This is a lightweight call that runs before generation. The result
   * tells the expander which DB tables are "bridge tables" whose rows
   * should be derived from API data rather than generated independently.
   */
  async generateSchemaMapping(
    schema: SchemaModel,
    adapterResources: Record<string, string[]>,
  ): Promise<SchemaMapping> {
    logger.step('Generating schema mapping (DB ↔ API)...');

    const adapterIds = Object.keys(adapterResources);
    if (adapterIds.length === 0) {
      logger.warn('No adapter resources provided — skipping schema mapping.');
      return { mappings: [], bridgeTables: [] };
    }

    const { system, user } = buildSchemaMappingPrompt({
      schema,
      adapterResources,
    });

    // Build a dynamic Zod schema that constrains adapterId to the actual
    // adapter IDs — prevents the LLM from using wildcards like "all"
    const schemaMappingSchema = createSchemaMappingOutputSchema(
      adapterIds as [string, ...string[]],
    );

    try {
      const result = await this.llmClient.generateObject({
        schema: schemaMappingSchema,
        schemaName: 'SchemaMapping',
        schemaDescription:
          'Mapping between DB table columns and API platform resource fields',
        system,
        prompt: user,
        label: 'schema-mapping',
        category: 'generation',
      });

      const mapping = result.object as SchemaMapping;
      logger.success(
        `Schema mapping: ${mapping.mappings.length} field mapping(s), ` +
          `${mapping.bridgeTables.length} bridge table(s): ${mapping.bridgeTables.join(', ') || '(none)'}`,
      );
      return mapping;
    } catch (error) {
      logger.warn(
        `Schema mapping failed: ${error instanceof Error ? error.message : String(error)}. ` +
          `Falling back to convention-based mapping.`,
      );
      // Return empty mapping — expander will use existing crossReference logic
      return { mappings: [], bridgeTables: [] };
    }
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
      // Bump when the blueprint schema gains/loses fields that the LLM is
      // expected to populate. Old cached blueprints lack the new fields and
      // would silently produce data that violates the new contract.
      // v2: added EntityArchetype.apiOnly + EntityArchetype.count for
      //     cross-platform asymmetry (Stripe-only orphans etc.).
      schemaVersion: 2,
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

/**
 * Repair Phase 1 archetypes that would double-count with the mirror flow.
 *
 * For tables classified as `external-mirrored`, the expander writes one DB
 * row per API entity on each source. An archetype on such a table whose
 * `fields.billing_platform` (or any cross-surface FK like `*_customer_id`)
 * is set to a non-null value would emit a parallel set of rows representing
 * the same customers — duplicating the mirror output.
 *
 * Rather than fail the run (the LLM tends to emit these archetypes even
 * with explicit prompt guidance — they're its default mental model), we
 * PRUNE the offending archetypes in-place and log a warning. The mirror
 * flow produces the linked rows from the corresponding API entities;
 * dropping the archetype removes the duplicates without losing information.
 *
 * Linkage-null archetypes (free-tier users, paid orphans, internal-only
 * segments) survive — those genuinely have no API counterpart.
 */
function validateMirrorTargetArchetypes(
  data: Blueprint['data'],
  classifications: TableClassification[],
): void {
  const mirrorTargets = new Set(
    classifications
      .filter((c) => c.role === 'external-mirrored' && c.sources && c.sources.length > 0)
      .map((c) => c.table),
  );
  if (mirrorTargets.size === 0) return;

  const linkageHint = (key: string): boolean =>
    key === 'billing_platform' ||
    key === 'external_id' ||
    /_customer_id$/.test(key) ||
    /_account_(id|code)$/.test(key) ||
    /_app_user_id$/.test(key);

  const dropped: Array<{ table: string; label: string; reason: string }> = [];

  for (const [tableName, config] of Object.entries(data.entityArchetypes ?? {})) {
    if (!mirrorTargets.has(tableName)) continue;
    const surviving: typeof config.archetypes = [];
    for (const archetype of config.archetypes ?? []) {
      const label = archetype.label ?? '(unlabelled)';
      const fields = (archetype.fields ?? {}) as Record<string, unknown>;

      // Reason 1: linkage field set to non-null → mirror will produce this row.
      let linkageOffense: string | undefined;
      for (const [k, v] of Object.entries(fields)) {
        if (!linkageHint(k)) continue;
        if (v === null || v === undefined || v === '') continue;
        linkageOffense = `${k}=${JSON.stringify(v)}`;
        break;
      }
      if (linkageOffense !== undefined) {
        dropped.push({ table: tableName, label, reason: `linkage ${linkageOffense} (mirror owns these rows)` });
        continue;
      }

      // Reason 2: weight-only archetype on a mirror-target table. The mirror
      // supplies the volume, so there is no capacity for `weight` to apportion;
      // weight×0 = 0 rows. The LLM must use explicit `count` for any standalone
      // bucket the persona names ("847 free-tier users" → count: 847).
      const countRaw = (archetype as { count?: unknown }).count;
      const weightRaw = (archetype as { weight?: unknown }).weight;
      const hasCount = typeof countRaw === 'number' && countRaw > 0;
      const hasWeight = typeof weightRaw === 'number' && weightRaw > 0;
      if (!hasCount && hasWeight) {
        dropped.push({
          table: tableName,
          label,
          reason: `weight-only (weight=${weightRaw}, count missing) — use explicit count on mirror-target tables`,
        });
        continue;
      }

      surviving.push(archetype);
    }
    config.archetypes = surviving;
  }

  if (dropped.length === 0) return;

  const summary = dropped
    .slice(0, 12)
    .map((o) => `  - ${o.table} / "${o.label}": ${o.reason}`)
    .join('\n');
  const more = dropped.length > 12 ? `\n  ... +${dropped.length - 12} more` : '';

  logger.warn(
    `Dropped ${dropped.length} Phase 1 archetype(s) on mirror-target table(s):\n${summary}${more}`,
  );
}

/**
 * Validate that every declared anchor in `data.anchors` is bound by at least
 * one archetype. An anchor that no archetype references is decorative — it
 * names a persona event that nothing emits, which silently breaks the event
 * (Klein's double-charge rows never appear, Larkspur's drift sub never lands,
 * etc).
 *
 * Throws BlueprintGenerationError with a list of unbound anchors. The user
 * sees the names of the events the LLM forgot to materialize and can re-run
 * generation with the fix in their hand.
 */
function validateAnchorBindings(data: Blueprint['data']): void {
  const anchors = data.anchors ?? [];
  if (anchors.length === 0) return;

  // Collect every anchor id referenced by an archetype on either surface.
  const boundIds = new Set<string>();
  const dbBound = new Set<string>();
  const apiBound = new Set<string>();

  for (const config of Object.values(data.entityArchetypes ?? {})) {
    for (const a of config.archetypes) {
      if (typeof a.anchor === 'string' && a.anchor.length > 0) {
        boundIds.add(a.anchor);
        dbBound.add(a.anchor);
      }
    }
  }
  for (const adapter of Object.values(data.apiEntityArchetypes ?? {})) {
    for (const config of Object.values(adapter)) {
      for (const a of config.archetypes) {
        if (typeof a.anchor === 'string' && a.anchor.length > 0) {
          boundIds.add(a.anchor);
          apiBound.add(a.anchor);
        }
      }
    }
  }

  const unbound = anchors.map((a) => a.id).filter((id) => !boundIds.has(id));
  if (unbound.length > 0) {
    throw new BlueprintGenerationError(
      `Blueprint declares anchor(s) [${unbound.join(', ')}] but no archetype binds them. ` +
        `Each anchor in data.anchors must be referenced by at least one archetype's "anchor" field ` +
        `on either the DB side (entityArchetypes) or the API side (apiEntityArchetypes), ` +
        `otherwise the persona event the anchor names produces zero rows.`,
      'Either remove the unbound anchor from data.anchors, or add an archetype with `anchor: <id>` ' +
        '(plus `count` for the row count) on the table/resource that should carry the event.',
    );
  }

  // For mirror-only events the API binding is what produces rows (mirror flow
  // copies API → DB). DB-only binding without API binding usually means the
  // LLM forgot to anchor-bind on the API side, leaving the API rows random.
  // We log this as a warning rather than throwing because legitimate uses
  // exist (DB-only drift overrides), but it's almost always a bug.
  const hasAnyApiArchetypes = Object.keys(data.apiEntityArchetypes ?? {}).length > 0;
  if (hasAnyApiArchetypes) {
    const dbOnly = [...dbBound].filter((id) => !apiBound.has(id));
    if (dbOnly.length > 0) {
      logger.warn(
        `Anchor(s) [${dbOnly.join(', ')}] are bound on the DB side but not on any API side. ` +
        `For mirror events (DB and API agree on the row), bind the anchor on the API side too — ` +
        `mirror flow then propagates the row to DB. DB-only binding is correct only for drift ` +
        `overrides (DB and API intentionally diverge with hardcoded matching ids).`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract identity entity counts per adapter from Phase 1 DB archetypes.
 *
 * For each identity table, finds the associated API adapter/resource from
 * table classifications and computes the count per platform based on
 * archetype billing_platform weights.
 *
 * Returns: { adapterId: { resourceType: count } }
 */
function extractIdentityEntityCounts(
  blueprint: Blueprint,
  identityTableNames?: Set<string>,
  tableClassifications?: TableClassification[],
): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};

  if (!identityTableNames || identityTableNames.size === 0 || !tableClassifications) {
    return result;
  }

  for (const classification of tableClassifications) {
    if (classification.role !== 'identity') continue;
    if (!classification.sources || classification.sources.length === 0) continue;

    const tableName = classification.table;
    const dbArchetypes = blueprint.data.entityArchetypes?.[tableName];
    const staticRows = blueprint.data.entities?.[tableName] ?? [];
    if (!dbArchetypes && staticRows.length === 0) continue;

    // Total identity-table count = archetype-driven rows + narrative-named
    // static entities. Without the static count, Phase 2 generates too few
    // API entities and DB↔API overlap is short by the narrative count.
    const totalCount = (dbArchetypes?.count ?? 0) + staticRows.length;

    // Determine per-platform distribution from archetype billing_platform weights
    const platformWeights: Record<string, number> = {};
    for (const arch of dbArchetypes?.archetypes ?? []) {
      const platform = arch.fields.billing_platform as string | undefined;
      if (platform) {
        platformWeights[platform] = (platformWeights[platform] ?? 0) + arch.weight;
      }
    }

    const platformNames = Object.keys(platformWeights);

    if (platformNames.length > 0) {
      const totalWeight = Object.values(platformWeights).reduce((s, w) => s + w, 0);
      for (const source of classification.sources) {
        const weight = platformWeights[source.adapter] ?? (1 / platformNames.length);
        const count = Math.max(1, Math.round((weight / totalWeight) * totalCount));
        if (!result[source.adapter]) result[source.adapter] = {};
        result[source.adapter]![source.resource] = count;
      }
    } else {
      // No explicit billing_platform split — distribute evenly across sources
      const sources = classification.sources;
      const countPerSource = Math.max(1, Math.round(totalCount / sources.length));
      for (const source of sources) {
        if (!result[source.adapter]) result[source.adapter] = {};
        result[source.adapter]![source.resource] = countPerSource;
      }
    }
  }

  return result;
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
