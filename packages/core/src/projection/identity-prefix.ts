/**
 * Surface-formatted identifier minting.
 *
 * V5 boundary (Phase 6 / Phase 7):
 *   - The identity planner owns canonical identity only — it reserves slots
 *     such as "this entity needs a Stripe customer ID" inside an
 *     `IdentityRecord`, without choosing the final string.
 *   - This module is the ONLY place where final surface identifiers are
 *     minted, as a pure deterministic function of `(IdentityRecord,
 *     ProjectorHints, personaIndex)`. Prefix logic (`cus_`, `sub_`,
 *     casing) lives here, never in the planner.
 *
 * Enforced by the import-lint rule added in Phase 13: nothing under
 * `planner/` may import from this file.
 */

/**
 * Compose a resource-level idPrefix with the persona namespace.
 *
 *   getPersonaIdPrefix("cus_", 1)  →  "cus_p1_"
 *   getPersonaIdPrefix("sub_", 2)  →  "sub_p2_"
 *
 * Single source of truth for the namespacing scheme. If the convention
 * ever changes (e.g. `p1_cus_NNN` instead of `cus_p1_NNN`), it changes
 * here and only here.
 */
export function getPersonaIdPrefix(
  resourceIdPrefix: string,
  personaIndex: number,
): string {
  return `${resourceIdPrefix}p${personaIndex}_`;
}
