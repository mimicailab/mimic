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
        fields[fieldName] = fieldSpec.default;
      }
    }
  }

  return {
    label: dist.label,
    weight: dist.weight,
    fields,
    vary,
  };
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
  // ID field with prefix → sequence, namespaced by persona to prevent collisions
  if (spec.idPrefix) {
    const prefix = personaIndex != null
      ? `${spec.idPrefix}p${personaIndex}_`
      : spec.idPrefix;
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
    case 'currency_code':
      return spec.default ? null : { type: 'pick', values: ['usd', 'eur', 'gbp'] };
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
