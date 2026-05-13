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
import { solveCounts, formatConflicts, type SolverConflict } from './count-solver.js';
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
  /**
   * Strict mode. When true, persona contradictions (count solver conflicts)
   * and exhausted repair budgets abort with a thrown error — the legacy V2
   * behaviour. When false (default), the pipeline always seeds the best-
   * effort data it has and surfaces remaining gaps via `complianceReport`.
   * V2.5: aborting the whole run because a persona's claims didn't perfectly
   * satisfy is a bad tradeoff for callers that want SOMETHING to inspect.
   */
  strict?: boolean;
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
  /**
   * Markdown-formatted persona-compliance report. Populated only when the
   * pipeline finished in soft-fail mode with unresolved issues (solver
   * conflicts or residual claim failures after repair). Callers typically
   * write this alongside the expanded data so a human can inspect the gap.
   */
  complianceReport?: string;
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
  const strict = options.strict ?? false;
  const repairAttempts: RepairAttempt[] = [];
  let solverConflicts: SolverConflict[] = [];

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
      // Over-constrained persona. In strict mode we abort; otherwise we
      // record the conflicts for the compliance report and apply the best-
      // effort patch the solver produced so we can still seed data.
      if (strict) {
        throw new BlueprintGenerationError(
          formatConflicts(solveResult.conflicts),
          'Either revise the persona to remove the contradiction, or add tolerance to the affected claims. The count solver detected this before any LLM call or expansion happened — it is a persona-internal contradiction, not a generation failure.',
        );
      }
      solverConflicts = solveResult.conflicts;
      logger.warn(
        `Count solver detected ${solveResult.conflicts.length} infeasible constraint${solveResult.conflicts.length === 1 ? '' : 's'} — proceeding with best-effort counts (a compliance report will be written).`,
      );
      for (const c of solveResult.conflicts) {
        logger.debug(`  conflict: ${c.message}`);
      }
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
      const result: ExpandAndAuditResult = { expanded, audit, repairAttempts, blueprint: current };
      if (solverConflicts.length > 0) {
        // Solver conflicts but the data still passed audit (counts landed
        // within tolerance after expansion). Surface the conflict so the
        // caller can decide whether the persona text needs a rewrite.
        result.complianceReport = buildComplianceReport({
          persona: options.persona,
          solverConflicts,
          finalAudit: audit,
          repairAttempts,
          maxAttempts,
          outcome: 'passed-with-solver-conflicts',
        });
      }
      return result;
    }

    if (attempt === maxAttempts) {
      // Out of repair budget. In strict mode: fail loudly (legacy V2). In
      // soft mode (default): seed best-effort data and return the
      // compliance report so a human can see the gap.
      if (strict) {
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
      logger.warn(
        `Claim audit failed after ${maxAttempts} repair attempt${maxAttempts > 1 ? 's' : ''} — emitting best-effort seed data with a persona-compliance report.`,
      );
      const complianceReport = buildComplianceReport({
        persona: options.persona,
        solverConflicts,
        finalAudit: audit,
        repairAttempts,
        maxAttempts,
        outcome: 'failed-after-repair-budget',
      });
      return { expanded, audit, repairAttempts, blueprint: current, complianceReport };
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
  const leakageHints = collectLeakageHints(audit, blueprint);

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
    leakageHints,
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

/**
 * For each row_count failure whose overcount can't be explained by the cited
 * archetype counts alone, collect the non-cited archetypes on the same surface
 * whose fields/vary state could leak into the predicate. Threaded into the
 * repair LLM prompt so the model knows where to narrow.
 */
function collectLeakageHints(
  audit: AuditResult,
  blueprint: Blueprint,
): NonNullable<Parameters<typeof buildRepairPrompt>[0]['leakageHints']> {
  const out: NonNullable<Parameters<typeof buildRepairPrompt>[0]['leakageHints']> = [];
  for (const f of audit.failures) {
    if (f.claim.kind !== 'row_count') continue;
    const claim = f.claim as Extract<typeof f.claim, { kind: 'row_count' }>;
    const filter = claim.target.filter;
    if (!filter || Object.keys(filter).length === 0) continue;

    const actual = typeof f.actual === 'number' ? f.actual : Number(f.actual);
    if (!Number.isFinite(actual)) continue;
    if (actual <= claim.expected) continue; // only overcount needs leakage analysis

    // Find cited archetype paths on the same surface as the claim.
    const surface = claim.target.surface;
    const target = claim.target.name;
    const config = configFor(blueprint, surface, target);
    if (!config) continue;

    const citedLabels = new Set<string>();
    for (const ref of f.citedBy ?? []) {
      const m = ref.match(/^(?:db|api)\.[^\[]+\[(.+)\]$/);
      if (m) citedLabels.add(m[1]!);
    }

    const leakers: Array<{ ref: string; fields: Record<string, unknown>; vary: Record<string, unknown> }> = [];
    for (const a of config.archetypes) {
      if (citedLabels.has(a.label)) continue;
      // Conservative: an archetype "could leak" when none of its constant
      // fields rule out the filter. (Same heuristic as deterministic-repair.)
      if (!couldArchetypeLeak(a, filter as Record<string, unknown>)) continue;
      leakers.push({
        ref: `${surface}:${target}:${a.label}`,
        fields: a.fields,
        vary: a.vary as Record<string, unknown>,
      });
    }
    if (leakers.length === 0) continue;
    out.push({
      claimId: claim.id,
      filter: filter as Record<string, unknown>,
      leakingArchetypes: leakers,
    });
  }
  return out;
}

function couldArchetypeLeak(
  archetype: { fields: Record<string, unknown>; vary: Record<string, unknown> },
  filter: Record<string, unknown>,
): boolean {
  for (const [field, predicate] of Object.entries(filter)) {
    const fieldValue = archetype.fields[field];
    const varyValue = archetype.vary[field];
    if (fieldValue === undefined || varyValue !== undefined) continue;
    // Constant field present and no vary — evaluate directly.
    if (!constantSatisfiesPredicate(fieldValue, predicate)) return false;
  }
  return true;
}

function constantSatisfiesPredicate(value: unknown, predicate: unknown): boolean {
  if (predicate === null || typeof predicate !== 'object' || Array.isArray(predicate)) {
    return value === predicate;
  }
  const op = predicate as Record<string, unknown>;
  if ('eq' in op) return value === op.eq;
  if ('neq' in op) return value !== op.neq;
  if ('in' in op && Array.isArray(op.in)) return op.in.includes(value);
  if ('nin' in op && Array.isArray(op.nin)) return !op.nin.includes(value);
  if ('is_null' in op) {
    const isNull = value === null || value === undefined || value === '';
    return isNull === op.is_null;
  }
  return true; // numeric/date comparisons on constants — conservatively allow
}

// ---------------------------------------------------------------------------
// Persona compliance report (soft-fail mode)
// ---------------------------------------------------------------------------

interface ComplianceReportInput {
  persona: { name: string; description: string };
  solverConflicts: SolverConflict[];
  finalAudit: AuditResult;
  repairAttempts: RepairAttempt[];
  maxAttempts: number;
  outcome: 'passed-with-solver-conflicts' | 'failed-after-repair-budget';
}

function buildComplianceReport(input: ComplianceReportInput): string {
  const { persona, solverConflicts, finalAudit, repairAttempts, maxAttempts, outcome } = input;
  const lines: string[] = [];
  lines.push(`# Persona compliance report — "${persona.name}"`);
  lines.push('');
  lines.push(`Outcome: **${outcome === 'passed-with-solver-conflicts' ? 'audit passed but solver flagged contradictions' : `audit failed after ${maxAttempts} repair attempt${maxAttempts === 1 ? '' : 's'}`}**`);
  lines.push('');
  lines.push('Data was still seeded on a best-effort basis. Re-run with `--strict` (CLI) or `strict: true` (engine option) to abort instead of producing partial data.');
  lines.push('');

  if (solverConflicts.length > 0) {
    lines.push('## Solver contradictions');
    lines.push('');
    lines.push('The count solver detected claims whose `expected` row counts cannot all be satisfied simultaneously. Revise the persona to remove the contradiction, or add `tolerance` to the affected claim(s).');
    lines.push('');
    for (const c of solverConflicts) {
      lines.push(`- **${c.claimId}** — expected ${c.expected}${c.tolerance > 0 ? ` (±${c.tolerance})` : ''}, citers sum to ${c.assignedSum}.`);
      lines.push(`  ${c.message}`);
    }
    lines.push('');
  }

  if (finalAudit.failures.length > 0) {
    lines.push(`## Claim audit failures (${finalAudit.failures.length} of ${finalAudit.evaluations.length})`);
    lines.push('');
    lines.push('Each entry below is quoted directly from the persona description. The cited archetypes were the ones the LLM bound responsibility to; if the cite list is empty, no archetype took responsibility for the claim.');
    lines.push('');
    for (const f of finalAudit.failures) {
      lines.push(`### ${f.claim.id}`);
      lines.push('');
      lines.push(`> ${f.claim.quote}`);
      lines.push('');
      lines.push(`- predicate: \`${f.predicate}\``);
      lines.push(`- actual: \`${typeof f.actual === 'object' ? JSON.stringify(f.actual) : String(f.actual)}\``);
      if (f.citedBy && f.citedBy.length > 0) {
        lines.push(`- cited by: ${f.citedBy.map((c) => `\`${c}\``).join(', ')}`);
      } else {
        lines.push('- cited by: _(no archetype cited this claim — generator skipped binding)_');
      }
      lines.push('');
    }
  }

  if (repairAttempts.length > 0) {
    lines.push(`## Repair attempts (${repairAttempts.length})`);
    lines.push('');
    for (const a of repairAttempts) {
      lines.push(`- Attempt ${a.attempt}: ${a.patch.rationale}`);
      lines.push(`  - ops: \`${JSON.stringify(a.patch.ops)}\``);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('Generated by mimic\'s claim-audit pipeline. See `private/v2.md` for the architecture.');
  return lines.join('\n');
}
