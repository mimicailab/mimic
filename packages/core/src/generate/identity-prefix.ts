import type { PromptContext, AdapterResourceSpecs } from '../types/index.js';

/**
 * Compose a resource-level idPrefix with the persona namespace.
 *
 *   getPersonaIdPrefix("cus_", 1)  →  "cus_p1_"
 *   getPersonaIdPrefix("sub_", 2)  →  "sub_p2_"
 *
 * Single source of truth for both prompt construction and post-hoc validation.
 * If the convention ever changes (e.g. `p1_cus_NNN` instead of `cus_p1_NNN`),
 * it changes here and only here.
 */
export function getPersonaIdPrefix(
  resourceIdPrefix: string,
  personaIndex: number,
): string {
  return `${resourceIdPrefix}p${personaIndex}_`;
}

/**
 * Look up the raw idPrefix declared by an adapter for a specific resource type.
 *
 * Resolution order:
 *   1. ResourceSpec field-level prefix — preferred (per-resource granularity).
 *   2. PromptContext platform-level prefix — fallback for adapters without
 *      ResourceSpecs; treated as the "primary resource" prefix.
 *
 * Returns undefined when no prefix can be determined — caller decides whether
 * that's an error or a skip.
 */
export function getResourceIdPrefix(
  adapterId: string,
  resourceType: string,
  promptContexts?: Record<string, PromptContext>,
  resourceSpecs?: Record<string, AdapterResourceSpecs>,
): string | undefined {
  const fieldPrefix = resourceSpecs?.[adapterId]?.resources?.[resourceType]?.fields?.id?.idPrefix;
  if (fieldPrefix) return fieldPrefix;
  return promptContexts?.[adapterId]?.idPrefix;
}
