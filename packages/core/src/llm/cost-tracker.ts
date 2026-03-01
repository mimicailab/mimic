import { getModelPricing, type ModelPricing } from './providers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CostCategory = 'generation' | 'evaluation' | 'other';

export interface TokenUsageEntry {
  label: string;
  category: CostCategory;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  timestamp: Date;
}

export interface CostSummary {
  generation: number;
  evaluation: number;
  total: number;
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
   */
  record(opts: {
    label: string;
    category: CostCategory;
    model: string;
    promptTokens: number;
    completionTokens: number;
  }): TokenUsageEntry {
    const pricing =
      this.pricingOverrides.get(opts.model) ?? getModelPricing(opts.model);

    const cost =
      (opts.promptTokens / 1_000) * pricing.promptPer1k +
      (opts.completionTokens / 1_000) * pricing.completionPer1k;

    const entry: TokenUsageEntry = {
      label: opts.label,
      category: opts.category,
      model: opts.model,
      promptTokens: opts.promptTokens,
      completionTokens: opts.completionTokens,
      cost: Math.round(cost * 1_000_000) / 1_000_000, // 6dp precision
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
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    for (const e of this.entries) {
      totalPromptTokens += e.promptTokens;
      totalCompletionTokens += e.completionTokens;

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
