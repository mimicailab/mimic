import { generateText, streamText, Output } from 'ai';
import type { z } from 'zod';
import { createProvider, type ProviderConfig } from './providers.js';
import { CostTracker, type CostCategory } from './cost-tracker.js';
import { callAnthropicStructured } from './anthropic-native.js';
import { BlueprintGenerationError } from '../utils/errors.js';
import { logger, debugFile } from '../utils/logger.js';

// Models that don't accept the `temperature` parameter. Includes:
//   - OpenAI reasoning models (o1+, gpt-5-mini)
//   - Anthropic Opus 4.7+ (deprecated `temperature` for these models;
//     setting it returns invalid_request_error from the API)
const REASONING_MODELS = /^(o[1-9]|o3-mini|gpt-5-mini|claude-opus-4-7)/;

// Per-model maximum output tokens. The default 65536 exceeds the cap on
// some models and triggers AI SDK warnings + truncated responses. When the
// cap is too tight for a structured-output schema, the response fails the
// zod parse and the caller sees "No object generated".
function maxOutputTokensForModel(modelId: string): number {
  // Opus 4.7's effective max-output is 64k for the synchronous request path
  // we use here; 128k is gated behind streaming + a beta header.
  if (/^claude-opus-4-7/.test(modelId)) return 64_000;
  return 65_536;
}

// Anthropic structured-output mode. We default to 'jsonTool' across all
// models because Anthropic's native structured-output mode (outputFormat)
// produces minimum-viable responses on Opus 4.7 — the model treats every
// optional schema field as "skip" and emits an almost-empty object that
// passes Zod but fails domain coverage. jsonTool mode presents the schema
// as a tool input; Anthropic models fill tool inputs more completely.
function anthropicStructuredOutputMode(_modelId: string): 'auto' | 'jsonTool' {
  return 'jsonTool';
}

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
  /**
   * Per-attempt breakdown when the underlying provider supports schema repair
   * retries (currently the native Anthropic path). Each entry carries its own
   * label — `<label>` for the first attempt, `<label>:repair-N` for repairs —
   * so the cost tracker can record each call distinctly. Undefined on
   * providers that don't expose this granularity.
   */
  attempts?: ReadonlyArray<{ label: string; promptTokens: number; completionTokens: number }>;
}

export interface GenerateTextResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Surface contract every LLM runtime must implement. The blueprint engine,
 * content generator, claim extractor, etc. depend on this — not on a concrete
 * class — so alternate runtimes (Claude Agent SDK, batch API) can be swapped
 * in without touching the pipeline.
 */
export interface ILLMClient {
  generateObject<T extends z.ZodTypeAny>(
    opts: GenerateObjectOptions<T>,
  ): Promise<GenerateObjectResult<z.infer<T>>>;
  generateText(opts: GenerateTextOptions): Promise<GenerateTextResult>;
  getModelId(): string;
  getCostTracker(): CostTracker;
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
export class LLMClient implements ILLMClient {
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
    debugFile(`LLM REQUEST [${label}]`, {
      model: this.config.model,
      provider: this.config.provider,
      system: opts.system?.substring(0, 500) + (opts.system && opts.system.length > 500 ? `... (${opts.system.length} chars total)` : ''),
      prompt: opts.prompt,
      temperature: opts.temperature ?? this.config.temperature ?? 0.7,
      maxRetries: opts.maxRetries ?? this.config.maxRetries ?? 2,
      timeoutMs: this.config.timeoutMs ?? 120_000,
    });

    // For Anthropic, bypass the AI SDK and call the API directly. The AI SDK
    // forces `additionalProperties: false` on every object node, which makes
    // `z.record(z.unknown())` fields forbid all keys — Sonnet ignores it,
    // Opus 4.7 obeys it and emits empty `{}` everywhere. Going direct lets us
    // ship a schema with open records and produce the rich content the
    // persona requires. Other providers keep the AI SDK path.
    if (this.config.provider === 'anthropic') {
      try {
        const isReasoning = REASONING_MODELS.test(this.config.model);
        const result = await callAnthropicStructured({
          schema: opts.schema,
          schemaName: opts.schemaName,
          schemaDescription: opts.schemaDescription,
          system: opts.system,
          prompt: opts.prompt,
          model: this.config.model,
          apiKey: this.config.apiKey,
          baseUrl: this.config.baseUrl,
          temperature: opts.temperature ?? this.config.temperature,
          maxOutputTokens: maxOutputTokensForModel(this.config.model),
          timeoutMs: this.config.timeoutMs ?? 600_000,
          maxRetries: opts.maxRetries ?? this.config.maxRetries ?? 2,
          isReasoning,
          label,
        });
        // If the native call exposed per-attempt usage (with distinct labels
        // for repair attempts), record each one separately so the cost summary
        // shows repairs as their own line items. Otherwise fall back to a
        // single record using the call's overall totals.
        const attempts = result.attempts;
        if (attempts && attempts.length > 0) {
          for (const a of attempts) {
            this.costTracker.record({
              label: a.label,
              category,
              model: this.config.model,
              promptTokens: a.promptTokens,
              completionTokens: a.completionTokens,
            });
          }
        } else {
          this.costTracker.record({
            label,
            category,
            model: this.config.model,
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
          });
        }
        logger.debug(
          `LLM [${label}] done — ${result.promptTokens} prompt + ${result.completionTokens} completion tokens` +
          (attempts && attempts.length > 1 ? ` over ${attempts.length} attempt(s)` : ''),
        );
        return result;
      } catch (error) {
        throw this.wrapError(error, label);
      }
    }

    try {
      // Use streamText to avoid HTTP timeouts on large structured outputs.
      // The streaming connection stays alive while the LLM generates tokens.
      const isReasoning = REASONING_MODELS.test(this.config.model);
      const timeoutMs = this.config.timeoutMs ?? 120_000;
      const stream = streamText({
        model: this.model,
        output: Output.object({
          schema: opts.schema,
        }),
        system: opts.system,
        prompt: opts.prompt,
        ...(isReasoning ? {} : { temperature: opts.temperature ?? this.config.temperature ?? 0.7 }),
        maxRetries: opts.maxRetries ?? this.config.maxRetries ?? 2,
        maxOutputTokens: maxOutputTokensForModel(this.config.model),
        timeout: timeoutMs,
        providerOptions: {
          anthropic: { structuredOutputMode: anthropicStructuredOutputMode(this.config.model) },
          openai: { strictJsonSchema: false },
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
        debugFile(`LLM RAW RESPONSE (SDK error recovery) [${label}]`, rawText || '(empty)');
        if (rawText) {
          logger.debug(`LLM [${label}] SDK error, raw text (${rawText.length} chars): ${rawText.substring(0, 500)}`);
          try {
            let raw = JSON.parse(rawText);
            logger.debug(`LLM [${label}] parsed JSON type: ${typeof raw}, keys: ${Object.keys(raw ?? {}).slice(0, 10).join(', ')}`);
            // Unwrap single-key envelope responses. Different providers /
            // models pick different wrapper keys for the same payload:
            //   { "data": {...} }                — generic
            //   { "json": {...} }                — older Anthropic jsonTool
            //   { "$PARAMETER_NAME": "..." }     — Opus 4.7 jsonTool placeholder
            //   { "input": "..." }               — Opus 4.7 tool-call wrapper
            // The value may be either an object (use as-is) or a stringified
            // JSON (parse first). Only unwrap when the wrapper is the SOLE
            // key — schemas with legitimate top-level "data" / "input" fields
            // have additional siblings.
            const rawKeys = Object.keys(raw ?? {});
            if (rawKeys.length === 1) {
              const inner = raw[rawKeys[0]];
              if (inner && typeof inner === 'object') {
                raw = inner;
              } else if (typeof inner === 'string') {
                try {
                  const parsed = JSON.parse(inner);
                  if (parsed && typeof parsed === 'object') raw = parsed;
                } catch { /* leave raw as-is */ }
              }
            }
            const validation = opts.schema.safeParse(raw);
            if (validation.success) {
              logger.debug(`LLM [${label}] Zod passed on manual parse, using result`);
              debugFile(`LLM VALIDATION OK [${label}]`, 'Zod validation passed after normalization');
              const err2 = sdkErr as { usage?: { inputTokens?: number; outputTokens?: number } };
              return {
                object: validation.data as z.infer<T>,
                promptTokens: err2.usage?.inputTokens ?? 0,
                completionTokens: err2.usage?.outputTokens ?? 0,
              };
            }
            const issues = validation.error.issues.map((i: { path: unknown[]; message: string }) =>
              `${(i.path as string[]).join('.')}: ${i.message}`);
            debugFile(`LLM VALIDATION FAILED [${label}]`, { issues, rawKeys: Object.keys(raw ?? {}) });
            logger.debug(`LLM [${label}] Zod validation issues:\n  ${issues.join('\n  ')}`);
          } catch (parseErr) {
            debugFile(`LLM JSON PARSE FAILED [${label}]`, String(parseErr));
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

      debugFile(`LLM RESPONSE OK [${label}]`, {
        promptTokens,
        completionTokens,
        output,
      });

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
      const isReasoning = REASONING_MODELS.test(this.config.model);
      const timeoutMs = this.config.timeoutMs ?? 120_000;
      const result = await generateText({
        model: this.model,
        system: opts.system,
        prompt: opts.prompt,
        ...(isReasoning ? {} : { temperature: opts.temperature ?? this.config.temperature ?? 0.7 }),
        maxOutputTokens: opts.maxTokens,
        maxRetries: opts.maxRetries ?? this.config.maxRetries ?? 2,
        timeout: timeoutMs,
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
