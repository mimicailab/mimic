import type {
  EntityArchetypeConfig,
  EntityArchetype,
  EntityData,
} from '../types/blueprint.js';
import type { IdentityContractEntry } from './prompts.js';
import { BlueprintGenerationError } from '../utils/errors.js';

/**
 * Result of inspecting one (archetype | static row) against one contract pin.
 * `kind === 'ok'` means a sequence-prefix match or a static value with the
 * right prefix was found; otherwise `value` carries what we *did* find so the
 * error message can name it.
 */
type CheckResult =
  | { kind: 'ok' }
  | { kind: 'mismatch'; value: string }
  | { kind: 'missing' };

function checkArchetype(
  archetype: EntityArchetype,
  field: string,
  expectedPrefix: string,
): CheckResult {
  // `vary` takes precedence at expansion time, so check it first.
  const v = archetype.vary?.[field];
  if (v) {
    if (v.type === 'sequence' && v.prefix === expectedPrefix) return { kind: 'ok' };
    if (v.type === 'sequence') return { kind: 'mismatch', value: v.prefix ?? '<unset>' };
    // Any other vary type (uuid, pick, derived, ...) cannot be guaranteed to
    // produce the contracted prefix — that's a violation. Surface the type
    // so the error message names the offending strategy.
    return { kind: 'mismatch', value: `<vary type="${v.type}">` };
  }

  // No vary entry: fall back to a static value in `fields`.
  const f = archetype.fields?.[field];
  if (typeof f === 'string') {
    if (f.startsWith(expectedPrefix)) return { kind: 'ok' };
    return { kind: 'mismatch', value: f };
  }

  return { kind: 'missing' };
}

function checkStaticRows(
  rows: EntityData[],
  field: string,
  expectedPrefix: string,
): CheckResult {
  let firstNonConforming: string | undefined;
  let sawColumn = false;
  for (const row of rows) {
    const v = row[field];
    if (typeof v !== 'string') continue;
    sawColumn = true;
    if (!v.startsWith(expectedPrefix)) {
      if (firstNonConforming === undefined) firstNonConforming = v;
    }
  }
  if (!sawColumn) return { kind: 'missing' };
  if (firstNonConforming !== undefined) return { kind: 'mismatch', value: firstNonConforming };
  return { kind: 'ok' };
}

/**
 * Validate that Phase 1 DB archetypes/entities respect the identity contract.
 * Throws on the first violation with a message that names the offending
 * archetype label and value, plus the schema-mapping entry that caused the
 * constraint — so the user can either fix the prompt response by retrying,
 * or remove the cross-surface column from their schema.
 *
 * No-op when `contract` is empty (the no-cross-surface-FK case).
 */
export function validatePhase1IdentityContract(
  data: {
    entityArchetypes?: Record<string, EntityArchetypeConfig>;
    entities?: Record<string, EntityData[]>;
  },
  contract: IdentityContractEntry[],
): void {
  for (const entry of contract) {
    const cfg = data.entityArchetypes?.[entry.dbTable];
    const rows = data.entities?.[entry.dbTable];

    // No archetypes AND no static rows means the table wasn't generated.
    // That's likely a different bug (coverage), not a contract violation —
    // skip rather than misreport.
    if ((!cfg || cfg.archetypes.length === 0) && (!rows || rows.length === 0)) continue;

    // ALL archetypes must conform — a single non-conforming one produces
    // rows that violate the join. Stop at the first failure.
    if (cfg && cfg.archetypes.length > 0) {
      for (const a of cfg.archetypes) {
        const r = checkArchetype(a, entry.dbColumn, entry.prefix);
        if (r.kind !== 'ok') {
          const example = r.kind === 'mismatch'
            ? { source: `archetype "${a.label}"`, value: r.value }
            : { source: `archetype "${a.label}"`, value: '<no id field>' };
          throwViolation('Phase 1', entry, example, /*onPhase1*/ true);
        }
      }
    }

    if (rows && rows.length > 0) {
      const r = checkStaticRows(rows, entry.dbColumn, entry.prefix);
      if (r.kind === 'mismatch') {
        throwViolation(
          'Phase 1',
          entry,
          { source: `entities[${entry.dbTable}]`, value: r.value },
          /*onPhase1*/ true,
        );
      }
      // 'missing' on static rows means none of the rows referenced the column
      // — only treat that as a violation if there were also no archetypes.
      if (r.kind === 'missing' && (!cfg || cfg.archetypes.length === 0)) {
        throwViolation(
          'Phase 1',
          entry,
          undefined,
          /*onPhase1*/ true,
        );
      }
    }
  }
}

/**
 * Validate that Phase 2 API archetypes/entities respect the identity contract.
 * Same shape as Phase 1, but walks `apiEntityArchetypes[adapterId][resource]`.
 */
export function validatePhase2IdentityContract(
  data: {
    apiEntityArchetypes?: Record<string, Record<string, EntityArchetypeConfig>>;
    apiEntities?: Record<string, Record<string, EntityData[]>>;
  },
  contract: IdentityContractEntry[],
): void {
  for (const entry of contract) {
    const cfg = data.apiEntityArchetypes?.[entry.adapterId]?.[entry.apiResource];
    const rows = data.apiEntities?.[entry.adapterId]?.[entry.apiResource];

    if ((!cfg || cfg.archetypes.length === 0) && (!rows || rows.length === 0)) continue;

    if (cfg && cfg.archetypes.length > 0) {
      for (const a of cfg.archetypes) {
        const r = checkArchetype(a, entry.apiField, entry.prefix);
        if (r.kind !== 'ok') {
          const example = r.kind === 'mismatch'
            ? { source: `archetype "${a.label}"`, value: r.value }
            : { source: `archetype "${a.label}"`, value: '<no id field>' };
          throwViolation('Phase 2', entry, example, /*onPhase1*/ false);
        }
      }
    }

    if (rows && rows.length > 0) {
      const r = checkStaticRows(rows, entry.apiField, entry.prefix);
      if (r.kind === 'mismatch') {
        throwViolation(
          'Phase 2',
          entry,
          {
            source: `apiEntities[${entry.adapterId}][${entry.apiResource}]`,
            value: r.value,
          },
          /*onPhase1*/ false,
        );
      }
      if (r.kind === 'missing' && (!cfg || cfg.archetypes.length === 0)) {
        throwViolation(
          'Phase 2',
          entry,
          undefined,
          /*onPhase1*/ false,
        );
      }
    }
  }
}

function throwViolation(
  phaseLabel: string,
  entry: IdentityContractEntry,
  example: { source: string; value: string } | undefined,
  onPhase1: boolean,
): never {
  const subject = onPhase1
    ? `${entry.dbTable}.${entry.dbColumn}`
    : `${entry.adapterId}.${entry.apiResource}.${entry.apiField}`;
  const counterpart = onPhase1
    ? `${entry.adapterId}.${entry.apiResource}.${entry.apiField}`
    : `${entry.dbTable}.${entry.dbColumn}`;

  const found = example
    ? `${example.source} emitted "${example.value}"`
    : 'no archetype or row referenced this column';

  const message =
    `${phaseLabel} identity-contract violation on ${subject}: ${found} ` +
    `but the schema mapping requires prefix "${entry.prefix}" so values join ` +
    `with ${counterpart}.`;

  const remedy =
    'Fix: re-run blueprint generation (LLMs occasionally ignore constraints; ' +
    'one retry usually fixes it). Or: remove the cross-surface column from ' +
    'your schema if you do not need DB↔API joins on it.';

  throw new BlueprintGenerationError(message, remedy);
}
