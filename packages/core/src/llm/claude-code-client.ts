import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CostTracker, type CostCategory } from './cost-tracker.js';
import { openRecordsInJsonSchema, unwrapToolInput } from './anthropic-native.js';
import {
  normalizeLLMOutput,
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
 * Tradeoffs vs the native API client:
 *   - No forced tool_use. We prompt the agent to emit raw JSON matching the
 *     schema, then parse + Zod-validate + retry on failure. Less reliable
 *     than the API's tool_choice path on big schemas.
 *   - Higher per-call latency than the raw HTTP path.
 *   - No batch mode — Claude Code uses the regular Messages API under the hood.
 *
 * Structured output flow:
 *   1. Convert Zod → JSON Schema, open records (same trick as anthropic-native).
 *   2. Inject the schema into the system prompt with strict
 *      "emit only JSON, no fences" instructions.
 *   3. Spawn a 1-turn `query()` with empty tool allowlist and a permissive
 *      permission mode so the SDK runs headless.
 *   4. Drain the message stream, pick the final assistant text, parse JSON.
 *   5. On Zod failure, re-prompt with the failing paths up to `maxRetries`.
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

    // Build the JSON Schema the agent must respect. Reuses
    // `openRecordsInJsonSchema` so `z.record(z.unknown())` fields stay open
    // — same fix as the native client.
    const rawJsonSchema = zodToJsonSchema(opts.schema, { $refStrategy: 'none' }) as Record<string, unknown>;
    delete rawJsonSchema.$schema;
    const inputSchema = openRecordsInJsonSchema(rawJsonSchema) as Record<string, unknown>;
    const expectedTopKeys = Object.keys((inputSchema.properties as Record<string, unknown>) ?? {});

    const baseSystem = opts.system ?? '';
    const structuredInstruction = buildStructuredOutputInstruction(inputSchema, opts.schemaName, opts.schemaDescription);

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

      let assistantText: string;
      let promptTokens = 0;
      let completionTokens = 0;
      try {
        const result = await this.runOneShot({
          system: baseSystem ? `${baseSystem}\n\n${structuredInstruction}` : structuredInstruction,
          prompt: userPrompt,
          temperature: opts.temperature ?? this.config.temperature,
        });
        assistantText = result.text;
        promptTokens = result.promptTokens;
        completionTokens = result.completionTokens;
      } catch (error) {
        throw this.wrapError(error, attemptLabel);
      }

      attempts.push({ label: attemptLabel, promptTokens, completionTokens });

      const parsed = extractJson(assistantText);
      if (parsed === undefined) {
        debugFile(`CLAUDE-CODE JSON PARSE FAILED [${attemptLabel}]`, assistantText.slice(0, 2000));
        lastIssues = 'response was not valid JSON';
      } else {
        const unwrapped = unwrapToolInput(parsed, expectedTopKeys);
        const normalized = normalizeLLMOutput(unwrapped);
        const validation = opts.schema.safeParse(normalized);
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
            `LLM [${label}] (claude-code) done — ${promptTokens} prompt + ${completionTokens} completion tokens` +
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
        debugFile(`CLAUDE-CODE VALIDATION FAILED [${attemptLabel}]`, { issues: lastIssues, rawKeys: Object.keys((normalized as Record<string, unknown>) ?? {}) });
      }

      if (attempt >= maxRetries) break;

      logger.warn(
        `⚠ [${label}] (claude-code) schema validation failed (attempt ${attempt + 1}/${maxRetries + 1}) — requesting repair`,
      );

      userPrompt =
        `${opts.prompt}\n\n` +
        `Your previous response failed schema validation at these paths:\n  ${lastIssues}\n\n` +
        `Re-emit the COMPLETE JSON object with every required field present. ` +
        `Output ONLY the JSON object — no prose, no code fences.`;
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
      'The Claude Agent SDK does not support forced tool_use, so structured ' +
      'output relies on prompt instructions + retry. If failures persist on a ' +
      'specific schema, switch to `--llm-runtime api` for the affected run.',
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
  }): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
    const query = await this.loadSdk();

    const stream = query({
      prompt: args.prompt,
      options: {
        model: this.config.model,
        ...(args.system ? { systemPrompt: args.system } : {}),
        // Pure inference — no file access, no bash, no MCP.
        allowedTools: [],
        // One round-trip; agentic looping is not what this client is for.
        maxTurns: 1,
        // Headless: don't prompt for permission, don't read user/project settings.
        permissionMode: 'bypassPermissions',
        settingSources: [],
      },
    });

    let assistantText = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let finalErrored: string | undefined;

    const timeoutMs = this.config.timeoutMs ?? 600_000;
    const timer = setTimeout(() => {
      finalErrored = `claude-agent-sdk timed out after ${timeoutMs}ms`;
    }, timeoutMs);

    try {
      for await (const message of stream) {
        if (finalErrored) break;
        if (message.type === 'assistant' && message.message) {
          for (const block of message.message.content ?? []) {
            if (block.type === 'text' && typeof block.text === 'string') {
              assistantText += block.text;
            }
          }
        } else if (message.type === 'result') {
          if (message.subtype === 'success') {
            // `result` is the final assistant text; prefer it over our accumulator
            // if present (it's already de-deduplicated by the SDK).
            if (typeof message.result === 'string' && message.result.length > 0) {
              assistantText = message.result;
            }
          } else {
            finalErrored = `claude-agent-sdk returned subtype=${message.subtype}`;
          }
          promptTokens = message.usage?.input_tokens ?? 0;
          completionTokens = message.usage?.output_tokens ?? 0;
        }
      }
    } finally {
      clearTimeout(timer);
    }

    if (finalErrored) {
      throw new Error(finalErrored);
    }
    if (!assistantText) {
      throw new Error('claude-agent-sdk returned no assistant text');
    }

    return { text: assistantText, promptTokens, completionTokens };
  }

  private async loadSdk(): Promise<(params: ClaudeAgentQueryParams) => AsyncIterable<ClaudeAgentMessage>> {
    if (this.querySdk) return this.querySdk;
    try {
      // Dynamic import: keeps the SDK an optional dep — users who stay on the
      // 'api' or 'batch' runtime don't need the package resolvable.
      const mod = await import('@anthropic-ai/claude-agent-sdk');
      // The SDK exports `query`; cast to our minimal local shape so we don't
      // import its types at compile time (keeps the dep optional in tsc too).
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

function buildStructuredOutputInstruction(
  jsonSchema: Record<string, unknown>,
  schemaName?: string,
  schemaDescription?: string,
): string {
  const header = schemaName
    ? `You must respond with a single JSON object named "${schemaName}".`
    : 'You must respond with a single JSON object.';
  const desc = schemaDescription ? `\n${schemaDescription}\n` : '';
  return [
    header,
    desc,
    'Output ONLY the JSON object. No prose before or after. No markdown code fences.',
    'Every required field in the schema must be present. Open record fields (no properties listed) accept any keys — fill them with rich content rather than leaving them empty.',
    '',
    'JSON Schema:',
    JSON.stringify(jsonSchema),
  ].join('\n');
}

/**
 * Best-effort JSON extraction from agent text. Tries: raw parse, then
 * extracting the largest `{...}` substring (handles cases where the agent
 * adds a sentence despite the instruction).
 */
function extractJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  // Strip ```json … ``` and ``` … ``` fences if the agent insisted.
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const candidate = fenceMatch ? fenceMatch[1]! : trimmed;

  try {
    return JSON.parse(candidate);
  } catch { /* fall through */ }

  // Greedy: find the outermost JSON object/array.
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
    allowedTools?: string[];
    maxTurns?: number;
    permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
    settingSources?: ('user' | 'project' | 'local')[];
  };
}

interface ClaudeAgentMessage {
  type: 'system' | 'user' | 'assistant' | 'result';
  subtype?: string;
  message?: {
    content?: Array<{ type: string; text?: string }>;
  };
  result?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}
