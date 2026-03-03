import { createHash } from 'node:crypto';
import type { Blueprint, SchemaModel } from '../types/index.js';
import type { LLMClient } from '../llm/client.js';
import type { CostTracker } from '../llm/cost-tracker.js';
import { BlueprintCache } from './blueprint-cache.js';
import { BlueprintLLMOutputSchema, type BlueprintLLMOutput } from './blueprint-zod.js';
import { buildPrompt } from './prompts.js';
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

    const { system, user } = buildPrompt({ schema, persona, domain, apis });

    let llmOutput: BlueprintLLMOutput;
    try {
      const result = await this.llmClient.generateObject({
        schema: BlueprintLLMOutputSchema,
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
    // 3. Assemble the full Blueprint with metadata
    // ------------------------------------------------------------------
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
// Helpers
// ---------------------------------------------------------------------------

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
