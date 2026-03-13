import type { MimicConfig } from '../types/config.js';

export const DEFAULT_LLM: MimicConfig['llm'] = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
};

export const DEFAULT_GENERATE: MimicConfig['generate'] = {
  volume: '6 months',
  seed: 42,
  adapterBatchSize: 2,
  adapterBatchConcurrency: 4,
};

export const DEFAULT_TEST_MODE = 'text' as const;
export const DEFAULT_EVALUATOR = 'both' as const;
export const DEFAULT_SEED_STRATEGY = 'truncate-and-insert' as const;
