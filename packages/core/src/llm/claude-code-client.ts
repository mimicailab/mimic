import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CostTracker, type CostCategory } from './cost-tracker.js';
import { openRecordsInJsonSchema, unwrapToolInput } from './anthropic-native.js';
import {
  type GenerateObjectOptions,
  type GenerateObjectResult,
  type GenerateTextOptions,
  type GenerateTextResult,
  type ILLMClient,
} from './client.js';
import { BlueprintGenerationError } from '../utils/errors.js';
import { logger, debugFile } from '../utils/logger.js';

/**
 * Configuration for the Claude Agent SDK runtime.
 *
 * Auth is handled by the SDK itself — it picks up either `ANTHROPIC_API_KEY`
 * from env or the OAuth token from `claude login`. We don't pass the key
 * through; users who want a different key should set it in their environment.
 */
export interface ClaudeCodeClientConfig {
  model: string;
  /** Max repair attempts on Zod validation failure. Defaults to 2. */
  maxRetries?: number;
  /** Default temperature. Defaults to 0.7. */
  temperature?: number;
  /** Per-call timeout in ms. Defaults to 600_000 (10min). */
  timeoutMs?: number;
}

/**
 * LLM runtime that proxies calls through the Claude Agent SDK
 * (`@anthropic-ai/claude-agent-sdk`) instead of the Messages API directly.
 *
 * Why someone would pick this:
 *   - Calls billed against the user's Claude subscription (Pro/Max) instead
 *     of per-token API charges. For a heavy generator like Mimic this can
 *     wipe out hundreds of dollars per month.
 *   - Reuses whatever auth the user already has set up for Claude Code.
 *
 * Structured output goes through the SDK's native `outputFormat: json_schema`
 * mode — the agent enforces the schema server-side and surfaces the parsed
 * object on the result message's `structured_output` field. That's the same
 * reliability tier as the native API's forced tool_use; we don't have to do
 * the prompt-injection + JSON-extraction dance.
 *
 * Tradeoffs vs the native API client:
 *   - Higher per-call latency than the raw HTTP path.
 *   - No batch mode — the SDK uses the regular Messages API under the hood.
 */
export class ClaudeCodeClient implements ILLMClient {
  private readonly costTracker: CostTracker;
  private readonly config: ClaudeCodeClientConfig;
  // Lazy-loaded SDK to keep this import optional at runtime — if the user
  // never selects the claude-code runtime they don't need the package
  // resolvable. Populated on first call.
  private querySdk?: (params: ClaudeAgentQueryParams) => AsyncIterable<ClaudeAgentMessage>;

  constructor(config: ClaudeCodeClientConfig, costTracker?: CostTracker) {
    this.config = config;
    this.costTracker = costTracker ?? new CostTracker();
  }

  getModelId(): string {
    return this.config.model;
  }

  getCostTracker(): CostTracker {
    return this.costTracker;
  }

  // -----------------------------------------------------------------------
  // Structured output
  // -----------------------------------------------------------------------

  async generateObject<T extends z.ZodTypeAny>(
    opts: GenerateObjectOptions<T>,
  ): Promise<GenerateObjectResult<z.infer<T>>> {
    const label = opts.label ?? 'generateObject';
    const category = opts.category ?? 'generation';
    const maxRetries = opts.maxRetries ?? this.config.maxRetries ?? 2;

    // JSON Schema — opened so `z.record(...)` fields don't get
    // additionalProperties: false (same fix as anthropic-native.ts).
    const rawJsonSchema = zodToJsonSchema(opts.schema, { $refStrategy: 'none' }) as Record<string, unknown>;
    delete rawJsonSchema.$schema;
    const inputSchema = openRecordsInJsonSchema(rawJsonSchema) as Record<string, unknown>;
    const expectedTopKeys = Object.keys((inputSchema.properties as Record<string, unknown>) ?? {});

    const baseSystem = opts.system ?? '';

    let lastIssues = '';
    let userPrompt = opts.prompt;
    const attempts: { label: string; promptTokens: number; completionTokens: number }[] = [];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const attemptLabel = attempt === 0 ? label : `${label}:repair-${attempt}`;
      debugFile(`CLAUDE-CODE REQUEST [${attemptLabel}]`, {
        model: this.config.model,
        system: baseSystem.slice(0, 500),
        prompt: attempt === 0 ? userPrompt.slice(0, 1000) : '<repair attempt — see lastIssues>',
        expectedTopKeys,
        attempt,
      });

      let result: OneShotResult;
      try {
        result = await this.runOneShot({
          system: baseSystem || undefined,
          prompt: userPrompt,
          temperature: opts.temperature ?? this.config.temperature,
          outputFormat: { type: 'json_schema', schema: inputSchema },
        });
      } catch (error) {
        throw this.wrapError(error, attemptLabel);
      }

      attempts.push({
        label: attemptLabel,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      });

      // Prefer the SDK's parsed structured_output; fall back to parsing the
      // assistant text in case an older SDK or model didn't populate it.
      const raw =
        result.structuredOutput !== undefined
          ? result.structuredOutput
          : extractJson(result.text);

      if (raw === undefined) {
        debugFile(`CLAUDE-CODE JSON PARSE FAILED [${attemptLabel}]`, result.text.slice(0, 2000));
        lastIssues = 'response was not valid JSON';
      } else {
        const unwrapped = unwrapToolInput(raw, expectedTopKeys);
        const validation = opts.schema.safeParse(unwrapped);
        if (validation.success) {
          for (const a of attempts) {
            this.costTracker.record({
              label: a.label,
              category,
              model: this.config.model,
              promptTokens: a.promptTokens,
              completionTokens: a.completionTokens,
              runtime: 'claude-code',
            });
          }
          logger.debug(
            `LLM [${label}] (claude-code) done — ${result.promptTokens} prompt + ${result.completionTokens} completion tokens` +
            (attempts.length > 1 ? ` over ${attempts.length} attempt(s)` : ''),
          );
          return {
            object: validation.data as z.infer<T>,
            promptTokens: attempts.reduce((s, a) => s + a.promptTokens, 0),
            completionTokens: attempts.reduce((s, a) => s + a.completionTokens, 0),
            attempts,
          };
        }
        lastIssues = validation.error.issues
          .slice(0, 20)
          .map((i: { path: unknown[]; message: string }) =>
            `${(i.path as string[]).join('.')}: ${i.message}`)
          .join('\n  ');
        debugFile(`CLAUDE-CODE VALIDATION FAILED [${attemptLabel}]`, {
          issues: lastIssues,
          rawKeys: Object.keys((unwrapped as Record<string, unknown>) ?? {}),
        });
      }

      if (attempt >= maxRetries) break;

      logger.warn(
        `⚠ [${label}] (claude-code) schema validation failed (attempt ${attempt + 1}/${maxRetries + 1}) — requesting repair`,
      );

      userPrompt =
        `${opts.prompt}\n\n` +
        `Your previous response failed schema validation at these paths:\n  ${lastIssues}\n\n` +
        `Re-emit the COMPLETE JSON object with every required field present.`;
    }

    // Record token usage even on failure so the user sees what they were charged.
    for (const a of attempts) {
      this.costTracker.record({
        label: a.label,
        category,
        model: this.config.model,
        promptTokens: a.promptTokens,
        completionTokens: a.completionTokens,
        runtime: 'claude-code',
      });
    }

    throw new BlueprintGenerationError(
      `LLM call "${label}" (claude-code runtime) failed: ` +
      `response did not match schema after ${attempts.length} attempt(s). ` +
      `Final issues: ${lastIssues}`,
      'If failures persist on a specific schema, switch to `--llm-runtime api` for the affected run.',
    );
  }

  // -----------------------------------------------------------------------
  // Free-form text
  // -----------------------------------------------------------------------

  async generateText(opts: GenerateTextOptions): Promise<GenerateTextResult> {
    const label = opts.label ?? 'generateText';
    const category = opts.category ?? 'generation';

    try {
      const result = await this.runOneShot({
        system: opts.system,
        prompt: opts.prompt,
        temperature: opts.temperature ?? this.config.temperature,
      });

      this.costTracker.record({
        label,
        category,
        model: this.config.model,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        runtime: 'claude-code',
      });

      logger.debug(
        `LLM [${label}] (claude-code) done — ${result.promptTokens} prompt + ${result.completionTokens} completion tokens`,
      );

      return {
        text: result.text,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      };
    } catch (error) {
      throw this.wrapError(error, label);
    }
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private async runOneShot(args: {
    system?: string;
    prompt: string;
    temperature?: number;
    outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> };
  }): Promise<OneShotResult> {
    const query = await this.loadSdk();

    const stream = query({
      prompt: args.prompt,
      options: {
        model: this.config.model,
        ...(args.system ? { systemPrompt: args.system } : {}),
        ...(args.outputFormat ? { outputFormat: args.outputFormat } : {}),
        // Pure inference — disable all built-in tools (Bash/Read/Edit/etc.).
        // `tools: []` removes them from the model's context entirely;
        // `allowedTools` is for auto-approval, which is different.
        // Because tools is empty there's nothing for the agent to ever ask
        // about, so we stay on the default permission mode — `bypassPermissions`
        // requires `allowDangerouslySkipPermissions: true`, which the SDK
        // refuses under root.
        tools: [],
        // No `maxTurns` here. The SDK uses internal turns when
        // `outputFormat: json_schema` is set so the model can self-correct
        // schema violations; capping at 1 produces `error_max_turns`. With
        // `tools: []` the agent has nothing else it could do with extra
        // turns, so leaving it unbounded is safe.
        permissionMode: 'default',
        // Headless: don't read user/project settings files.
        settingSources: [],
        persistSession: false,
      },
    });

    let assistantText = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let structuredOutput: unknown | undefined;
    let errorReason: string | undefined;

    const timeoutMs = this.config.timeoutMs ?? 600_000;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
    }, timeoutMs);

    let gotSuccessResult = false;
    try {
      for await (const message of stream) {
        if (timedOut) {
          errorReason = `claude-agent-sdk timed out after ${timeoutMs}ms`;
          break;
        }
        if (message.type === 'assistant' && message.message) {
          for (const block of message.message.content ?? []) {
            if (block.type === 'text' && typeof block.text === 'string') {
              assistantText += block.text;
            }
          }
        } else if (message.type === 'result') {
          promptTokens = message.usage?.input_tokens ?? 0;
          completionTokens = message.usage?.output_tokens ?? 0;
          // The SDK can mark `subtype: 'success'` while also setting
          // `is_error: true` (e.g. auth failures surface as a success-shaped
          // result with an error message in `result`). Both must be checked.
          if (message.subtype === 'success' && !message.is_error) {
            gotSuccessResult = true;
            if (typeof message.result === 'string' && message.result.length > 0) {
              assistantText = message.result;
            }
            if (message.structured_output !== undefined) {
              structuredOutput = message.structured_output;
            }
          } else if (message.subtype === 'success' && message.is_error) {
            // Auth / billing / etc. failure dressed up as success.
            errorReason = typeof message.result === 'string' && message.result.length > 0
              ? `claude-agent-sdk error: ${message.result}`
              : `claude-agent-sdk error result (subtype=success, is_error=true)`;
          } else {
            errorReason = `claude-agent-sdk failed: subtype=${message.subtype}`;
          }
        }
      }
    } catch (streamError) {
      // The SDK throws on the spawned process's non-zero exit even when a
      // result message has already been emitted (success OR error). Prefer
      // the meaningful error from the result message; only propagate the
      // generic exit-code error when we got nothing useful.
      if (!gotSuccessResult && !errorReason) {
        throw streamError;
      }
    } finally {
      clearTimeout(timer);
    }

    if (errorReason) {
      throw new Error(errorReason);
    }
    if (!assistantText && structuredOutput === undefined) {
      throw new Error('claude-agent-sdk returned no assistant text or structured output');
    }

    return { text: assistantText, promptTokens, completionTokens, structuredOutput };
  }

  private async loadSdk(): Promise<(params: ClaudeAgentQueryParams) => AsyncIterable<ClaudeAgentMessage>> {
    if (this.querySdk) return this.querySdk;
    try {
      // Dynamic import: keeps the SDK an optional dep — users who stay on the
      // 'api' or 'batch' runtime don't need the package resolvable.
      const mod = await import('@anthropic-ai/claude-agent-sdk');
      this.querySdk = (mod as unknown as { query: (params: ClaudeAgentQueryParams) => AsyncIterable<ClaudeAgentMessage> }).query;
      return this.querySdk;
    } catch (error) {
      throw new BlueprintGenerationError(
        '@anthropic-ai/claude-agent-sdk is not installed but llm.runtime = "claude-code" was selected',
        'Install it with: pnpm add @anthropic-ai/claude-agent-sdk -w  (or switch to --llm-runtime api)',
        error instanceof Error ? error : undefined,
      );
    }
  }

  private wrapError(error: unknown, label: string): BlueprintGenerationError {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug(`LLM [${label}] (claude-code) error: ${message}`);
    return new BlueprintGenerationError(
      `LLM call "${label}" (claude-code runtime) failed: ${message}`,
      'Check that you are logged in (`claude login`) or that ANTHROPIC_API_KEY is set, ' +
      `and that the model name is valid (${this.config.model}).`,
      error instanceof Error ? error : undefined,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface OneShotResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  structuredOutput?: unknown;
}

/**
 * Fallback JSON extraction for the rare case the SDK does not populate
 * `structured_output` (e.g. when `outputFormat` was not provided). Tries:
 * raw parse, fence stripping, then largest `{...}` / `[...]` substring.
 */
function extractJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const candidate = fenceMatch ? fenceMatch[1]! : trimmed;

  try {
    return JSON.parse(candidate);
  } catch { /* fall through */ }

  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(candidate.slice(first, last + 1));
    } catch { /* fall through */ }
  }
  const firstA = candidate.indexOf('[');
  const lastA = candidate.lastIndexOf(']');
  if (firstA >= 0 && lastA > firstA) {
    try {
      return JSON.parse(candidate.slice(firstA, lastA + 1));
    } catch { /* fall through */ }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Minimal local shape for the Claude Agent SDK
// ---------------------------------------------------------------------------
//
// We avoid importing the SDK's types at compile time so the dep stays
// optional in tsc — the `import()` inside loadSdk() is the only reference.

interface ClaudeAgentQueryParams {
  prompt: string;
  options?: {
    model?: string;
    systemPrompt?: string;
    tools?: string[];
    allowedTools?: string[];
    maxTurns?: number;
    permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk';
    settingSources?: ('user' | 'project' | 'local')[];
    persistSession?: boolean;
    outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> };
  };
}

interface ClaudeAgentMessage {
  type: 'system' | 'user' | 'assistant' | 'result';
  subtype?: string;
  message?: {
    content?: Array<{ type: string; text?: string }>;
  };
  result?: string;
  is_error?: boolean;
  structured_output?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number };
}
