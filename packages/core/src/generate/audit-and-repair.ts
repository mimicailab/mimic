import type { Blueprint, EntityArchetypeConfig, SchemaMapping, TableClassification } from '../types/blueprint.js';
import type { SchemaModel } from '../types/schema.js';
import type { ExpandedData } from '../types/dataset.js';
import type { AdapterResourceSpecs, PromptContext } from '../types/adapter.js';
import type {
  AuditResult,
  BlueprintPatch,
  RepairAttempt,
} from '../types/claim.js';
import type { ILLMClient } from '../llm/client.js';
import { BlueprintExpander } from './expander.js';
import { auditClaims, formatAuditFailures } from './claim-auditor.js';
import { applyBlueprintPatch } from './blueprint-patch.js';
import { buildRepairPrompt } from './prompts.js';
import { BlueprintPatchSchema } from './blueprint-zod.js';
import { BlueprintGenerationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { rewriteBridgeTables, formatBridgeRewrite } from './bridge-rewriter.js';
import { solveCounts, formatConflicts } from './count-solver.js';
import { deterministicRepair, formatRepairDecisions } from './deterministic-repair.js';

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface ExpandAndAuditOptions {
  /** Seed for the expander */
  seed: number;
  /** Volume string from config (e.g. "6 months") */
  volume: string;
  /** Pass-through arguments forwarded to BlueprintExpander.expand() */
  promptContexts?: Record<string, PromptContext>;
  schemaMapping?: SchemaMapping;
  tableClassifications?: TableClassification[];
  modelingConfig?: {
    fieldMappings?: Record<string, Record<string, Record<string, string>>>;
    identityLinks?: Record<
      string,
      Record<
        string,
        {
          column: string;
          identityTable: string;
          apiField: string;
          platformColumn: string;
          externalIdColumn: string;
        }[]
      >
    >;
  };
  resourceSpecs?: Record<string, AdapterResourceSpecs>;
  /** Maximum number of repair attempts. Defaults to 2 per the architecture spec. */
  maxRepairAttempts?: number;
  /** Persona context for the repair prompt */
  persona: { name: string; description: string };
}

export interface ExpandAndAuditResult {
  expanded: ExpandedData;
  audit: AuditResult;
  /** Patch attempts that were applied to the blueprint, in order */
  repairAttempts: RepairAttempt[];
  /**
   * The blueprint as it stood after the final attempt. May differ from the
   * input blueprint if bridge rewrite, solver, or repair patches were applied.
   */
  blueprint: Blueprint;
}

/**
 * Expand a blueprint, audit its persona claims, and run a bounded repair
 * loop if any claim fails.
 *
 * Flow:
 *   1. Bridge rewrite — strip DB archetypes on bridge tables and rewrite
 *      bridge-table claims to the API surface (deterministic, structural).
 *   2. Count solver — assign archetype counts from row_count claims via
 *      the cites graph (deterministic arithmetic). Surfaces over-constrained
 *      personas BEFORE any expansion.
 *   3. Expand + audit + repair loop:
 *      a. Expand. Audit. If pass, return.
 *      b. Deterministic repair first (mechanical patches; no LLM).
 *      c. LLM repair only for residual failures.
 *      d. Up to `maxRepairAttempts`. Hard fail with persona-quoted error
 *         on the final attempt.
 *
 * When the blueprint has no claims, this degrades to a single expand call
 * with an empty audit — backward compatible with pre-claims blueprints.
 */
export async function expandAndAudit(
  llm: ILLMClient,
  blueprint: Blueprint,
  schema: SchemaModel,
  options: ExpandAndAuditOptions,
): Promise<ExpandAndAuditResult> {
  const maxAttempts = options.maxRepairAttempts ?? 2;
  const repairAttempts: RepairAttempt[] = [];

  // ── Step 1: Bridge rewrite (deterministic, structural) ────────────────────
  let current = blueprint;
  const bridgeResult = rewriteBridgeTables(current, options.schemaMapping);
  if (bridgeResult.strippedArchetypes.length > 0 || bridgeResult.rewrittenClaims.length > 0) {
    logger.info(formatBridgeRewrite(bridgeResult));
  }
  current = bridgeResult.blueprint;

  // ── Step 2: Count solver (deterministic, arithmetic) ──────────────────────
  if ((current.data.claims?.length ?? 0) > 0) {
    const solveResult = solveCounts(current);
    if (solveResult.conflicts.length > 0) {
      // Over-constrained persona — surface BEFORE expansion. The user has
      // contradictory claims; no amount of generation will satisfy them.
      throw new BlueprintGenerationError(
        formatConflicts(solveResult.conflicts),
        'Either revise the persona to remove the contradiction, or add tolerance to the affected claims. The count solver detected this before any LLM call or expansion happened — it is a persona-internal contradiction, not a generation failure.',
      );
    }
    if (solveResult.patch.ops.length > 0) {
      const { failures: solveApplyFailures } = applyBlueprintPatch(current, solveResult.patch);
      if (solveApplyFailures.length > 0) {
        for (const f of solveApplyFailures) {
          logger.warn(`Solver op skipped: ${JSON.stringify(f.op)} — ${f.reason}`);
        }
      }
      logger.success(
        `Count solver assigned ${solveResult.patch.ops.length} archetype count${solveResult.patch.ops.length === 1 ? '' : 's'} from ${current.data.claims?.length ?? 0} claim${(current.data.claims?.length ?? 0) === 1 ? '' : 's'}.`,
      );
    }
  }

  // ── Step 3: Expand + audit + repair loop ──────────────────────────────────
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    const expanded = expand(current, schema, options);
    const audit = auditClaims(current, expanded);

    if (audit.failures.length === 0) {
      if (attempt > 0) {
        logger.success(
          `Claim audit passed after ${attempt} repair attempt${attempt > 1 ? 's' : ''}.`,
        );
      } else if (audit.evaluations.length > 0) {
        logger.success(
          `Claim audit passed (${audit.evaluations.length} claims).`,
        );
      }
      return { expanded, audit, repairAttempts, blueprint: current };
    }

    if (attempt === maxAttempts) {
      // Out of repair budget — fail loudly.
      const report = formatAuditFailures(audit);
      const priorPatches = repairAttempts
        .map(
          (a) =>
            `\nAttempt ${a.attempt} rationale: ${a.patch.rationale}\n  ops: ${JSON.stringify(a.patch.ops)}`,
        )
        .join('');
      throw new BlueprintGenerationError(
        `Claim audit FAILED after ${maxAttempts} repair attempt${maxAttempts > 1 ? 's' : ''}.\n\n${report}${priorPatches ? `\n\nPrior repair attempts (none fixed the issues):${priorPatches}` : ''}`,
        'Each failed claim is quoted from the persona above. Either revise the persona to make the claim achievable within the volume/schema, or open the blueprint cache and inspect why the cited archetypes did not produce satisfying rows.',
      );
    }

    // Log the failures we're about to repair.
    logger.warn(
      `Claim audit: ${audit.failures.length} of ${audit.evaluations.length} claims failed — repair attempt ${attempt + 1}/${maxAttempts}.`,
    );
    for (const f of audit.failures) {
      logger.debug(
        `  fail ${f.claim.id}: ${f.predicate} | actual: ${typeof f.actual === 'object' ? JSON.stringify(f.actual) : String(f.actual)}`,
      );
    }

    // ── Step 3a: Deterministic repair first (no LLM) ─────────────────────
    const determ = deterministicRepair(current, audit);
    if (determ.decisions.length > 0) {
      logger.info(formatRepairDecisions(determ.decisions));
    }

    let attemptPatch: BlueprintPatch = determ.patch;
    if (determ.patch.ops.length > 0) {
      const { failures: applyFailures } = applyBlueprintPatch(current, determ.patch);
      for (const f of applyFailures) {
        logger.warn(`Deterministic repair op skipped: ${JSON.stringify(f.op)} — ${f.reason}`);
      }
    }

    // ── Step 3b: LLM repair for residual failures only ────────────────────
    if (determ.residualFailures.length > 0) {
      const residualAudit: AuditResult = {
        evaluations: determ.residualFailures,
        failures: determ.residualFailures,
      };
      const llmPatch = await callRepairLLM(
        llm,
        options.persona,
        residualAudit,
        current,
        attempt + 1,
        repairAttempts,
      );
      const { failures: applyFailures } = applyBlueprintPatch(current, llmPatch);
      for (const f of applyFailures) {
        logger.warn(`LLM repair op skipped: ${JSON.stringify(f.op)} — ${f.reason}`);
      }
      // Merge both patches into the recorded attempt for telemetry.
      attemptPatch = {
        ops: [...determ.patch.ops, ...llmPatch.ops],
        rationale:
          `Deterministic: ${determ.patch.rationale} | LLM: ${llmPatch.rationale}`,
      };
    }

    repairAttempts.push({
      attempt: attempt + 1,
      patch: attemptPatch,
      resultingAudit: { evaluations: [], failures: [] },
    });
  }

  // Unreachable — loop always returns or throws inside.
  throw new BlueprintGenerationError(
    'expandAndAudit: reached end of loop without return — this is a bug',
    'Open an issue with the persona + blueprint that triggered this path.',
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expand(
  blueprint: Blueprint,
  schema: SchemaModel,
  options: ExpandAndAuditOptions,
): ExpandedData {
  const expander = new BlueprintExpander(options.seed);
  return expander.expand(
    blueprint,
    schema,
    options.volume,
    options.promptContexts,
    options.schemaMapping,
    options.tableClassifications,
    options.modelingConfig,
    options.resourceSpecs,
  );
}

async function callRepairLLM(
  llm: ILLMClient,
  persona: { name: string; description: string },
  audit: AuditResult,
  blueprint: Blueprint,
  attemptNumber: number,
  priorAttempts: RepairAttempt[],
): Promise<BlueprintPatch> {
  const failures = audit.failures.map((f) => ({
    claim: f.claim as unknown as { id: string; quote: string; kind: string; [k: string]: unknown },
    predicate: f.predicate,
    actual: f.actual,
    sampleRows: f.sampleRows,
    citedBy: f.citedBy,
  }));

  const citedArchetypes = collectCitedArchetypes(audit, blueprint);

  const priorAttemptsForPrompt = priorAttempts.map((a) => ({
    attempt: a.attempt,
    patch: { ops: a.patch.ops as unknown as unknown[], rationale: a.patch.rationale },
    stillFailing: audit.failures.map((f) => f.claim.id),
  }));

  const { system, user } = buildRepairPrompt({
    persona,
    attempt: attemptNumber,
    failures,
    citedArchetypes,
    priorAttempts: priorAttemptsForPrompt,
  });

  const result = await llm.generateObject({
    schema: BlueprintPatchSchema,
    schemaName: 'BlueprintPatch',
    schemaDescription:
      'A list of patch operations to repair archetypes that failed claim audit',
    system,
    prompt: user,
    label: `repair:${persona.name}:attempt${attemptNumber}`,
    category: 'generation',
  });

  return result.object as BlueprintPatch;
}

function collectCitedArchetypes(
  audit: AuditResult,
  blueprint: Blueprint,
): Array<{ surface: 'db' | 'api'; target: string; config: unknown }> {
  const cited = new Set<string>(); // `<surface>:<target>:<label>`
  for (const f of audit.failures) {
    for (const c of f.citedBy ?? []) cited.add(c);
  }

  const out: Array<{ surface: 'db' | 'api'; target: string; config: unknown }> = [];
  const seenTargets = new Set<string>(); // dedupe across multiple cited archetypes in same config

  for (const ref of cited) {
    // ref shape: "db.<table>[<label>]" or "api.<adapter>.<resource>[<label>]"
    const match = ref.match(/^(db|api)\.([^\[]+)\[(.+)\]$/);
    if (!match) continue;
    const surface = match[1] as 'db' | 'api';
    const target = match[2]!;
    const key = `${surface}:${target}`;
    if (seenTargets.has(key)) continue;
    seenTargets.add(key);
    const config = configFor(blueprint, surface, target);
    if (config) {
      out.push({ surface, target, config });
    }
  }

  // Also include any claim that has NO citation — surface the full config of
  // a plausible insertion target so the repair LLM can add_archetype.
  for (const f of audit.failures) {
    if (f.citedBy && f.citedBy.length > 0) continue;
    const t = f.claim.target;
    const surface = t.surface;
    const target = t.name;
    const key = `${surface}:${target}`;
    if (seenTargets.has(key)) continue;
    seenTargets.add(key);
    const config = configFor(blueprint, surface, target);
    if (config) {
      out.push({ surface, target, config });
    } else {
      // Config doesn't exist yet — surface an empty stub so the LLM knows
      // it can add_archetype with this target string.
      out.push({ surface, target, config: { count: 0, archetypes: [] } });
    }
  }

  return out;
}

function configFor(
  blueprint: Blueprint,
  surface: 'db' | 'api',
  target: string,
): EntityArchetypeConfig | undefined {
  if (surface === 'db') {
    return blueprint.data.entityArchetypes?.[target];
  }
  const dot = target.indexOf('.');
  if (dot < 0) return undefined;
  const adapter = target.slice(0, dot);
  const resource = target.slice(dot + 1);
  return blueprint.data.apiEntityArchetypes?.[adapter]?.[resource];
}
