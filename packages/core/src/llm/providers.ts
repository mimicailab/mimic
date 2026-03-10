import type { LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { MimicConfig } from '../types/index.js';

// ---------------------------------------------------------------------------
// Provider types
// ---------------------------------------------------------------------------

export type LLMProviderName = 'anthropic' | 'openai' | 'xai' | 'ollama' | 'custom';

export interface ProviderConfig {
  provider: LLMProviderName;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  /** Request timeout in ms. Used by LLMClient for streamText/generateText. */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Known model pricing  (USD per 1 000 tokens as of 2025-05)
// ---------------------------------------------------------------------------

export interface ModelPricing {
  promptPer1k: number;
  completionPer1k: number;
}

const PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-sonnet-4-20250514':      { promptPer1k: 0.003,   completionPer1k: 0.015 },
  'claude-sonnet-4-5-20250514':    { promptPer1k: 0.003,   completionPer1k: 0.015 },
  'claude-haiku-4-5':              { promptPer1k: 0.0008,  completionPer1k: 0.004 },
  'claude-haiku-4-5-20250414':     { promptPer1k: 0.0008,  completionPer1k: 0.004 },
  'claude-opus-4-20250514':        { promptPer1k: 0.015,   completionPer1k: 0.075 },

  // OpenAI
  'gpt-4o':                        { promptPer1k: 0.0025,  completionPer1k: 0.01  },
  'gpt-4o-mini':                   { promptPer1k: 0.00015, completionPer1k: 0.0006 },
  'gpt-4.1':                       { promptPer1k: 0.002,   completionPer1k: 0.008 },
  'gpt-4.1-mini':                  { promptPer1k: 0.0004,  completionPer1k: 0.0016 },
  'gpt-4.1-nano':                  { promptPer1k: 0.0001,  completionPer1k: 0.0004 },
  'gpt-5-mini-2025-08-07':         { promptPer1k: 0.0004,  completionPer1k: 0.0016 },
  'o3-mini':                       { promptPer1k: 0.00115, completionPer1k: 0.0044 },

  // xAI (Grok)
  'grok-3':                        { promptPer1k: 0.003,  completionPer1k: 0.015 },
  'grok-3-mini':                   { promptPer1k: 0.0003, completionPer1k: 0.0005 },
  'grok-3-fast':                   { promptPer1k: 0.005,  completionPer1k: 0.025 },

  // Ollama / local — zero cost
  'llama3':                        { promptPer1k: 0, completionPer1k: 0 },
  'mistral':                       { promptPer1k: 0, completionPer1k: 0 },
  'codellama':                     { promptPer1k: 0, completionPer1k: 0 },
};

/**
 * Look up the pricing for a model.  Falls back to zero for unknown models
 * (e.g. self-hosted Ollama).
 */
export function getModelPricing(model: string): ModelPricing {
  return PRICING[model] ?? { promptPer1k: 0, completionPer1k: 0 };
}

// ---------------------------------------------------------------------------
// Provider factory – returns a Vercel AI SDK LanguageModel
// ---------------------------------------------------------------------------

/**
 * Create a Vercel AI SDK language-model instance from the Mimic LLM config.
 */
export function createProvider(config: ProviderConfig): LanguageModel {
  const { provider, model, apiKey, baseUrl } = config;

  switch (provider) {
    case 'anthropic': {
      const anthropic = createAnthropic({
        ...(apiKey ? { apiKey } : {}),
        ...(baseUrl ? { baseURL: baseUrl } : {}),
      });
      return anthropic(model);
    }

    case 'openai': {
      const openai = createOpenAI({
        ...(apiKey ? { apiKey } : {}),
        ...(baseUrl ? { baseURL: baseUrl } : {}),
      });
      return openai(model);
    }

    case 'xai': {
      const xai = createOpenAI({
        baseURL: baseUrl ?? 'https://api.x.ai/v1',
        ...(apiKey ? { apiKey } : {}),
      });
      return xai(model);
    }

    case 'ollama': {
      const ollama = createOpenAI({
        baseURL: baseUrl ?? 'http://localhost:11434/v1',
        apiKey: apiKey ?? 'ollama', // Ollama ignores the key but the SDK requires one
      });
      return ollama(model);
    }

    case 'custom': {
      if (!baseUrl) {
        throw new Error(
          'Custom provider requires a baseUrl in llm config',
        );
      }
      const custom = createOpenAI({
        baseURL: baseUrl,
        ...(apiKey ? { apiKey } : {}),
      });
      return custom(model);
    }

    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown LLM provider: ${_exhaustive}`);
    }
  }
}

/**
 * Convenience: derive a ProviderConfig from MimicConfig.
 */
export function providerConfigFromMimic(config: MimicConfig): ProviderConfig {
  return {
    provider: config.llm.provider as LLMProviderName,
    model: config.llm.model,
    apiKey: config.llm.apiKey,
    baseUrl: config.llm.baseUrl,
    timeoutMs: config.llm.timeoutMs,
  };
}
