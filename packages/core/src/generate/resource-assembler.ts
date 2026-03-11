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

  for (const [resourceType, distribution] of Object.entries(distributions)) {
    const spec = specs.resources[resourceType];
    if (!spec) continue;

    const archetypes = distribution.archetypes.map(dist =>
      buildArchetype(spec, dist, personaIndex),
    );

    result[resourceType] = {
      count: distribution.count,
      archetypes,
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildArchetype(
  spec: ResourceSpec,
  dist: ArchetypeDistribution,
  personaIndex?: number,
): EntityArchetype {
  const fields: Record<string, unknown> = {};
  const vary: Record<string, FieldVariation> = {};

  for (const [fieldName, fieldSpec] of Object.entries(spec.fields)) {
    if (fieldSpec.auto && isExpanderAutoField(fieldName)) continue;

    const overrideValue = dist.fieldOverrides?.[fieldName];

    // Per-archetype LLM vary spec takes precedence over assembler derivation
    const llmVary = dist.vary?.[fieldName] as FieldVariation | undefined;

    if (overrideValue !== undefined) {
      fields[fieldName] = overrideValue;
    } else if (llmVary) {
      vary[fieldName] = llmVary;
    } else {
      const variation = deriveVariation(fieldName, fieldSpec, spec, personaIndex);
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

  // Ref field → sequence with ref's ID prefix
  if (spec.ref) {
    // Will be resolved by the expander's cross-reference logic
    return null;
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
