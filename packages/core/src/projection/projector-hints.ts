/**
 * V5 — Projector hints.
 *
 * Read-only metadata each adapter contributes so the core projectors can
 * mint surface-formatted identifiers and default required fields without
 * inverting the dependency across 19 adapter packages.
 *
 * The shape is intentionally narrow:
 *   - `idPrefix` — vendor prefix prepended when minting an `id` field for
 *     a resource (e.g. `cus_`, `sub_`). Resolution order is per-resource
 *     first, then per-adapter default.
 *   - `requiredDefaults` — fallback values for required surface fields
 *     the canonical entity does not carry (e.g. `livemode: false` on
 *     Stripe).
 *   - `surface` — human-readable surface label for proof reports.
 *
 * Adapters declare their hints via the existing manifest's
 * `promptContext.idPrefix` and `resources.<r>.fields.id.idPrefix`. This
 * module exposes a single `getProjectorHints(adapterId)` accessor; the
 * core projection planner is the only intended caller.
 */

export interface ProjectorHints {
  /** Adapter identifier — matches the registry key. */
  adapterId: string;
  /** Default id prefix at the adapter level (when a resource has no override). */
  idPrefix?: string;
  /** Per-resource id prefix overrides (e.g. `customer: 'cus_'`, `subscription: 'sub_'`). */
  idPrefixes?: Record<string, string>;
  /**
   * Required surface field defaults the canonical entity does not carry.
   * Keyed by resource, then by field name.
   */
  requiredDefaults?: Record<string, Record<string, unknown>>;
  /** Human-readable surface label used in proof reports. */
  surface?: string;
}

/**
 * Default hints when an adapter has not declared anything. The core
 * projector falls back to a single-letter prefix derived from the
 * resource name (a 3-char slice, lowercased) so generated IDs remain
 * unique across resources without colliding with each other.
 */
export function defaultHints(adapterId: string): ProjectorHints {
  return { adapterId, idPrefix: undefined, idPrefixes: undefined, surface: adapterId };
}

let registry: Map<string, ProjectorHints> | undefined;

/**
 * Register a hints record for an adapter. Adapters call this from their
 * module-init code so the core projector can read the hints without
 * importing from the adapter package.
 */
export function registerProjectorHints(hints: ProjectorHints): void {
  if (!registry) registry = new Map();
  registry.set(hints.adapterId, hints);
}

/**
 * Look up hints for an adapter. Returns sensible defaults when nothing
 * is registered — projection is still deterministic, just less
 * vendor-specific.
 */
export function getProjectorHints(adapterId: string): ProjectorHints {
  return registry?.get(adapterId) ?? defaultHints(adapterId);
}

/** For tests: clear all registered hints. */
export function __resetProjectorHints(): void {
  registry = undefined;
}
