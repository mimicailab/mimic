/**
 * Surface-formatted identifier minting.
 *
 * Moved from `generate/identity-prefix.ts` as part of the V5 rebuild.
 *
 * V5 boundary (Phase 6 / Phase 7):
 *   - The identity planner owns canonical identity only — it reserves slots
 *     such as "this entity needs a Stripe customer ID" inside an
 *     `IdentityRecord`, without choosing the final string.
 *   - This module is the ONLY place where final surface identifiers are
 *     minted, as a pure deterministic function of `(IdentityRecord,
 *     ProjectorHints)`. Prefix logic (`cus_`, `sub_`, casing) lives here,
 *     never in the planner.
 *
 * Enforced by the import-lint rule added in Phase 13: nothing under
 * `planner/` may import from this file.
 */
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
