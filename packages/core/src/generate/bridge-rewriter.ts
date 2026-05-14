/**
 * Bridge rewriter — normalizes Phase 1 output so the LLM's bridge-table
 * compliance becomes irrelevant.
 *
 * The "bridge-table doubling" failure mode (the recurring v3-v6 bug):
 *   1. Phase 1 LLM emits DB archetypes on a bridge table like `users` with
 *      `fields.billing_platform = "stripe"` (because the LLM ignored the
 *      bridge-table rule in the system prompt).
 *   2. Engine's `extractIdentityEntityCounts` Path A also picks up the claim
 *      `db.users where billing_platform=stripe = 1200` and locks
 *      `stripe.customer = 1200` on the API side.
 *   3. Mirror flow generates 1200 API customers → 1200 DB user rows tagged
 *      `billing_platform=stripe`.
 *   4. The DB archetypes ALSO expand directly into ~1200 rows.
 *   5. Net: ~2400 rows tagged `billing_platform=stripe`. Audit fails.
 *
 * Architectural fix: the LLM's structural decision is bypassed. The rewriter:
 *   - Strips DB archetypes whose `fields.billing_platform` matches a known
 *     adapter that mirrors into this bridge table. The mirror flow generates
 *     those rows.
 *   - Rewrites claims of the form `{surface:'db', name:<bridge>, filter:{billing_platform:X}}`
 *     to `{surface:'api', name:'<X>.<resource>'}` so the auditor and engine
 *     agree on what's being counted.
 *
 * What survives:
 *   - DB archetypes on bridge tables that do NOT have `billing_platform=<adapter>`
 *     in their fields (e.g. `free-tier` users, `orphan-paid-no-billing`).
 *     These are legitimately DB-only and not mirrored.
 *   - Claims on DB targets without a platform filter (these run against the
 *     post-mirror DB state and check cross-cutting attributes).
 *
 * Pure function over `Blueprint`. Returns a new blueprint.
 */

import type { Blueprint, EntityArchetypeConfig, SchemaMapping } from '../types/blueprint.js';
import type { Claim, ResourceTarget } from '../types/claim.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BridgeRewriteResult {
  blueprint: Blueprint;
  /** Archetypes removed because they would double-count via mirror flow */
  strippedArchetypes: Array<{
    table: string;
    label: string;
    reason: string;
  }>;
  /** Claims rewritten from db.<bridge> to api.<adapter>.<resource> */
  rewrittenClaims: Array<{
    claimId: string;
    from: ResourceTarget;
    to: ResourceTarget;
  }>;
}

/**
 * Apply bridge-table rewrites to a blueprint. Idempotent.
 *
 * @param blueprint Original Phase 1 blueprint (not mutated; result is a new object)
 * @param schemaMapping LLM-derived schema mapping that names bridge tables
 *                       and maps DB tables to API (adapter, resource) pairs
 */
export function rewriteBridgeTables(
  blueprint: Blueprint,
  schemaMapping: SchemaMapping | undefined,
): BridgeRewriteResult {
  const strippedArchetypes: BridgeRewriteResult['strippedArchetypes'] = [];
  const rewrittenClaims: BridgeRewriteResult['rewrittenClaims'] = [];

  if (!schemaMapping || schemaMapping.bridgeTables.length === 0) {
    return { blueprint, strippedArchetypes, rewrittenClaims };
  }

  // Build adapter → resource lookup per bridge table.
  // For "users" → { stripe: "customer", paddle: "customer", ... }
  const bridgeAdapterResources = buildBridgeAdapterMap(schemaMapping);

  // Clone the blueprint shallowly — we'll replace the data subtree.
  const next: Blueprint = {
    ...blueprint,
    data: {
      ...blueprint.data,
      entityArchetypes: blueprint.data.entityArchetypes
        ? { ...blueprint.data.entityArchetypes }
        : undefined,
      claims: blueprint.data.claims ? [...blueprint.data.claims] : undefined,
    },
  };

  // ── Step 1: strip DB archetypes on bridge tables with billing_platform=<adapter> ──
  for (const bridgeTable of schemaMapping.bridgeTables) {
    const config = next.data.entityArchetypes?.[bridgeTable];
    if (!config) continue;

    const adapterMap = bridgeAdapterResources.get(bridgeTable);
    if (!adapterMap || adapterMap.size === 0) continue;

    const remaining: EntityArchetypeConfig['archetypes'] = [];
    for (const archetype of config.archetypes) {
      const platform = archetype.fields['billing_platform'];
      const externalId = archetype.fields['external_id'];
      if (typeof platform === 'string' && adapterMap.has(platform)) {
        strippedArchetypes.push({
          table: bridgeTable,
          label: archetype.label,
          reason: `bridge-table archetype with billing_platform="${platform}" — mirror flow generates these rows`,
        });
        continue; // strip
      }
      if (typeof externalId === 'string' && externalId.trim().length > 0) {
        strippedArchetypes.push({
          table: bridgeTable,
          label: archetype.label,
          reason: 'bridge-table archetype with explicit external_id — mirror flow owns API identity on bridge tables',
        });
        continue; // strip
      }
      remaining.push(archetype);
    }

    // Replace the config (preserve count for the residual archetypes)
    next.data.entityArchetypes![bridgeTable] = {
      ...config,
      archetypes: remaining,
    };
  }

  // ── Step 2: rewrite claims targeting db.<bridge> where billing_platform=<X> ──
  if (next.data.claims) {
    next.data.claims = next.data.claims.map((claim) => {
      if (claim.target.surface !== 'db') return claim;
      if (!schemaMapping.bridgeTables.includes(claim.target.name)) return claim;

      const adapterMap = bridgeAdapterResources.get(claim.target.name);
      if (!adapterMap) return claim;

      const filter = claim.target.filter;
      const platformVal = filter?.['billing_platform'];

      // Only rewrite when the filter pins a single platform (eq).
      let platform: string | undefined;
      if (typeof platformVal === 'string') platform = platformVal;
      else if (
        platformVal != null &&
        typeof platformVal === 'object' &&
        !Array.isArray(platformVal) &&
        'eq' in (platformVal as Record<string, unknown>) &&
        typeof (platformVal as { eq: unknown }).eq === 'string'
      ) {
        platform = (platformVal as { eq: string }).eq;
      }

      if (!platform) return claim; // e.g. {billing_platform: {is_null: true}} — keep on DB

      const resource = adapterMap.get(platform);
      if (!resource) return claim;

      // Strip the platform filter; preserve any other filter conditions.
      const restFilter: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(filter ?? {})) {
        if (k !== 'billing_platform') restFilter[k] = v;
      }

      const newTarget: ResourceTarget = {
        surface: 'api',
        name: `${platform}.${resource}`,
        ...(Object.keys(restFilter).length > 0 ? { filter: restFilter } : {}),
      };

      rewrittenClaims.push({
        claimId: claim.id,
        from: claim.target,
        to: newTarget,
      });

      return { ...claim, target: newTarget } as Claim;
    });
  }

  return { blueprint: next, strippedArchetypes, rewrittenClaims };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a map of bridgeTable → adapter → resource using SchemaMapping.
 * For each bridge table, lists every (adapter, resource) that maps into it,
 * so we know which `billing_platform` values are "mirror-managed."
 */
function buildBridgeAdapterMap(
  schemaMapping: SchemaMapping,
): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const entry of schemaMapping.mappings) {
    if (!schemaMapping.bridgeTables.includes(entry.dbTable)) continue;
    // Only consider id-mapping rows so we get one representative resource per
    // adapter (avoids duplicates from non-id field mappings).
    if (entry.apiField !== 'id') continue;
    let table = out.get(entry.dbTable);
    if (!table) {
      table = new Map();
      out.set(entry.dbTable, table);
    }
    // First-write wins; multiple id mappings per (table, adapter) shouldn't
    // happen but if they do we keep the earliest.
    if (!table.has(entry.adapterId)) {
      table.set(entry.adapterId, entry.apiResource);
    }
  }
  return out;
}

/**
 * Rewrite claims standalone (no blueprint context). Used in V2's claim-
 * extraction phase, BEFORE per-slot content generation runs and BEFORE the
 * full blueprint exists. Returns a new `Claim[]` plus the list of rewrites.
 *
 * Same logic as `rewriteBridgeTables` Step 2; factored out so the V2
 * pipeline can route claims to the API surface earlier (topology slot
 * derivation needs the post-rewrite targets to attach claims to slots).
 */
export function rewriteClaimsForBridges(
  claims: readonly Claim[],
  schemaMapping: SchemaMapping | undefined,
): {
  claims: Claim[];
  rewritten: Array<{ claimId: string; from: ResourceTarget; to: ResourceTarget }>;
} {
  if (!schemaMapping || schemaMapping.bridgeTables.length === 0) {
    return { claims: [...claims], rewritten: [] };
  }
  const adapterMap = buildBridgeAdapterMap(schemaMapping);
  const rewritten: Array<{ claimId: string; from: ResourceTarget; to: ResourceTarget }> = [];

  const out: Claim[] = claims.map((claim) => {
    if (claim.target.surface !== 'db') return claim;
    if (!schemaMapping.bridgeTables.includes(claim.target.name)) return claim;
    const adapterResources = adapterMap.get(claim.target.name);
    if (!adapterResources) return claim;

    const filter = claim.target.filter;
    const platformVal = filter?.['billing_platform'];

    let platform: string | undefined;
    if (typeof platformVal === 'string') {
      platform = platformVal;
    } else if (
      platformVal != null &&
      typeof platformVal === 'object' &&
      !Array.isArray(platformVal) &&
      'eq' in (platformVal as Record<string, unknown>) &&
      typeof (platformVal as { eq: unknown }).eq === 'string'
    ) {
      platform = (platformVal as { eq: string }).eq;
    }

    if (!platform) return claim;
    const resource = adapterResources.get(platform);
    if (!resource) return claim;

    const restFilter: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(filter ?? {})) {
      if (k !== 'billing_platform') restFilter[k] = v;
    }
    const newTarget: ResourceTarget = {
      surface: 'api',
      name: `${platform}.${resource}`,
      ...(Object.keys(restFilter).length > 0 ? { filter: restFilter } : {}),
    };
    rewritten.push({ claimId: claim.id, from: claim.target, to: newTarget });
    return { ...claim, target: newTarget } as Claim;
  });

  return { claims: out, rewritten };
}

/**
 * Format a rewrite result for logging. Returns "" when nothing changed.
 */
export function formatBridgeRewrite(result: BridgeRewriteResult): string {
  if (result.strippedArchetypes.length === 0 && result.rewrittenClaims.length === 0) {
    return '';
  }
  const lines: string[] = [];
  if (result.strippedArchetypes.length > 0) {
    lines.push(
      `Stripped ${result.strippedArchetypes.length} bridge-table archetype${result.strippedArchetypes.length === 1 ? '' : 's'} (mirror flow will produce these rows):`,
    );
    for (const s of result.strippedArchetypes) {
      lines.push(`  - ${s.table}[${s.label}]: ${s.reason}`);
    }
  }
  if (result.rewrittenClaims.length > 0) {
    lines.push(
      `Rewrote ${result.rewrittenClaims.length} bridge-table claim${result.rewrittenClaims.length === 1 ? '' : 's'} to API surface:`,
    );
    for (const r of result.rewrittenClaims) {
      lines.push(
        `  - ${r.claimId}: ${r.from.surface}.${r.from.name} → ${r.to.surface}.${r.to.name}`,
      );
    }
  }
  return lines.join('\n');
}
