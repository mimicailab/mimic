/**
 * Deterministic, shape-only repair (Phase 10 will fill this in).
 *
 * The Phase 1 deletion sweep extracted no ops from the legacy
 * `generate/deterministic-repair.ts` — every op in that module rewrote
 * counts, vary ranges, or pinned fields, all of which are SEMANTIC and
 * forbidden in V5. Phase 10 will implement a fresh, narrowly-scoped set:
 *
 *   - format / casing of string fields
 *   - missing ID generation (prefix + uuid, via projection/identity-prefix)
 *   - FK wiring across already-emitted rows
 *   - schema-shape conformance (drop extras, fill required nullables)
 *
 * Forbidden — these throw `IllegalRepairError`:
 *
 *   - rewriting counts / cohort membership
 *   - reassigning anchors
 *   - rewriting cross-surface meaning
 *   - rewriting budgets
 *
 * Re-validate after every repair pass; bounded to 2 attempts before the
 * shape validator escalates to an owner-level failure report.
 */

export class IllegalRepairError extends Error {
  constructor(public readonly op: string, public readonly reason: string) {
    super(`Illegal shape repair op "${op}": ${reason}. Semantic concerns must regenerate via the owning planner, not be patched in output.`);
    this.name = 'IllegalRepairError';
  }
}
