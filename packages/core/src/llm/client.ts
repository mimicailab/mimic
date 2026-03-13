import { generateText, streamText, Output } from 'ai';
import type { z } from 'zod';
import { createProvider, type ProviderConfig } from './providers.js';
import { CostTracker, type CostCategory } from './cost-tracker.js';
import { BlueprintGenerationError } from '../utils/errors.js';
import { logger, debugFile } from '../utils/logger.js';

// Models that are reasoning models and don't support temperature
const REASONING_MODELS = /^(o[1-9]|o3-mini|gpt-5-mini)/;

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
    debugFile(`LLM REQUEST [${label}]`, {
      model: this.config.model,
      provider: this.config.provider,
      system: opts.system?.substring(0, 500) + (opts.system && opts.system.length > 500 ? `... (${opts.system.length} chars total)` : ''),
      prompt: opts.prompt,
      temperature: opts.temperature ?? this.config.temperature ?? 0.7,
      maxRetries: opts.maxRetries ?? this.config.maxRetries ?? 2,
      timeoutMs: this.config.timeoutMs ?? 120_000,
    });

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
        maxOutputTokens: 65536,
        timeout: timeoutMs,
        providerOptions: {
          anthropic: { structuredOutputMode: 'jsonTool' },
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
            // Some providers wrap the response in { data: ... } or { json: ... }.
            // Only unwrap if the wrapper key is the SOLE key (to avoid
            // clobbering schemas that have a legitimate "data" field).
            const rawKeys = Object.keys(raw ?? {});
            if (rawKeys.length === 1 && raw.data) {
              raw = raw.data;
            } else if (rawKeys.length === 1 && raw.json) {
              raw = raw.json;
            }
            // Normalize common LLM output shape mismatches before Zod validation
            raw = normalizeLLMOutput(raw);
            debugFile(`LLM NORMALIZED OUTPUT [${label}]`, raw);
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

// ---------------------------------------------------------------------------
// LLM output normalization
// ---------------------------------------------------------------------------

const PERIODIC_FREQ_MAP: Record<string, string> = {
  day: 'weekly', daily: 'weekly',
  week: 'weekly', weekly: 'weekly',
  biweek: 'biweekly', biweekly: 'biweekly',
  month: 'monthly', monthly: 'monthly',
  year: 'monthly', yearly: 'monthly', annual: 'monthly', annually: 'monthly',
  quarter: 'monthly', quarterly: 'monthly',
};

/**
 * Normalize common LLM output shape mismatches so Zod validation succeeds.
 *
 * Handles:
 * - `apiEntityArchetypes` entries that are arrays instead of `{ count, archetypes }`
 * - `data.entities` values that are objects instead of arrays (wraps in `[obj]`)
 * - `data.patterns[].periodic.frequency` as object → string enum
 * - `data.entityArchetypes` entries that are arrays instead of `{ count, archetypes }`
 */
function normalizeLLMOutput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;

  // --- Un-nest apiEntityArchetypes from inside apiEntities ---
  // LLMs sometimes nest { apiEntities: { ..., apiEntityArchetypes: {...} } }
  // instead of { apiEntities: {...}, apiEntityArchetypes: {...} }
  if (!obj.apiEntityArchetypes && obj.apiEntities && typeof obj.apiEntities === 'object') {
    const entities = obj.apiEntities as Record<string, unknown>;
    if (entities.apiEntityArchetypes && typeof entities.apiEntityArchetypes === 'object') {
      obj.apiEntityArchetypes = entities.apiEntityArchetypes;
      delete entities.apiEntityArchetypes;
    }
  }

  // --- Normalize apiEntityArchetypes (top-level or nested under data) ---
  normalizeArchetypeMap(obj, 'apiEntityArchetypes', true);

  // --- Normalize data sub-object ---
  const data = obj.data as Record<string, unknown> | undefined;
  if (data && typeof data === 'object') {
    // Ensure required fields exist with defaults
    if (!data.patterns) data.patterns = [];
    if (!data.entities) data.entities = {};

    // Fix facts with invalid type values
    if (Array.isArray(data.facts)) {
      const VALID_FACT_TYPES = new Set([
        'anomaly', 'overdue', 'pending', 'integrity', 'growth', 'risk', 'dispute', 'churn', 'fraud', 'compliance',
      ]);
      const FACT_TYPE_MAP: Record<string, string> = {
        info: 'integrity', warning: 'risk', error: 'anomaly', critical: 'anomaly',
        billing: 'integrity', subscription: 'churn', payment: 'pending',
      };
      for (const fact of data.facts as Record<string, unknown>[]) {
        if (fact.type && typeof fact.type === 'string' && !VALID_FACT_TYPES.has(fact.type)) {
          fact.type = FACT_TYPE_MAP[fact.type.toLowerCase()] ?? 'integrity';
        }
      }
    }

    // entities: object values → wrap in array
    if (data.entities && typeof data.entities === 'object') {
      for (const [table, value] of Object.entries(data.entities as Record<string, unknown>)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          (data.entities as Record<string, unknown>)[table] = [value];
        }
      }
    }

    // Un-nest apiEntityArchetypes from inside entityArchetypes
    if (!data.apiEntityArchetypes && data.entityArchetypes && typeof data.entityArchetypes === 'object') {
      const ea = data.entityArchetypes as Record<string, unknown>;
      if (ea.apiEntityArchetypes && typeof ea.apiEntityArchetypes === 'object') {
        data.apiEntityArchetypes = ea.apiEntityArchetypes;
        delete ea.apiEntityArchetypes;
      }
    }

    // entityArchetypes: arrays → { count, archetypes }
    normalizeArchetypeMap(data, 'entityArchetypes');
    normalizeArchetypeMap(data, 'apiEntityArchetypes', true);

    // patterns: fix common shape issues
    if (Array.isArray(data.patterns)) {
      for (const pattern of data.patterns as Record<string, unknown>[]) {
        normalizePattern(pattern);
      }
    }
  }

  return obj;
}

const VALID_RANDOM_TYPES = new Set(['pick', 'range', 'decimal_range', 'date_in_period']);
const RANDOM_TYPE_MAP: Record<string, string> = {
  timestamp: 'date_in_period', date: 'date_in_period', datetime: 'date_in_period',
  integer: 'range', int: 'range', number: 'range',
  float: 'decimal_range', decimal: 'decimal_range',
  string: 'pick', text: 'pick', enum: 'pick',
};

const VALID_VARIATION_TYPES = new Set([
  'firstName', 'lastName', 'fullName', 'email', 'phone', 'companyName',
  'pick', 'range', 'decimal_range', 'uuid', 'timestamp', 'date', 'derived', 'sequence',
]);

/**
 * Infer a FieldVariation type from a field name when the LLM omits `type`.
 */
function inferVariationType(fieldName: string): string {
  const f = fieldName.toLowerCase();
  if (f === 'id' || f === 'uuid' || f.endsWith('_id') || f.endsWith('_uuid')) return 'sequence';
  if (f === 'first_name' || f === 'given_name' || f === 'firstname') return 'firstName';
  if (f === 'last_name' || f === 'family_name' || f === 'lastname' || f === 'surname') return 'lastName';
  if (f === 'name' || f === 'full_name' || f === 'fullname' || f === 'display_name') return 'fullName';
  if (f === 'company' || f === 'company_name' || f === 'organization') return 'companyName';
  if (f === 'email' || f === 'email_address') return 'email';
  if (f === 'phone' || f === 'phone_number') return 'phone';
  if (f.includes('date') || f.includes('created') || f.includes('updated') || f.endsWith('_at')
    || f === 'first_seen' || f === 'last_seen' || f.endsWith('Date')) return 'timestamp';
  if (f === 'amount' || f === 'total' || f === 'balance' || f === 'unit_amount'
    || f.endsWith('_amount') || f.endsWith('_money') || f === 'price') return 'decimal_range';
  if (f === 'number' || f.endsWith('Number') || f.endsWith('_number')) return 'sequence';
  return 'pick';
}

/**
 * Detect LLM shorthand where the variation type name is used as the object key
 * instead of the `type` property. Returns the canonical form or null.
 *
 * Examples:
 *   { sequence: "tran_p1_" }        → { type: "sequence", prefix: "tran_p1_" }
 *   { pick: ["a", "b"] }            → { type: "pick", values: ["a", "b"] }
 *   { range: [1, 100] }             → { type: "range", min: 1, max: 100 }
 *   { decimal_range: [1.0, 99.0] }  → { type: "decimal_range", min: 1.0, max: 99.0 }
 *   { timestamp: [min, max] }       → { type: "timestamp", min: min, max: max }
 *   { date: [min, max] }            → { type: "date", min: min, max: max }
 *   { derived: "{{x}}_{{y}}" }      → { type: "derived", template: "{{x}}_{{y}}" }
 */
function detectVaryShorthand(obj: Record<string, unknown>): Record<string, unknown> | null {
  const keys = Object.keys(obj);

  for (const key of keys) {
    if (!VALID_VARIATION_TYPES.has(key)) continue;

    const val = obj[key];

    switch (key) {
      case 'sequence':
        if (typeof val === 'string') return { type: 'sequence', prefix: val };
        break;

      case 'pick':
        if (Array.isArray(val)) return { type: 'pick', values: val };
        break;

      case 'range':
        if (Array.isArray(val) && val.length >= 2)
          return { type: 'range', min: val[0], max: val[1] };
        break;

      case 'decimal_range':
        if (Array.isArray(val) && val.length >= 2)
          return { type: 'decimal_range', min: val[0], max: val[1] };
        break;

      case 'timestamp':
        if (Array.isArray(val) && val.length >= 2)
          return { type: 'timestamp', min: val[0], max: val[1] };
        if (typeof val === 'string') return { type: 'timestamp' };
        break;

      case 'date':
        if (Array.isArray(val) && val.length >= 2)
          return { type: 'date', min: val[0], max: val[1] };
        if (typeof val === 'string') return { type: 'date' };
        break;

      case 'derived':
        if (typeof val === 'string') return { type: 'derived', template: val };
        break;

      case 'uuid':
        return { type: 'uuid' };

      case 'firstName': case 'lastName': case 'fullName':
      case 'email': case 'phone': case 'companyName':
        return { type: key };
    }
  }

  return null;
}

/**
 * Normalize `vary` fields in an archetype's vary map: ensure every value is a
 * valid FieldVariation object with a `type` property.
 */
function normalizeVaryFields(vary: Record<string, unknown>): void {
  for (const [fieldName, fieldValue] of Object.entries(vary)) {
    if (Array.isArray(fieldValue)) {
      // Array value in vary → wrap as pick with the array as possible values
      vary[fieldName] = { type: 'pick', values: fieldValue };
      continue;
    }
    if (!fieldValue || typeof fieldValue !== 'object') {
      // Bare value (string, number, null) → wrap into a variation
      const inferred = inferVariationType(fieldName);
      if (inferred === 'sequence' && typeof fieldValue === 'string') {
        vary[fieldName] = { type: 'sequence', prefix: fieldValue };
      } else if (typeof fieldValue === 'string' && fieldValue.includes('{{')) {
        vary[fieldName] = { type: 'derived', template: fieldValue };
      } else if (fieldValue !== null && fieldValue !== undefined) {
        vary[fieldName] = { type: inferred, ...(inferred === 'pick' ? { values: [fieldValue] } : {}) };
      } else {
        vary[fieldName] = { type: inferred };
      }
      continue;
    }

    const obj = fieldValue as Record<string, unknown>;

    // Detect LLM shorthand where type name is used as the key:
    //   { "sequence": "prefix_" } → { type: "sequence", prefix: "prefix_" }
    //   { "pick": ["a","b"] }     → { type: "pick", values: ["a","b"] }
    //   { "range": [1, 100] }     → { type: "range", min: 1, max: 100 }
    //   { "timestamp": [min,max]} → { type: "timestamp", min: min, max: max }
    if (!obj.type || typeof obj.type !== 'string') {
      const shorthand = detectVaryShorthand(obj);
      if (shorthand) {
        Object.keys(obj).forEach(k => delete obj[k]);
        Object.assign(obj, shorthand);
      }
    }

    if (!obj.type || typeof obj.type !== 'string') {
      if (obj.min !== undefined || obj.max !== undefined) {
        obj.type = typeof obj.min === 'number' && !Number.isInteger(obj.min) ? 'decimal_range' : 'range';
      } else if (Array.isArray(obj.values)) {
        obj.type = 'pick';
      } else if (obj.template && typeof obj.template === 'string') {
        obj.type = 'derived';
      } else if (obj.prefix && typeof obj.prefix === 'string') {
        obj.type = 'sequence';
      } else {
        obj.type = inferVariationType(fieldName);
      }
    } else if (!VALID_VARIATION_TYPES.has(obj.type as string)) {
      const mapped = RANDOM_TYPE_MAP[(obj.type as string).toLowerCase()];
      obj.type = mapped ? (mapped === 'date_in_period' ? 'timestamp' : mapped) : inferVariationType(fieldName);
    }

    // Fix timestamp/date fields with string min/max — remove them so expander uses default range
    if (obj.type === 'timestamp' || obj.type === 'date') {
      if (typeof obj.min === 'string') delete obj.min;
      if (typeof obj.max === 'string') delete obj.max;
    }

    // Fix derived fields where template is not a string (object/array) → convert to pick
    if (obj.type === 'derived' && obj.template !== undefined && typeof obj.template !== 'string') {
      obj.type = 'pick';
      obj.values = [obj.template];
      delete obj.template;
    }
  }
}

function normalizePattern(pattern: Record<string, unknown>): void {
  // Event: ensure probability exists
  if (pattern.type === 'event') {
    if (!pattern.event) pattern.event = { fields: {}, probability: 0.5 };
    const ev = pattern.event as Record<string, unknown>;
    if (ev.probability === undefined) ev.probability = 0.5;
    if (!ev.fields) ev.fields = {};
  }

  // Periodic: fix frequency
  if (pattern.type === 'periodic') {
    if (!pattern.periodic) pattern.periodic = { fields: {}, frequency: 'monthly' };
    const p = pattern.periodic as Record<string, unknown>;
    if (!p.fields) p.fields = {};
    if (p.frequency && typeof p.frequency === 'object') {
      const freq = p.frequency as Record<string, unknown>;
      const period = String(freq.period ?? freq.frequency ?? 'monthly').toLowerCase();
      p.frequency = PERIODIC_FREQ_MAP[period] ?? 'monthly';
    } else if (p.frequency && typeof p.frequency === 'string') {
      const validPeriodicFreqs = new Set(['weekly', 'biweekly', 'monthly']);
      if (!validPeriodicFreqs.has(p.frequency as string)) {
        p.frequency = PERIODIC_FREQ_MAP[(p.frequency as string).toLowerCase()] ?? 'monthly';
      }
    }
  }

  // Recurring: ensure required fields
  if (pattern.type === 'recurring') {
    if (!pattern.recurring) pattern.recurring = { fields: {}, schedule: { frequency: 'monthly' } };
    const r = pattern.recurring as Record<string, unknown>;
    if (!r.fields) r.fields = {};
    if (!r.schedule) r.schedule = { frequency: 'monthly' };
  }

  // Variable: ensure frequency and fix randomFields types
  if (pattern.type === 'variable') {
    if (!pattern.variable) {
      pattern.variable = { fields: {}, randomFields: {}, frequency: { min: 1, max: 5, period: 'week' } };
    }
    const v = pattern.variable as Record<string, unknown>;
    if (!v.fields) v.fields = {};
    if (!v.randomFields) v.randomFields = {};
    if (!v.frequency) {
      v.frequency = { min: 1, max: 5, period: 'week' };
    } else if (typeof v.frequency === 'string') {
      const f = (v.frequency as string).toLowerCase();
      v.frequency = { min: 1, max: 3, period: PERIODIC_FREQ_MAP[f] === 'monthly' ? 'month' : 'week' };
    }

    // Fix randomFields with invalid types
    if (v.randomFields && typeof v.randomFields === 'object') {
      for (const [field, spec] of Object.entries(v.randomFields as Record<string, unknown>)) {
        if (spec && typeof spec === 'object') {
          const s = spec as Record<string, unknown>;
          if (s.type && typeof s.type === 'string') {
            if (!VALID_RANDOM_TYPES.has(s.type)) {
              s.type = RANDOM_TYPE_MAP[s.type.toLowerCase()] ?? 'pick';
            }
          } else {
            s.type = 'pick';
          }
        } else {
          // Bare value — wrap into a pick spec
          (v.randomFields as Record<string, unknown>)[field] = { type: 'pick', values: [spec] };
        }
      }
    }
  }
}

/**
 * Convert archetype map entries from arrays to `{ count, archetypes }` format.
 * Works for both `apiEntityArchetypes` (nested: adapter → resource → value)
 * and `entityArchetypes` (flat: table → value).
 */
function normalizeArchetypeMap(obj: Record<string, unknown>, key: string, nested = false): void {
  const map = obj[key];
  if (!map || typeof map !== 'object') return;

  for (const [outerKey, outerValue] of Object.entries(map as Record<string, unknown>)) {
    if (Array.isArray(outerValue)) {
      // Array → convert to { count, archetypes }
      (map as Record<string, unknown>)[outerKey] = arrayToArchetypeConfig(outerValue, outerKey);
    } else if (outerValue && typeof outerValue === 'object') {
      const rec = outerValue as Record<string, unknown>;

      if (nested) {
        // Nested map (apiEntityArchetypes): adapter → resource → { count, archetypes }
        // If LLM put { count, archetypes } directly at adapter level, wrap under "default"
        if ('archetypes' in rec && ('count' in rec || Array.isArray(rec.archetypes))) {
          const wrapped = { count: rec.count ?? inferArchetypeCount(rec), archetypes: rec.archetypes };
          fixArchetypesField(wrapped as Record<string, unknown>);
          // Clear and replace with single-resource wrapper
          for (const k of Object.keys(rec)) delete rec[k];
          rec.default = wrapped;
        } else {
          // Process each resource entry
          for (const [resource, value] of Object.entries(rec)) {
            if (Array.isArray(value)) {
              rec[resource] = arrayToArchetypeConfig(value, resource);
            } else if (value && typeof value === 'object') {
              const inner = value as Record<string, unknown>;
              if ('archetypes' in inner) {
                if (!('count' in inner) || inner.count === undefined) {
                  inner.count = inferArchetypeCount(inner);
                }
                fixArchetypesField(inner);
              } else if (!('count' in inner)) {
                rec[resource] = {
                  count: 1,
                  archetypes: [{
                    label: `${resource}-1`,
                    weight: 1.0,
                    fields: inner,
                    vary: {},
                  }],
                };
              }
            }
          }
        }
      } else {
        // Flat map (entityArchetypes): table → { count, archetypes }
        if ('archetypes' in rec) {
          if (!('count' in rec) || rec.count === undefined) {
            rec.count = inferArchetypeCount(rec);
          }
          fixArchetypesField(rec);
        } else if (!('count' in rec)) {
          // Object without archetypes/count — wrap as single archetype
          (map as Record<string, unknown>)[outerKey] = {
            count: 1,
            archetypes: [{
              label: `${outerKey}-1`,
              weight: 1.0,
              fields: rec,
              vary: {},
            }],
          };
        }
      }
    }
  }
}

/**
 * Infer a reasonable `count` for an archetype config when the LLM omits it.
 * Sums up weights and uses a default of 10 entities per archetype group,
 * or uses an explicit `count` on individual archetypes if present.
 */
function inferArchetypeCount(config: Record<string, unknown>): number {
  const archetypes = config.archetypes;
  if (!Array.isArray(archetypes)) return 10;
  return Math.max(archetypes.length * 5, 10);
}

/** Convert archetypes from object-keyed form to array form, then fix vary fields */
function fixArchetypesField(config: Record<string, unknown>): void {
  const archetypes = config.archetypes;
  if (archetypes && typeof archetypes === 'object' && !Array.isArray(archetypes)) {
    // archetypes is { label: { fields... }, label2: { fields... } } → convert to array
    config.archetypes = Object.entries(archetypes as Record<string, unknown>).map(([label, value]) => {
      if (!value || typeof value !== 'object') {
        return { label, weight: 0.5, fields: value ?? {}, vary: {} };
      }
      const rec = value as Record<string, unknown>;
      return {
        label: rec.label ?? label,
        weight: rec.weight ?? 0.5,
        fields: rec.fields ?? Object.fromEntries(
          Object.entries(rec).filter(([k]) => !['label', 'weight', 'vary'].includes(k)),
        ),
        vary: rec.vary ?? {},
      };
    });
  }
  if (Array.isArray(config.archetypes)) {
    for (const arch of config.archetypes as Record<string, unknown>[]) {
      // Rename `name` → `label` when label is absent
      if (!arch.label && arch.name && typeof arch.name === 'string') {
        arch.label = arch.name;
        delete arch.name;
      }
      // Ensure label exists
      if (!arch.label) {
        arch.label = `archetype-${Math.random().toString(36).slice(2, 6)}`;
      }
      // Ensure weight exists
      if (arch.weight === undefined) {
        arch.weight = 1.0 / (config.archetypes as unknown[]).length;
      }
      // Ensure fields is an object
      if (!arch.fields || typeof arch.fields === 'string') {
        arch.fields = {};
      }
      // Ensure vary exists and normalize it
      if (!arch.vary) {
        arch.vary = {};
      }
      if (arch.vary && typeof arch.vary === 'object') {
        normalizeVaryFields(arch.vary as Record<string, unknown>);
      }
    }
  }
}

function arrayToArchetypeConfig(arr: unknown[], resourceName: string): { count: number; archetypes: unknown[] } {
  return {
    count: arr.length,
    archetypes: arr.map((item, idx) => {
      if (!item || typeof item !== 'object') {
        return { label: `${resourceName}-${idx + 1}`, weight: 1.0 / arr.length, fields: item ?? {}, vary: {} };
      }
      const rec = item as Record<string, unknown>;
      const vary = (rec.vary ?? {}) as Record<string, unknown>;
      if (typeof vary === 'object' && vary) normalizeVaryFields(vary);
      return {
        label: rec.label ?? `${resourceName}-${idx + 1}`,
        weight: rec.weight ?? 1.0 / arr.length,
        fields: Object.fromEntries(
          Object.entries(rec).filter(([k]) => k !== 'label' && k !== 'weight' && k !== 'vary'),
        ),
        vary,
      };
    }),
  };
}
