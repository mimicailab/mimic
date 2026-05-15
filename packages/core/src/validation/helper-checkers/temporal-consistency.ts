/**
 * V4.5 helper — temporal consistency / relative gap checker.
 *
 * Confirms that two anchored persona events sit at the right temporal
 * offset, e.g. "canceled 9 days after the duplicate charge".
 */

import type { TemporalClause } from '../../contract/clause-types.js';
import type { Anchor } from '../../contract/persona-contract.js';

export interface TemporalGapCheckResult {
  passed: boolean;
  expectedDays: number;
  actualDays: number | null;
  tolerance: number;
  anchorA: { id: string; field: string | null; date: string | null };
  anchorB: { id: string; field: string | null; date: string | null };
  reason?: string;
}

export function checkTemporalGap(
  clause: TemporalClause & { kind: 'relative_gap' },
  anchors: Anchor[],
): TemporalGapCheckResult {
  const tolerance = clause.tolerance ?? 0;
  const a = anchors.find((x) => x.id === clause.anchorA);
  const b = anchors.find((x) => x.id === clause.anchorB);
  const resolvedA = resolveAnchorDate(a, 'start', clause.anchorA === clause.anchorB);
  const resolvedB = resolveAnchorDate(b, 'end', clause.anchorA === clause.anchorB);
  const dateA = resolvedA.date;
  const dateB = resolvedB.date;

  if (!dateA || !dateB) {
    return {
      passed: false,
      expectedDays: clause.days,
      actualDays: null,
      tolerance,
      anchorA: { id: clause.anchorA, field: resolvedA.field, date: dateA },
      anchorB: { id: clause.anchorB, field: resolvedB.field, date: dateB },
      reason: `Missing anchor date — anchorA=${dateA ?? 'unbound'}, anchorB=${dateB ?? 'unbound'}.`,
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
      anchorA: { id: clause.anchorA, field: resolvedA.field, date: dateA },
      anchorB: { id: clause.anchorB, field: resolvedB.field, date: dateB },
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
    anchorA: { id: clause.anchorA, field: resolvedA.field, date: dateA },
    anchorB: { id: clause.anchorB, field: resolvedB.field, date: dateB },
    reason: passed
      ? undefined
      : `Anchor gap ${actualDays}d does not match expected ${clause.days}d (tolerance ${tolerance}).`,
  };
}

function resolveAnchorDate(
  anchor: Anchor | undefined,
  side: 'start' | 'end',
  sameAnchorPair: boolean,
): { field: string | null; date: string | null } {
  if (!anchor) return { field: null, date: null };
  if (anchor.dates.event) return { field: 'event', date: anchor.dates.event };

  const datedEntries = Object.entries(anchor.dates)
    .map(([field, date]) => ({ field, date, ts: new Date(date).getTime() }))
    .filter((entry) => Number.isFinite(entry.ts))
    .sort((left, right) => left.ts - right.ts);

  if (datedEntries.length === 0) return { field: null, date: null };
  if (sameAnchorPair && datedEntries.length > 1) {
    const chosen = side === 'start' ? datedEntries[0]! : datedEntries[datedEntries.length - 1]!;
    return { field: chosen.field, date: chosen.date };
  }

  return { field: datedEntries[0]!.field, date: datedEntries[0]!.date };
}
