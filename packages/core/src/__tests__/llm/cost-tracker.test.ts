import { describe, it, expect } from 'vitest';
import { CostTracker } from '../../llm/cost-tracker.js';

describe('CostTracker runtime billing', () => {
  it('charges full per-token pricing on the api runtime', () => {
    const tracker = new CostTracker();
    tracker.setPricing('test-model', { promptPer1k: 1, completionPer1k: 2 });
    const entry = tracker.record({
      label: 't',
      category: 'generation',
      model: 'test-model',
      promptTokens: 1000,
      completionTokens: 1000,
      runtime: 'api',
    });
    expect(entry.cost).toBe(3);
    expect(entry.imputedCost).toBe(3);
    expect(entry.runtime).toBe('api');
  });

  it('halves cost on the batch runtime but preserves imputedCost', () => {
    const tracker = new CostTracker();
    tracker.setPricing('test-model', { promptPer1k: 1, completionPer1k: 2 });
    const entry = tracker.record({
      label: 't',
      category: 'generation',
      model: 'test-model',
      promptTokens: 1000,
      completionTokens: 1000,
      runtime: 'batch',
    });
    expect(entry.cost).toBe(1.5);
    expect(entry.imputedCost).toBe(3);
  });

  it('zeroes cost on the claude-code runtime and tracks subscription savings via imputedCost', () => {
    const tracker = new CostTracker();
    tracker.setPricing('test-model', { promptPer1k: 1, completionPer1k: 2 });
    const entry = tracker.record({
      label: 't',
      category: 'generation',
      model: 'test-model',
      promptTokens: 1000,
      completionTokens: 1000,
      runtime: 'claude-code',
    });
    expect(entry.cost).toBe(0);
    expect(entry.imputedCost).toBe(3);
    expect(entry.runtime).toBe('claude-code');
  });

  it('defaults runtime to api when not specified (back-compat)', () => {
    const tracker = new CostTracker();
    tracker.setPricing('test-model', { promptPer1k: 1, completionPer1k: 2 });
    const entry = tracker.record({
      label: 't',
      category: 'generation',
      model: 'test-model',
      promptTokens: 1000,
      completionTokens: 1000,
    });
    expect(entry.runtime).toBe('api');
    expect(entry.cost).toBe(3);
  });

  it('summary reports imputedTotal so subscription savings are visible', () => {
    const tracker = new CostTracker();
    tracker.setPricing('test-model', { promptPer1k: 1, completionPer1k: 2 });
    tracker.record({
      label: 'a',
      category: 'generation',
      model: 'test-model',
      promptTokens: 1000,
      completionTokens: 1000,
      runtime: 'claude-code',
    });
    tracker.record({
      label: 'b',
      category: 'generation',
      model: 'test-model',
      promptTokens: 1000,
      completionTokens: 1000,
      runtime: 'claude-code',
    });
    const summary = tracker.getSummary();
    expect(summary.total).toBe(0);
    expect(summary.imputedTotal).toBe(6);
    expect(summary.generation).toBe(0);
  });
});
