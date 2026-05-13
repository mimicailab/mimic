import type { MimicConfig } from '../types/config.js';
import { LLMClient, type ILLMClient } from './client.js';
import { ClaudeCodeClient } from './claude-code-client.js';
import { providerConfigFromMimic } from './providers.js';
import { CostTracker, type LLMRuntime } from './cost-tracker.js';

/**
 * Build the LLM client that matches the resolved runtime.
 *
 *   'api'         (default) — direct HTTP via the AI SDK / native Anthropic
 *                 client. Per-token pricing.
 *   'claude-code' — proxied through the Claude Agent SDK. $0 marginal cost
 *                 when the user is on a Claude subscription; falls back to
 *                 per-token API billing otherwise.
 *   'batch'       — reserved for the upcoming BatchClient; currently routed
 *                 to the API client with a clear log so the runtime flag
 *                 doesn't break before that lands.
 */
export function createLLMClient(
  config: MimicConfig,
  costTracker: CostTracker,
  runtimeOverride?: LLMRuntime,
): ILLMClient {
  const runtime: LLMRuntime =
    runtimeOverride ?? ((config.llm as { runtime?: LLMRuntime }).runtime ?? 'api');

  switch (runtime) {
    case 'claude-code':
      return new ClaudeCodeClient(
        {
          model: config.llm.model,
          timeoutMs: config.llm.timeoutMs,
        },
        costTracker,
      );
    case 'batch':
      // Until BatchClient ships, fall through to the sync API client. The
      // CLI surfaces a warning so users aren't surprised when the bill
      // arrives at full price.
      return new LLMClient(providerConfigFromMimic(config), costTracker);
    case 'api':
    default:
      return new LLMClient(providerConfigFromMimic(config), costTracker);
  }
}

