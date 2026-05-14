import { createHash } from 'node:crypto';
import type { Blueprint, SchemaModel, PromptContext, AdapterResourceSpecs, TableClassification } from '../types/index.js';
import type { EntityArchetypeConfig } from '../types/blueprint.js';
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
import { extractClaims } from './claim-extractor.js';
import { sanitiseClaims } from './claim-sanitiser.js';
import { rewriteClaimsForBridges } from './bridge-rewriter.js';
import { deriveSlots } from './topology.js';
import { generateAllSlots, type SlotContentResult } from './content-generator.js';
import type { Claim } from '../types/claim.js';

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
      return this.generate(schema, persona, domain, options, apis, promptContexts, schemaMapping, resourceSpecs);
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
        // Surface declared anchors so per-adapter calls can bind any whose
        // persona event lives in their domain. Without this, anchors that
        // weren't bound DB-side in Phase 1 stay unbound everywhere and the
        // post-merge validator aborts the run.
        anchors: phase1Blueprint.data.anchors,
        // Pass Phase 1 claims forward so Phase 2 can cite them when an API
        // archetype is responsible for satisfying a persona-narrated number.
        // The prompt builder filters to claims targeting this adapter.
        claims: phase1Blueprint.data.claims as unknown as ReadonlyArray<{
          id: string;
          quote: string;
          kind: string;
          target: { surface: string; name: string; filter?: Record<string, unknown> };
        }> | undefined,
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

  // =====================================================================
  // V2 — claim-extract → bridge-rewrite → topology → per-slot content
  // =====================================================================

  /**
   * V2 blueprint generation.
   *
   * Pipeline:
   *   1. Cache check (same key as legacy path; bumped schemaVersion guards against shape drift).
   *   2. Claim extraction (one narrow LLM call) → { personaProfile, claims, anchors }.
   *   3. Bridge rewrite on claims (deterministic) — re-route bridge-table
   *      claims to api.<adapter>.<resource>.
   *   4. Topology — derive a ResourceSlot per generation surface (DB tables
   *      minus bridges + API resources), filtering claims per slot.
   *   5. Per-slot content generation (N parallel LLM calls). Each call sees
   *      only its slot's schema/spec, claims, anchors, and the persona.
   *      Output: archetypes with no count/weight — those come from the
   *      count solver downstream.
   *   6. Assemble the Blueprint and write to cache.
   *
   * The blueprint produced here is fed to `expandAndAudit`, which runs the
   * (idempotent) bridge rewriter again, then the count solver, then expand
   * + audit + repair as in the legacy pipeline. Bridge rewriter and solver
   * are designed to be safe on V2-generated blueprints.
   */
  async generateV2(
    schema: SchemaModel,
    persona: PersonaInput,
    domain: string,
    options: GenerateOptions = {},
    apis?: Record<string, { adapter?: string; config?: Record<string, unknown> }>,
    promptContexts?: Record<string, PromptContext>,
    resourceSpecs?: Record<string, AdapterResourceSpecs>,
    schemaMapping?: SchemaMapping,
  ): Promise<Blueprint> {
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

    logger.step(
      `Generating blueprint (V2) for "${persona.name}" in domain "${domain}"...`,
    );

    // ── Step 1: claim + anchor extraction ────────────────────────────────
    const extraction = await extractClaims(
      this.llmClient,
      { name: persona.name, description: persona.description },
      domain,
      schema,
      promptContexts,
      resourceSpecs,
      schemaMapping,
      {
        temperature: options.temperature,
        maxRetries: options.maxRetries,
        currentDate: new Date().toISOString().split('T')[0],
        volume: options.volume,
        personaIndex: options.personaIndex,
        totalPersonas: options.totalPersonas,
      },
    );

    // ── Step 2: bridge rewrite (deterministic; idempotent) ───────────────
    // Run BEFORE field-grounding sanitiser so claims targeting bridge tables
    // (e.g. db.users where billing_platform=stripe) get re-routed to the API
    // surface (api.stripe.customer with the platform filter stripped) first.
    // Otherwise the sanitiser would reject them as field-not-found, since
    // the platform discriminator column is structural / not always present.
    const { claims: bridgeRewrittenClaims, rewritten } = rewriteClaimsForBridges(
      extraction.claims,
      schemaMapping,
    );
    if (rewritten.length > 0) {
      logger.info(
        `Bridge rewrite (claims): re-routed ${rewritten.length} bridge-table claim${rewritten.length === 1 ? '' : 's'} to the API surface.`,
      );
      for (const r of rewritten) {
        logger.debug(
          `  - ${r.claimId}: ${r.from.surface}.${r.from.name} → ${r.to.surface}.${r.to.name}`,
        );
      }
    }

    // ── Step 1b → 2b: claim sanitiser (pure code; drops malformed shapes) ─
    // V3 Layer 1 — pass schema + resourceSpecs so the sanitiser can reject
    // claims whose filter keys reference fields that don't exist on the
    // target resource (e.g. plan=starter on stripe.customer, which has no
    // plan field — tier lives on subscription/price.metadata).
    const sanitised = sanitiseClaims(bridgeRewrittenClaims, {
      schema,
      resourceSpecs,
    });
    const rewrittenClaims = sanitised.claims;

    // ── Step 3: topology — derive slots ──────────────────────────────────
    const slots = deriveSlots({
      schema,
      resourceSpecs,
      schemaMapping,
      tableClassifications: undefined, // engine receives via expandAndAudit downstream
      claims: rewrittenClaims,
      volume: options.volume,
    });
    logger.step(
      `Derived ${slots.length} resource slot${slots.length === 1 ? '' : 's'} ` +
        `(${slots.filter((s) => s.surface === 'db').length} db, ${slots.filter((s) => s.surface === 'api').length} api)`,
    );

    // ── Step 4: per-slot content (parallel) ──────────────────────────────
    const slotResults = await generateAllSlots(this.llmClient, slots, {
      persona: { name: persona.name, description: persona.description },
      domain,
      anchors: extraction.anchors,
      promptContexts,
      resourceSpecs,
      schemaMapping,
      concurrency: options.adapterBatchConcurrency ?? 4,
      temperature: options.temperature,
      maxRetries: options.maxRetries,
      currentDate: new Date().toISOString().split('T')[0],
      volume: options.volume,
      personaIndex: options.personaIndex,
      totalPersonas: options.totalPersonas,
    });

    // ── Step 5: assemble the Blueprint ───────────────────────────────────
    const blueprint = assembleBlueprintFromSlots({
      persona,
      personaId: extraction.personaId,
      domain: extraction.domain,
      personaProfile: extraction.persona,
      claims: rewrittenClaims,
      anchors: extraction.anchors,
      slotResults,
      modelId: this.llmClient.getModelId(),
    });

    // ── Step 6: write to cache ───────────────────────────────────────────
    try {
      await this.cache.set(cacheKey, blueprint);
      logger.success(
        `Blueprint for "${persona.name}" cached (${cacheKey.slice(0, 8)}...)`,
      );
    } catch (error) {
      logger.warn(
        `Failed to cache blueprint: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return blueprint;
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
      // v3: added structured claims (data.claims) + EntityArchetype.cites
      //     for the persona-contract architecture. Old caches won't include
      //     claims/cites and would skip the auditor entirely.
      schemaVersion: 3,
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

  // ── Path A: claim-driven counts (preferred, structural backstop) ────────
  //
  // Phase 1 should put bridge-table claims on the API surface (e.g.
  //   { kind: "row_count", target: { surface: "api", name: "stripe.customer" }, expected: 1200 }
  // ). When it does, we lock the per-resource count directly. This works
  // EVEN IF the LLM forgot to also emit DB archetypes for that table
  // (which it should, under the bridge-table rule).
  //
  // We also handle the half-compliance case: a row_count claim still on
  // db.<bridge_table> with filter.billing_platform=<X> — translate it to
  // the matching api.<X>.<resource> count via the classification's sources.
  for (const claim of blueprint.data.claims ?? []) {
    if (claim.kind !== 'row_count') continue;
    const expected = claim.expected;

    if (claim.target.surface === 'api') {
      // "<adapter>.<resource>"
      const dot = claim.target.name.indexOf('.');
      if (dot < 0) continue;
      const adapter = claim.target.name.slice(0, dot);
      const resource = claim.target.name.slice(dot + 1);
      if (!result[adapter]) result[adapter] = {};
      result[adapter]![resource] = expected;
      continue;
    }

    // surface === 'db' — only useful for bridge-table claims with a
    // platform filter that points at one of the table's sources.
    if (claim.target.surface !== 'db') continue;
    const classification = tableClassifications.find((c) => c.table === claim.target.name);
    if (!classification || classification.role !== 'identity') continue;
    if (!classification.sources || classification.sources.length === 0) continue;

    const filter = claim.target.filter as Record<string, unknown> | undefined;
    const platformFilter = filter?.billing_platform;
    const platform = typeof platformFilter === 'string' ? platformFilter : undefined;
    if (!platform) continue;

    const source = classification.sources.find((s) => s.adapter === platform);
    if (!source) continue;
    if (!result[source.adapter]) result[source.adapter] = {};
    result[source.adapter]![source.resource] = expected;
  }

  // ── Path B: legacy DB-archetype-driven counts (fallback) ────────────────
  //
  // For each identity table that DOES have DB archetypes (i.e. either it's
  // not a bridge table OR the LLM ignored the bridge-table rule), derive
  // per-platform counts from archetype billing_platform weights. Path A's
  // claim-derived counts take precedence — Path B only fills in adapter/
  // resource pairs Path A didn't cover.
  for (const classification of tableClassifications) {
    if (classification.role !== 'identity') continue;
    if (!classification.sources || classification.sources.length === 0) continue;

    const tableName = classification.table;
    const dbArchetypes = blueprint.data.entityArchetypes?.[tableName];
    const staticRows = blueprint.data.entities?.[tableName] ?? [];
    if (!dbArchetypes && staticRows.length === 0) continue;

    const totalCount = (dbArchetypes?.count ?? 0) + staticRows.length;

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
        if (result[source.adapter]?.[source.resource] != null) continue; // Path A wins
        const weight = platformWeights[source.adapter] ?? (1 / platformNames.length);
        const count = Math.max(1, Math.round((weight / totalWeight) * totalCount));
        if (!result[source.adapter]) result[source.adapter] = {};
        result[source.adapter]![source.resource] = count;
      }
    } else {
      const sources = classification.sources;
      const countPerSource = Math.max(1, Math.round(totalCount / sources.length));
      for (const source of sources) {
        if (result[source.adapter]?.[source.resource] != null) continue; // Path A wins
        if (!result[source.adapter]) result[source.adapter] = {};
        result[source.adapter]![source.resource] = countPerSource;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// V2 blueprint assembly
// ---------------------------------------------------------------------------

/**
 * Build a complete Blueprint from V2 layer outputs.
 *
 * Merges per-slot archetype configs into entityArchetypes /
 * apiEntityArchetypes, carries claims and anchors forward, and computes
 * the checksum. The output is ready for `expandAndAudit`.
 */
function assembleBlueprintFromSlots(input: {
  persona: PersonaInput;
  personaId: string;
  domain: string;
  personaProfile: import('../types/blueprint.js').PersonaProfile;
  claims: Claim[];
  anchors: import('../types/blueprint.js').Anchor[];
  slotResults: SlotContentResult[];
  modelId: string;
}): Blueprint {
  void input.persona; // name retained for telemetry/cache key only
  const entityArchetypes: Record<string, EntityArchetypeConfig> = {};
  const apiEntityArchetypes: Record<string, Record<string, EntityArchetypeConfig>> = {};

  for (const result of input.slotResults) {
    if (result.slot.surface === 'db') {
      entityArchetypes[result.slot.name] = result.config;
    } else {
      const adapter = result.slot.adapterId!;
      const resource = result.slot.resourceType!;
      apiEntityArchetypes[adapter] = apiEntityArchetypes[adapter] ?? {};
      apiEntityArchetypes[adapter][resource] = result.config;
    }
  }

  const now = new Date().toISOString();
  const blueprint: Blueprint = {
    version: '1.0',
    personaId: input.personaId,
    domain: input.domain,
    generatedAt: now,
    generatedBy: `mimic/${input.modelId}`,
    checksum: '',
    persona: input.personaProfile,
    data: {
      entities: {},
      patterns: [],
      annotations: {},
      claims: input.claims,
      ...(input.anchors.length > 0 ? { anchors: input.anchors } : {}),
      ...(Object.keys(entityArchetypes).length > 0 ? { entityArchetypes } : {}),
      ...(Object.keys(apiEntityArchetypes).length > 0 ? { apiEntityArchetypes } : {}),
    },
  };

  blueprint.checksum = computeChecksum(blueprint);
  return blueprint;
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
