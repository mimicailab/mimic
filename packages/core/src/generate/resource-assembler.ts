import type {
  AdapterResourceSpecs,
  ResourceSpec,
  ResourceFieldSpec,
  EntityArchetypeConfig,
  EntityArchetype,
  FieldVariation,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArchetypeDistribution {
  label: string;
  weight: number;
  fieldOverrides?: Record<string, unknown>;
  /** Per-archetype vary specs from the LLM — override assembler defaults */
  vary?: Record<string, Record<string, unknown>>;
  /**
   * When true, entities of this archetype have no DB counterpart. The
   * expander emits them into API responses but skips DB row creation,
   * producing deliberate cross-platform asymmetry.
   */
  apiOnly?: boolean;
  /**
   * Explicit row count for this archetype. Required when weight is 0 and the
   * archetype is not anchor-bound. For apiOnly archetypes, additive on top of
   * the matched count. For anchor-bound archetypes, defaults to 1 if omitted.
   */
  count?: number;
  /**
   * Anchor id this archetype is bound to. Causes the archetype to emit
   * exactly `count` rows tied to the resolved anchor. Used for persona events
   * declared in `data.anchors`.
   */
  anchor?: string;
  /**
   * Claim ids (from data.claims) this archetype is responsible for satisfying.
   * Propagated onto the assembled EntityArchetype so the auditor can map a
   * failed claim back to the archetypes that promised to satisfy it.
   */
  cites?: string[];
}

export interface ResourceDistribution {
  count: number;
  archetypes: ArchetypeDistribution[];
}

export interface DistributionOutput {
  [resourceType: string]: ResourceDistribution;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AssembleOptions {
  /**
   * 1-based persona index for ID namespacing. When set, all sequence
   * prefixes are expanded with `p{index}_` to prevent multi-persona
   * collisions (e.g. `cus_` → `cus_p1_`).
   */
  personaIndex?: number;
}

/**
 * Deterministically assemble EntityArchetypeConfig from ResourceSpec +
 * LLM-generated ResourceDistribution.
 *
 * The LLM provides:
 *  - count: how many entities to generate
 *  - archetypes: labels + weights + field overrides + optional vary specs
 *
 * The assembler fills in ALL structural fields from ResourceSpec:
 *  - Required fields with defaults → goes into archetype `fields`
 *  - ID fields with prefixes → gets `sequence` variation (with persona namespace)
 *  - Timestamp fields → gets `timestamp` variation
 *  - Amount fields → gets `range` variation
 *  - Email fields → gets `email` variation
 *  - etc.
 *
 * LLM vary specs take precedence over assembler-derived variations,
 * allowing the LLM to express opinions like "amount should range 500-2000".
 *
 * The result is a valid EntityArchetypeConfig ready for the expander.
 */
export function assembleResourceArchetypes(
  specs: AdapterResourceSpecs,
  distributions: DistributionOutput,
  options?: AssembleOptions,
): Record<string, EntityArchetypeConfig> {
  const result: Record<string, EntityArchetypeConfig> = {};
  const personaIndex = options?.personaIndex;

  // Build a lookup from objectType → spec key for plural/singular resolution.
  // The LLM may return "charges" but the spec key is "charge".
  const specByObjectType = new Map<string, [string, ResourceSpec]>();
  for (const [key, spec] of Object.entries(specs.resources)) {
    if (spec.objectType) {
      specByObjectType.set(spec.objectType, [key, spec]);
    }
    specByObjectType.set(key, [key, spec]);
  }

  const assembled = new Set<string>();

  for (const [resourceType, distribution] of Object.entries(distributions)) {
    const resolved = resolveSpecKey(resourceType, specs, specByObjectType);
    if (!resolved) continue;

    const [specKey, spec] = resolved;
    assembled.add(specKey);

    const archetypes = distribution.archetypes.map(dist =>
      buildArchetype(spec, dist, personaIndex, specs),
    );

    result[specKey] = {
      count: distribution.count,
      archetypes,
    };
  }

  // Backfill: ensure every resource in the spec gets at least some data.
  // The LLM may skip resources it deems irrelevant, but mock endpoints
  // need data for all resource types to be useful.
  for (const [specKey, spec] of Object.entries(specs.resources)) {
    if (assembled.has(specKey)) continue;

    const defaultCount = spec.volumeHint === 'entity' ? 5 : 2;
    const defaultArchetype: ArchetypeDistribution = {
      label: 'default',
      weight: 1.0,
    };

    result[specKey] = {
      count: defaultCount,
      archetypes: [buildArchetype(spec, defaultArchetype, personaIndex, specs)],
    };
  }

  return result;
}

/**
 * Resolve a distribution key (which may be plural, e.g. "charges") to the
 * matching spec key (singular, e.g. "charge"). Tries in order:
 *   1. Exact match
 *   2. Singularized (strip trailing "s" or "es")
 *   3. Match by objectType
 */
function resolveSpecKey(
  key: string,
  specs: AdapterResourceSpecs,
  byObjectType: Map<string, [string, ResourceSpec]>,
): [string, ResourceSpec] | undefined {
  if (specs.resources[key]) {
    return [key, specs.resources[key]];
  }

  // Try singularizing common English plurals
  const singular = key.endsWith('ies')
    ? key.slice(0, -3) + 'y'
    : key.endsWith('ses') || key.endsWith('zes') || key.endsWith('xes')
      ? key.slice(0, -2)
      : key.endsWith('s')
        ? key.slice(0, -1)
        : key;

  if (singular !== key && specs.resources[singular]) {
    return [singular, specs.resources[singular]];
  }

  // Try objectType lookup
  return byObjectType.get(key) ?? byObjectType.get(singular);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildArchetype(
  spec: ResourceSpec,
  dist: ArchetypeDistribution,
  personaIndex?: number,
  allSpecs?: AdapterResourceSpecs,
): EntityArchetype {
  const fields: Record<string, unknown> = {};
  const vary: Record<string, FieldVariation> = {};

  // Separate nested-path overrides from top-level overrides. Nested paths
  // like "unit_price.amount" are applied after the top-level field is
  // populated (either from override, default, or assembler derivation),
  // so they can target the resulting object.
  const nestedOverrides: Array<{ topKey: string; rest: string; value: unknown }> = [];
  if (dist.fieldOverrides) {
    for (const [path, value] of Object.entries(dist.fieldOverrides)) {
      const dot = path.indexOf('.');
      if (dot > 0) {
        nestedOverrides.push({
          topKey: path.slice(0, dot),
          rest: path.slice(dot + 1),
          value,
        });
      }
    }
  }

  for (const [fieldName, fieldSpec] of Object.entries(spec.fields)) {
    if (fieldSpec.auto && isExpanderAutoField(fieldName)) continue;

    const overrideValue = dist.fieldOverrides?.[fieldName];

    // Per-archetype LLM vary spec takes precedence over assembler derivation
    const llmVary = dist.vary?.[fieldName] as FieldVariation | undefined;

    // For ref fields, ignore null/empty LLM overrides — the cross-reference
    // resolver handles these fields and needs gen_* placeholders to work.
    const isRefNulledByLlm = fieldSpec.ref && (overrideValue === null || overrideValue === '');
    const effectiveOverride = isRefNulledByLlm ? undefined : overrideValue;

    if (effectiveOverride !== undefined) {
      fields[fieldName] = effectiveOverride;
    } else if (llmVary) {
      vary[fieldName] = llmVary;
    } else {
      const variation = deriveVariation(fieldName, fieldSpec, spec, personaIndex, allSpecs);
      if (variation) {
        vary[fieldName] = variation;
      } else if (fieldSpec.default !== undefined) {
        // Object/array defaults are shared by reference across archetypes —
        // clone so a nested-path override on one archetype doesn't bleed
        // into the others.
        fields[fieldName] = cloneDeep(fieldSpec.default);
      }
    }
  }

  // Apply nested-path overrides (e.g. "unit_price.amount" → 2900). These
  // mutate the object value the assembler stamped from the default, giving
  // the LLM a way to pin nested-object amount/currency fields that the
  // string-only fieldOverrides channel can't otherwise reach.
  for (const { topKey, rest, value } of nestedOverrides) {
    if (fields[topKey] == null || typeof fields[topKey] !== 'object') {
      fields[topKey] = {};
    }
    setNestedField(fields[topKey] as Record<string, unknown>, rest, value);
  }

  return {
    label: dist.label,
    weight: dist.weight,
    fields,
    vary,
    ...(dist.apiOnly ? { apiOnly: true } : {}),
    ...(dist.count !== undefined ? { count: dist.count } : {}),
    ...(dist.anchor ? { anchor: dist.anchor } : {}),
    ...(dist.cites && dist.cites.length > 0 ? { cites: dist.cites } : {}),
  };
}

function cloneDeep<T>(v: T): T {
  if (v == null || typeof v !== 'object') return v;
  return JSON.parse(JSON.stringify(v));
}

function setNestedField(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

/**
 * Only these field names are reliably auto-filled by the expander.
 * Skipping any other auto field would produce incomplete archetypes.
 */
function isExpanderAutoField(fieldName: string): boolean {
  return fieldName === 'created' || fieldName === 'created_at' || fieldName === 'updated_at';
}

function deriveVariation(
  fieldName: string,
  spec: ResourceFieldSpec,
  resource: ResourceSpec,
  personaIndex?: number,
  allSpecs?: AdapterResourceSpecs,
): FieldVariation | null {
  // ID field with prefix → sequence, namespaced by persona to prevent collisions.
  // When idPrefix is defined (even as empty string), treat it as an ID field.
  // Use objectType as fallback prefix so adapters without conventional prefixes
  // (e.g. Chargebee, Zuora) still get unique IDs.
  if (spec.idPrefix !== undefined) {
    const basePrefix = spec.idPrefix || `${resource.objectType}_`;
    const prefix = personaIndex != null
      ? `${basePrefix}p${personaIndex}_`
      : basePrefix;
    return { type: 'sequence', prefix };
  }

  // Timestamp field → timestamp variation
  if (spec.timestamp) {
    return { type: 'timestamp' };
  }

  // Amount field → range variation with sensible defaults
  if (spec.isAmount) {
    return { type: 'range', min: 100, max: 99999 };
  }

  // Enum field → pick variation
  if (spec.enum && spec.enum.length > 0) {
    return { type: 'pick', values: spec.enum };
  }

  // Ref field → generate `gen_*` placeholder that the expander's
  // cross-reference resolver will replace with real IDs from the pool.
  // Generate for ALL ref fields regardless of required/nullable — realistic
  // mock data needs relationships populated. The resolver's cleanup pass
  // will null out any unresolved placeholders for truly optional refs.
  if (spec.ref) {
    return { type: 'sequence', prefix: `gen_${spec.ref}_` };
  }

  // Semantic type derivations
  switch (spec.semanticType) {
    case 'email':
      return { type: 'email' };
    case 'url':
      return null;
    case 'phone':
      return { type: 'phone' };
    case 'uuid':
      return { type: 'uuid' };
    case 'currency_code': {
      // Always emit a pick. Previously this was gated on `!spec.default`,
      // which silently stamped the spec default (e.g. "AUD" for GoCardless,
      // "USD" for Paddle) onto every archetype the LLM didn't explicitly
      // override — defeating persona-level invariants like "UK business →
      // GBP". The auditor's pinned_field claim now catches violations, but
      // emitting a real variation lets the assembler honor enum-aware
      // picks where available.
      const enumValues = spec.enum && spec.enum.length > 0
        ? spec.enum.map((v) => String(v).toLowerCase())
        : ['usd', 'eur', 'gbp'];
      return { type: 'pick', values: enumValues };
    }
    case 'country_code':
      return { type: 'pick', values: ['US', 'GB', 'DE', 'FR', 'CA', 'AU'] };
    default:
      break;
  }

  // String fields that look like names
  if (spec.type === 'string' && !spec.nullable) {
    if (fieldName === 'name') {
      return { type: 'fullName' };
    }
    if (fieldName === 'email') {
      return { type: 'email' };
    }
    if (fieldName === 'first_name') {
      return { type: 'firstName' };
    }
    if (fieldName === 'last_name') {
      return { type: 'lastName' };
    }
    if (fieldName === 'company' || fieldName === 'company_name') {
      return { type: 'companyName' };
    }
    if (fieldName === 'phone') {
      return { type: 'phone' };
    }
  }

  return null;
}
