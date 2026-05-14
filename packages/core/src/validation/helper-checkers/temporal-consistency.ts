/**
 * V4.5 helper — temporal consistency / relative gap checker.
 *
 * Confirms that two anchored persona events sit at the right temporal
 * offset, e.g. "canceled 9 days after the duplicate charge".
 */

import type { TemporalClause } from '../../contract/clause-types.js';
import type { Anchor } from '../../types/blueprint.js';

export interface TemporalGapCheckResult {
  passed: boolean;
  expectedDays: number;
  actualDays: number | null;
  tolerance: number;
  anchorA: { id: string; date: string | null };
  anchorB: { id: string; date: string | null };
  reason?: string;
}

export function checkTemporalGap(
  clause: TemporalClause & { kind: 'relative_gap' },
  anchors: Anchor[],
): TemporalGapCheckResult {
  const tolerance = clause.tolerance ?? 0;
  const a = anchors.find((x) => x.id === clause.anchorA);
  const b = anchors.find((x) => x.id === clause.anchorB);
  const dateA = a?.dates.event ?? null;
  const dateB = b?.dates.event ?? null;

  if (!dateA || !dateB) {
    return {
      passed: false,
      expectedDays: clause.days,
      actualDays: null,
      tolerance,
      anchorA: { id: clause.anchorA, date: dateA },
      anchorB: { id: clause.anchorB, date: dateB },
      reason: `Missing anchor event date — anchorA=${dateA ?? 'unbound'}, anchorB=${dateB ?? 'unbound'}.`,
    };
  }

  const msA = new Date(dateA).getTime();
  const msB = new Date(dateB).getTime();
  if (!Number.isFinite(msA) || !Number.isFinite(msB)) {
    return {
      passed: false,
      expectedDays: clause.days,
      actualDays: null,
      tolerance,
      anchorA: { id: clause.anchorA, date: dateA },
      anchorB: { id: clause.anchorB, date: dateB },
      reason: `Anchor event date is not parseable as ISO date.`,
    };
  }

  const actualDays = Math.round((msB - msA) / (24 * 3600 * 1000));
  const passed = Math.abs(actualDays - clause.days) <= tolerance;

  return {
    passed,
    expectedDays: clause.days,
    actualDays,
    tolerance,
    anchorA: { id: clause.anchorA, date: dateA },
    anchorB: { id: clause.anchorB, date: dateB },
    reason: passed
      ? undefined
      : `Anchor gap ${actualDays}d does not match expected ${clause.days}d (tolerance ${tolerance}).`,
  };
}
