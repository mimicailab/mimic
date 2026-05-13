import { getModelPricing, type ModelPricing } from './providers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CostCategory = 'generation' | 'evaluation' | 'other';

/**
 * Which runtime produced a call. Drives how `cost` is computed:
 *   - 'api'         per-token pricing from the provider table
 *   - 'batch'       per-token pricing × 0.5 (Anthropic/OpenAI batch discount)
 *   - 'claude-code' $0 — billed against the user's Claude subscription, not
 *                   per-token. Token counts are still recorded and
 *                   `imputedCost` shows what the API would have charged.
 */
export type LLMRuntime = 'api' | 'batch' | 'claude-code';

export interface TokenUsageEntry {
  label: string;
  category: CostCategory;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** Actual dollar cost for this call (0 when runtime === 'claude-code'). */
  cost: number;
  /**
   * What this call would have cost on per-token API pricing. Equal to `cost`
   * for the 'api' runtime; populated for 'claude-code' so the summary can
   * show subscription savings.
   */
  imputedCost: number;
  runtime: LLMRuntime;
  timestamp: Date;
}

export interface CostSummary {
  generation: number;
  evaluation: number;
  total: number;
  /** Sum of imputedCost across all entries — the equivalent API-pricing total. */
  imputedTotal: number;
  entries: TokenUsageEntry[];
  totalPromptTokens: number;
  totalCompletionTokens: number;
}

// ---------------------------------------------------------------------------
// CostTracker
// ---------------------------------------------------------------------------

/**
 * Accumulates per-call token usage and computes dollar costs using known
 * model pricing.  Thread-safe in the single-threaded Node sense (no shared
 * mutable state across workers).
 */
export class CostTracker {
  private readonly entries: TokenUsageEntry[] = [];
  private readonly pricingOverrides: Map<string, ModelPricing> = new Map();

  /**
   * Optionally inject pricing overrides for testing or custom models.
   */
  setPricing(model: string, pricing: ModelPricing): void {
    this.pricingOverrides.set(model, pricing);
  }

  /**
   * Record a single LLM call's token usage.
   *
   * `runtime` defaults to 'api' for backwards-compatibility with callers that
   * predate the multi-runtime split; 'batch' applies a 50% discount and
   * 'claude-code' zeroes the actual charge while still tracking the imputed
   * per-token cost.
   */
  record(opts: {
    label: string;
    category: CostCategory;
    model: string;
    promptTokens: number;
    completionTokens: number;
    runtime?: LLMRuntime;
  }): TokenUsageEntry {
    const pricing =
      this.pricingOverrides.get(opts.model) ?? getModelPricing(opts.model);

    const imputedCost =
      (opts.promptTokens / 1_000) * pricing.promptPer1k +
      (opts.completionTokens / 1_000) * pricing.completionPer1k;

    const runtime = opts.runtime ?? 'api';
    const actualCost =
      runtime === 'claude-code' ? 0 :
      runtime === 'batch' ? imputedCost * 0.5 :
      imputedCost;

    const entry: TokenUsageEntry = {
      label: opts.label,
      category: opts.category,
      model: opts.model,
      promptTokens: opts.promptTokens,
      completionTokens: opts.completionTokens,
      cost: round6(actualCost),
      imputedCost: round6(imputedCost),
      runtime,
      timestamp: new Date(),
    };

    this.entries.push(entry);
    return entry;
  }

  /**
   * Return an aggregated cost summary broken out by category.
   */
  getSummary(): CostSummary {
    let generation = 0;
    let evaluation = 0;
    let imputedTotal = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    for (const e of this.entries) {
      totalPromptTokens += e.promptTokens;
      totalCompletionTokens += e.completionTokens;
      imputedTotal += e.imputedCost;

      switch (e.category) {
        case 'generation':
          generation += e.cost;
          break;
        case 'evaluation':
          evaluation += e.cost;
          break;
        default:
          // 'other' counts towards total only
          break;
      }
    }

    const total = this.entries.reduce((sum, e) => sum + e.cost, 0);

    return {
      generation: round6(generation),
      evaluation: round6(evaluation),
      total: round6(total),
      imputedTotal: round6(imputedTotal),
      entries: [...this.entries],
      totalPromptTokens,
      totalCompletionTokens,
    };
  }

  /**
   * Reset all tracked entries (useful between test runs).
   */
  reset(): void {
    this.entries.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
