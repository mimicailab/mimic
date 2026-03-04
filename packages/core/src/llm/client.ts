import { generateText, streamText, Output } from 'ai';
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
 * Thin, opinionated wrapper around the Vercel AI SDK v6 that:
 *   1. Creates a provider-specific model from Mimic config.
 *   2. Delegates to `generateText` with `Output.object()` for structured output.
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
  // Structured output (AI SDK v6: generateText + Output.object)
  // -----------------------------------------------------------------------

  /**
   * Generate a structured object validated against a Zod schema.
   *
   * Uses AI SDK v6's `generateText` with `Output.object()` which leverages
   * the provider's native structured output capabilities.
   */
  async generateObject<T extends z.ZodTypeAny>(
    opts: GenerateObjectOptions<T>,
  ): Promise<GenerateObjectResult<z.infer<T>>> {
    const label = opts.label ?? 'generateObject';
    const category = opts.category ?? 'generation';

    logger.debug(`LLM [${label}] calling ${this.config.model} (structured output)`);

    try {
      // Use streamText to avoid HTTP timeouts on large structured outputs.
      // The streaming connection stays alive while the LLM generates tokens.
      const stream = streamText({
        model: this.model,
        output: Output.object({
          schema: opts.schema,
        }),
        system: opts.system,
        prompt: opts.prompt,
        temperature: opts.temperature ?? this.config.temperature ?? 0.7,
        maxRetries: opts.maxRetries ?? this.config.maxRetries ?? 2,
        maxOutputTokens: 32768,
        providerOptions: {
          anthropic: { structuredOutputMode: 'jsonTool' },
        },
      });

      // Consume the stream and collect the final result
      let result;
      try {
        result = await stream;
        // Wait for the stream to fully complete
        await result.output;
      } catch (sdkErr: unknown) {
        // Output.object validation failed — try to extract from raw text
        const errObj = sdkErr as { text?: string; output?: unknown; cause?: { value?: unknown } };
        const rawText = errObj.text ?? '';
        if (rawText) {
          logger.debug(`LLM [${label}] SDK error, raw text: ${rawText.substring(0, 500)}`);
          try {
            let raw = JSON.parse(rawText);
            if (raw.data && !opts.schema.safeParse(raw).success) {
              raw = raw.data;
            } else if (raw.json && !opts.schema.safeParse(raw).success) {
              raw = raw.json;
            }
            const validation = opts.schema.safeParse(raw);
            if (validation.success) {
              logger.debug(`LLM [${label}] Zod passed on manual parse, using result`);
              const err2 = sdkErr as { usage?: { inputTokens?: number; outputTokens?: number } };
              return {
                object: validation.data as z.infer<T>,
                promptTokens: err2.usage?.inputTokens ?? 0,
                completionTokens: err2.usage?.outputTokens ?? 0,
              };
            }
            const issues = validation.error.issues.map((i: { path: unknown[]; message: string }) =>
              `${(i.path as string[]).join('.')}: ${i.message}`);
            logger.debug(`LLM [${label}] Zod validation issues:\n  ${issues.join('\n  ')}`);
          } catch (parseErr) {
            logger.debug(`LLM [${label}] manual JSON parse failed: ${parseErr}`);
          }
        }
        throw sdkErr;
      }

      const output = await result.output;
      if (!output) {
        throw new Error('No object generated: response did not match schema.');
      }

      const usage = await result.usage;
      const promptTokens = usage?.inputTokens ?? 0;
      const completionTokens = usage?.outputTokens ?? 0;

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
        object: output as z.infer<T>,
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
        maxOutputTokens: opts.maxTokens,
        maxRetries: opts.maxRetries ?? this.config.maxRetries ?? 2,
      });

      const promptTokens = result.usage?.inputTokens ?? 0;
      const completionTokens = result.usage?.outputTokens ?? 0;

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
