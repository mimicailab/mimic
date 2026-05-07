import type {
  EntityArchetypeConfig,
  EntityArchetype,
  EntityData,
} from '../types/blueprint.js';
import type { IdentityContractEntry } from './prompts.js';

/**
 * Deterministic injection: for every archetype of every contracted resource,
 * pin `vary[<field>] = { type: "sequence", prefix: <contractPrefix> }` and
 * strip any static value the LLM may have left in `fields[<field>]`.
 *
 * Rationale: the value of a contracted ID field is not the LLM's decision —
 * the adapter declares the prefix, the persona index namespaces it, and the
 * expander emits "<prefix>001", "<prefix>002", … sequentially (the counter
 * is keyed by prefix, so multiple archetypes sharing the same prefix share
 * one counter, no collisions). Asking the LLM to "produce the right vary.id"
 * via prompt instruction and then validating the output is the long way
 * around. We just write the right value ourselves.
 *
 * The validator still runs after injection as a defensive net, but should
 * never fire on injected output.
 */

function pinArchetype(
  archetype: EntityArchetype,
  field: string,
  prefix: string,
): boolean {
  const v = archetype.vary?.[field];
  const desired = { type: 'sequence' as const, prefix };

  let mutated = false;

  if (!v || v.type !== 'sequence' || v.prefix !== prefix) {
    archetype.vary[field] = desired;
    mutated = true;
  }

  if (archetype.fields && field in archetype.fields) {
    delete archetype.fields[field];
    mutated = true;
  }

  return mutated;
}

function pinConfig(
  cfg: EntityArchetypeConfig,
  field: string,
  prefix: string,
): number {
  let count = 0;
  for (const a of cfg.archetypes) {
    if (pinArchetype(a, field, prefix)) count++;
  }
  return count;
}

/**
 * Mutates `data.entityArchetypes` in place. Static `data.entities` rows are
 * left alone — they're already concrete strings, and rewriting them risks
 * breaking other invariants (FKs from related rows reference these IDs by
 * value). When Phase 1 produces static rows, the validator catches a bad
 * prefix instead of silently rewriting it.
 *
 * Returns the number of archetype mutations applied (for telemetry / tests).
 */
export function injectPhase1IdentityContract(
  data: {
    entityArchetypes?: Record<string, EntityArchetypeConfig>;
    entities?: Record<string, EntityData[]>;
  },
  contract: IdentityContractEntry[],
): number {
  let mutations = 0;
  for (const entry of contract) {
    const cfg = data.entityArchetypes?.[entry.dbTable];
    if (cfg && cfg.archetypes.length > 0) {
      mutations += pinConfig(cfg, entry.dbColumn, entry.prefix);
    }
  }
  return mutations;
}

/**
 * Mutates `data.apiEntityArchetypes` in place. Same rationale as Phase 1:
 * static `data.apiEntities` rows are left for the validator to flag.
 */
export function injectPhase2IdentityContract(
  data: {
    apiEntityArchetypes?: Record<string, Record<string, EntityArchetypeConfig>>;
    apiEntities?: Record<string, Record<string, EntityData[]>>;
  },
  contract: IdentityContractEntry[],
): number {
  let mutations = 0;
  for (const entry of contract) {
    const cfg = data.apiEntityArchetypes?.[entry.adapterId]?.[entry.apiResource];
    if (cfg && cfg.archetypes.length > 0) {
      mutations += pinConfig(cfg, entry.apiField, entry.prefix);
    }
  }
  return mutations;
}
