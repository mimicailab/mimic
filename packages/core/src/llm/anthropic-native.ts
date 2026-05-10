import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { logger, debugFile } from '../utils/logger.js';

/**
 * Direct Anthropic SDK client for structured output.
 *
 * Why this exists (vs the Vercel AI SDK path):
 *
 * 1. AI SDK's `addAdditionalPropertiesToJsonSchema` walks every object node in
 *    the JSON schema and FORCES `additionalProperties: false`. That breaks
 *    `z.record(z.unknown())` — those open-shape fields end up forbidding all
 *    keys. Sonnet ignores the constraint and emits content anyway; Opus 4.7
 *    obeys it literally and emits empty `{}` for fields/vary on every
 *    archetype, producing a sparse, useless blueprint.
 *
 * 2. Opus 4.7 also has a tool-input wrapping quirk: the structured response
 *    can come back wrapped under a single key (`data`, `input`,
 *    `$PARAMETER_NAME`). We unwrap defensively at receive time.
 *
 * Going direct gives us total control over the JSON schema sent (records stay
 * open) and lets us handle the wrapping quirk without fighting two layers of
 * abstraction.
 */
export interface NativeAnthropicCallOptions<T extends z.ZodTypeAny> {
  schema: T;
  schemaName?: string;
  schemaDescription?: string;
  system?: string;
  prompt: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxRetries: number;
  /** When true, omit `temperature` (Opus 4.7+ deprecates the parameter). */
  isReasoning: boolean;
  label: string;
}

export interface NativeAnthropicResult<T> {
  object: T;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Walk a JSON Schema tree and replace `additionalProperties: false` on object
 * nodes that have NO `properties` field. Those nodes correspond to
 * `z.record(...)` outputs that should accept any keys. Setting them to `true`
 * lets the model emit the rich content the persona requires.
 *
 * Object nodes that DO have a `properties` map keep `additionalProperties:
 * false` — that's the correct strict behavior for fixed-shape objects (it
 * prevents the model from inventing extra fields outside the schema).
 */
export function openRecordsInJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(openRecordsInJsonSchema);
  if (!node || typeof node !== 'object') return node;
  const obj = node as Record<string, unknown>;

  if (obj.type === 'object') {
    const hasProperties =
      obj.properties && typeof obj.properties === 'object' &&
      Object.keys(obj.properties as Record<string, unknown>).length > 0;
    if (!hasProperties && obj.additionalProperties === false) {
      obj.additionalProperties = true;
    }
  }

  for (const key of ['properties', 'definitions', '$defs', 'patternProperties']) {
    const v = obj[key];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const out: Record<string, unknown> = {};
      for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
        out[k] = openRecordsInJsonSchema(vv);
      }
      obj[key] = out;
    }
  }
  for (const key of ['items', 'additionalProperties', 'contains', 'not']) {
    if (obj[key] != null && typeof obj[key] === 'object') {
      obj[key] = openRecordsInJsonSchema(obj[key]);
    }
  }
  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    const v = obj[key];
    if (Array.isArray(v)) obj[key] = v.map(openRecordsInJsonSchema);
  }
  return obj;
}

/**
 * Defensively unwrap single-key tool-input wrappers that Opus 4.7 sometimes
 * emits: `{ data: <obj> }`, `{ input: "<stringified-json>" }`,
 * `{ $PARAMETER_NAME: "<stringified-json>" }`. The wrapper is variable but
 * always a single key whose value is either the object or a JSON string of it.
 *
 * We keep unwrapping until the result has multiple keys OR no key remotely
 * matches the schema's expected top level — a cap of 3 levels keeps us out of
 * pathological loops.
 */
export function unwrapToolInput(
  raw: unknown,
  expectedTopKeys: string[],
): unknown {
  let current = raw;
  for (let i = 0; i < 3; i++) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) break;
    const keys = Object.keys(current as Record<string, unknown>);
    if (keys.length !== 1) break;

    const onlyKey = keys[0];
    const inner = (current as Record<string, unknown>)[onlyKey];

    // If the current shape already looks like the schema, stop unwrapping —
    // a legit single-key schema (rare) shouldn't be peeled.
    if (expectedTopKeys.includes(onlyKey) && expectedTopKeys.length === 1) break;

    if (typeof inner === 'string') {
      try {
        const parsed = JSON.parse(inner);
        if (parsed && typeof parsed === 'object') {
          current = parsed;
          continue;
        }
      } catch { /* fall through */ }
      break;
    }
    if (inner && typeof inner === 'object') {
      // Only unwrap if the inner has at least one expected top-level key —
      // prevents stripping a legit single-key payload.
      const innerKeys = Object.keys(inner as Record<string, unknown>);
      const matches = expectedTopKeys.some((k) => innerKeys.includes(k));
      if (matches) {
        current = inner;
        continue;
      }
      break;
    }
    break;
  }
  return current;
}

/**
 * Make a structured-output call against the Anthropic API directly, bypassing
 * the Vercel AI SDK. Uses a forced tool call with a hand-shaped JSON Schema
 * so records stay open (`additionalProperties: true`).
 */
export async function callAnthropicStructured<T extends z.ZodTypeAny>(
  opts: NativeAnthropicCallOptions<T>,
): Promise<NativeAnthropicResult<z.infer<T>>> {
  const client = new Anthropic({
    ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
    ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
    timeout: opts.timeoutMs,
    maxRetries: opts.maxRetries,
  });

  const rawJsonSchema = zodToJsonSchema(opts.schema, { $refStrategy: 'none' }) as Record<string, unknown>;
  // zod-to-json-schema wraps in a top-level $schema; Anthropic doesn't need it
  delete rawJsonSchema.$schema;
  const inputSchema = openRecordsInJsonSchema(rawJsonSchema) as Record<string, unknown>;

  const toolName = opts.schemaName?.replace(/[^a-zA-Z0-9_-]/g, '_') ?? 'json';
  const tool = {
    name: toolName,
    description: opts.schemaDescription ?? 'Respond with a JSON object matching the schema.',
    input_schema: inputSchema as Anthropic.Tool.InputSchema,
  };

  const expectedTopKeys = Object.keys((inputSchema.properties as Record<string, unknown>) ?? {});

  debugFile(`ANTHROPIC NATIVE REQUEST [${opts.label}]`, {
    model: opts.model,
    system: opts.system?.slice(0, 500),
    prompt: opts.prompt,
    inputSchemaTopKeys: expectedTopKeys,
    isReasoning: opts.isReasoning,
    maxOutputTokens: opts.maxOutputTokens,
  });

  const response = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxOutputTokens,
    ...(opts.system ? { system: opts.system } : {}),
    ...(opts.isReasoning ? {} : { temperature: opts.temperature ?? 0.7 }),
    tools: [tool],
    tool_choice: { type: 'tool', name: toolName },
    messages: [{ role: 'user', content: opts.prompt }],
  });

  const toolUse = response.content.find(
    (b: Anthropic.ContentBlock): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse) {
    throw new Error(`Anthropic returned no tool_use block. stop_reason=${response.stop_reason}`);
  }

  const promptTokens = response.usage?.input_tokens ?? 0;
  const completionTokens = response.usage?.output_tokens ?? 0;

  const unwrapped = unwrapToolInput(toolUse.input, expectedTopKeys);
  debugFile(`ANTHROPIC NATIVE RESPONSE [${opts.label}]`, {
    promptTokens,
    completionTokens,
    rawTopKeys: Object.keys((toolUse.input as Record<string, unknown>) ?? {}),
    unwrappedTopKeys: Object.keys((unwrapped as Record<string, unknown>) ?? {}),
    output: unwrapped,
  });

  const validation = opts.schema.safeParse(unwrapped);
  if (!validation.success) {
    const issues = validation.error.issues
      .slice(0, 20)
      .map((i: { path: unknown[]; message: string }) =>
        `${(i.path as string[]).join('.')}: ${i.message}`,
      )
      .join('\n  ');
    logger.debug(`Anthropic native [${opts.label}] zod validation failed:\n  ${issues}`);
    throw new Error(`No object generated: response did not match schema. Issues: ${issues}`);
  }

  return {
    object: validation.data as z.infer<T>,
    promptTokens,
    completionTokens,
  };
}
