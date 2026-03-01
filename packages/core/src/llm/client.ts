import { generateObject, generateText } from 'ai';
import type { z } from 'zod';
import { createProvider, type ProviderConfig } from './providers.js';
import { CostTracker, type CostCategory } from './cost-tracker.js';
import { BlueprintGenerationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LLMClientConfig extends ProviderConfig {
  /** Maximum retries on transient errors (default 2). */
  maxRetries?: number;
  /** Request timeout in milliseconds (default 120 000). */
  timeoutMs?: number;
  /** Temperature for generation (default 0.7). */
  temperature?: number;
}

export interface GenerateObjectOptions<T extends z.ZodTypeAny> {
  schema: T;
  schemaName?: string;
  schemaDescription?: string;
  system?: string;
  prompt: string;
  label?: string;
  category?: CostCategory;
  temperature?: number;
  maxRetries?: number;
}

export interface GenerateTextOptions {
  system?: string;
  prompt: string;
  label?: string;
  category?: CostCategory;
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
}

export interface GenerateObjectResult<T> {
  object: T;
  promptTokens: number;
  completionTokens: number;
}

export interface GenerateTextResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
}

// ---------------------------------------------------------------------------
// LLMClient
// ---------------------------------------------------------------------------

/**
 * Thin, opinionated wrapper around the Vercel AI SDK that:
 *   1. Creates a provider-specific model from Mimic config.
 *   2. Delegates to `generateObject` / `generateText`.
 *   3. Records every call's token usage via `CostTracker`.
 *   4. Maps SDK errors into `BlueprintGenerationError`.
 */
export class LLMClient {
  private readonly model: ReturnType<typeof createProvider>;
  private readonly costTracker: CostTracker;
  private readonly config: LLMClientConfig;

  constructor(config: LLMClientConfig, costTracker?: CostTracker) {
    this.config = config;
    this.model = createProvider(config);
    this.costTracker = costTracker ?? new CostTracker();
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  /** Return the underlying Vercel AI SDK model instance. */
  getModel() {
    return this.model;
  }

  /** Return the model identifier string. */
  getModelId(): string {
    return this.config.model;
  }

  /** Return the associated CostTracker. */
  getCostTracker(): CostTracker {
    return this.costTracker;
  }

  // -----------------------------------------------------------------------
  // Structured output
  // -----------------------------------------------------------------------

  /**
   * Generate a structured object validated against a Zod schema.
   */
  async generateObject<T extends z.ZodTypeAny>(
    opts: GenerateObjectOptions<T>,
  ): Promise<GenerateObjectResult<z.infer<T>>> {
    const label = opts.label ?? 'generateObject';
    const category = opts.category ?? 'generation';

    logger.debug(`LLM [${label}] calling ${this.config.model} (object mode)`);

    try {
      const result = await generateObject({
        model: this.model,
        schema: opts.schema,
        schemaName: opts.schemaName,
        schemaDescription: opts.schemaDescription,
        system: opts.system,
        prompt: opts.prompt,
        temperature: opts.temperature ?? this.config.temperature ?? 0.7,
        maxRetries: opts.maxRetries ?? this.config.maxRetries ?? 2,
      });

      const promptTokens = result.usage?.promptTokens ?? 0;
      const completionTokens = result.usage?.completionTokens ?? 0;

      this.costTracker.record({
        label,
        category,
        model: this.config.model,
        promptTokens,
        completionTokens,
      });

      logger.debug(
        `LLM [${label}] done — ${promptTokens} prompt + ${completionTokens} completion tokens`,
      );

      return {
        object: result.object as z.infer<T>,
        promptTokens,
        completionTokens,
      };
    } catch (error) {
      throw this.wrapError(error, label);
    }
  }

  // -----------------------------------------------------------------------
  // Free-form text
  // -----------------------------------------------------------------------

  /**
   * Generate free-form text.
   */
  async generateText(opts: GenerateTextOptions): Promise<GenerateTextResult> {
    const label = opts.label ?? 'generateText';
    const category = opts.category ?? 'generation';

    logger.debug(`LLM [${label}] calling ${this.config.model} (text mode)`);

    try {
      const result = await generateText({
        model: this.model,
        system: opts.system,
        prompt: opts.prompt,
        temperature: opts.temperature ?? this.config.temperature ?? 0.7,
        maxTokens: opts.maxTokens,
        maxRetries: opts.maxRetries ?? this.config.maxRetries ?? 2,
      });

      const promptTokens = result.usage?.promptTokens ?? 0;
      const completionTokens = result.usage?.completionTokens ?? 0;

      this.costTracker.record({
        label,
        category,
        model: this.config.model,
        promptTokens,
        completionTokens,
      });

      logger.debug(
        `LLM [${label}] done — ${promptTokens} prompt + ${completionTokens} completion tokens`,
      );

      return {
        text: result.text,
        promptTokens,
        completionTokens,
      };
    } catch (error) {
      throw this.wrapError(error, label);
    }
  }

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  private wrapError(error: unknown, label: string): BlueprintGenerationError {
    const message =
      error instanceof Error ? error.message : String(error);

    logger.debug(`LLM [${label}] error: ${message}`);

    return new BlueprintGenerationError(
      `LLM call "${label}" failed: ${message}`,
      `Check your API key, model name (${this.config.model}), and provider (${this.config.provider})`,
      error instanceof Error ? error : undefined,
    );
  }
}
