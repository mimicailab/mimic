/**
 * Claim sanitiser — drops or demotes malformed claims that would otherwise
 * become load-bearing predicates downstream.
 *
 * Failure mode it addresses: the claim extractor produces shapes the LLM
 * thinks are reasonable but which can never pass. Examples observed on
 * cfo-agent-skills:
 *
 *   - `aggregate_avg expected = 8.2` for "8.2% MoM growth" — 8.2 is a
 *     percentage, not a value to average. The auditor will compare avg-of-rows
 *     to 8.2 and always fail.
 *   - `date_window expected = 6` for "6 months of billing history" — 6 is
 *     the duration, not a row count.
 *   - `row_count` on a DB table whose claims also include a `distribution_pct`
 *     over the same column — the row_count is redundant and inconsistent.
 *
 * Pure function — no LLM, no I/O. Run between extraction and bridge rewrite.
 */

import type { Claim } from '../types/claim.js';
import { logger } from '../utils/logger.js';

export interface SanitiseResult {
  claims: Claim[];
  /** Per-claim sanitiser decisions, for telemetry */
  decisions: SanitiseDecision[];
}

export interface SanitiseDecision {
  claimId: string;
  action: 'kept' | 'dropped' | 'demoted';
  reason: string;
}

export function sanitiseClaims(input: ReadonlyArray<Claim>): SanitiseResult {
  const decisions: SanitiseDecision[] = [];
  const out: Claim[] = [];

  // First pass: detect targets with a distribution_pct claim so we can demote
  // sibling row_count claims that target the same field.
  const distributionTargets = new Set<string>();
  for (const c of input) {
    if (c.kind === 'distribution_pct') {
      distributionTargets.add(`${c.target.surface}:${c.target.name}:${c.field}`);
    }
  }

  for (const claim of input) {
    const verdict = inspectClaim(claim, distributionTargets);
    decisions.push({ claimId: claim.id, action: verdict.action, reason: verdict.reason });
    if (verdict.action === 'dropped') continue;
    if (verdict.action === 'demoted' && verdict.replacement) {
      out.push(verdict.replacement);
    } else {
      out.push(claim);
    }
  }

  const dropped = decisions.filter((d) => d.action === 'dropped').length;
  const demoted = decisions.filter((d) => d.action === 'demoted').length;
  if (dropped + demoted > 0) {
    logger.info(
      `Claim sanitiser: kept ${decisions.length - dropped - demoted}, demoted ${demoted}, dropped ${dropped}.`,
    );
    for (const d of decisions) {
      if (d.action !== 'kept') {
        logger.debug(`  ${d.action} ${d.claimId}: ${d.reason}`);
      }
    }
  }

  return { claims: out, decisions };
}

type Verdict =
  | { action: 'kept'; reason: string }
  | { action: 'dropped'; reason: string }
  | { action: 'demoted'; reason: string; replacement: Claim };

function inspectClaim(claim: Claim, distributionTargets: Set<string>): Verdict {
  // `aggregate_avg` / `aggregate_sum` with a percentage-looking expected and
  // no monetary or count context: the value is almost certainly a percentage
  // misread as a numeric value.
  if (claim.kind === 'aggregate_avg' || claim.kind === 'aggregate_sum') {
    const looksLikePct =
      typeof claim.expected === 'number' &&
      claim.expected > 0 &&
      claim.expected <= 100 &&
      mentionsPercent(claim.quote);
    const fieldLooksLikeRate =
      claim.field.toLowerCase().includes('pct') ||
      claim.field.toLowerCase().includes('rate') ||
      claim.field.toLowerCase().includes('percent');
    if (looksLikePct && !fieldLooksLikeRate) {
      return {
        action: 'dropped',
        reason:
          `${claim.kind} expected=${claim.expected} with quote mentioning a percentage — looks like a rate misread as a value. Dropping (auditor would always fail).`,
      };
    }
  }

  // `date_window` where `expected` is small and the quote talks about a
  // duration (months/weeks): the LLM stuffed a duration into a row count.
  if (claim.kind === 'date_window') {
    const expectedIsLowDuration = claim.expected > 0 && claim.expected <= 12;
    const quoteIsDuration = /\b\d+\s*(month|week|day|year|quarter)s?\b/i.test(claim.quote);
    if (expectedIsLowDuration && quoteIsDuration && !looksLikeRowCountContext(claim.quote)) {
      return {
        action: 'dropped',
        reason:
          `date_window expected=${claim.expected} from a duration quote — value is the duration, not a row count.`,
      };
    }
    if (!isValidIsoDate(claim.min) || !isValidIsoDate(claim.max)) {
      return {
        action: 'dropped',
        reason: `date_window min/max not valid ISO dates (min="${claim.min}", max="${claim.max}").`,
      };
    }
  }

  // `row_count` on a target that ALSO has a distribution_pct claim over
  // some field — the row_count usually IS the parent total a distribution
  // applies to. Keep it; only drop if the row_count expected suspiciously
  // matches a bucket count (e.g. someone wrote `row_count: 8` for "8
  // distinct platforms" when it's a count-distinct).
  if (claim.kind === 'row_count' && claim.expected > 0 && claim.expected <= 20) {
    const sayDistinct = /\b(distinct|unique|different|platforms?|types?|categories|kinds?)\b/i.test(
      claim.quote,
    );
    const targetKey = `${claim.target.surface}:${claim.target.name}`;
    // If another distribution_pct claim targets the same table, AND the
    // row_count expected is small AND the quote says "distinct/unique", the
    // count is almost certainly a count-distinct, not a row count.
    const hasSiblingDistribution = [...distributionTargets].some((t) =>
      t.startsWith(`${targetKey}:`),
    );
    if (sayDistinct && hasSiblingDistribution) {
      return {
        action: 'dropped',
        reason:
          `row_count expected=${claim.expected} on ${targetKey} with quote suggesting count-distinct + sibling distribution_pct claim. Likely a count-distinct miscoded as row_count.`,
      };
    }
  }

  return { action: 'kept', reason: '' };
}

function mentionsPercent(quote: string): boolean {
  if (/%/.test(quote)) return true;
  if (/\bpercent(age)?\b/i.test(quote)) return true;
  if (/\bgrowth\b/i.test(quote) && /\d+(\.\d+)?\s*%?/.test(quote)) return true;
  if (/\bMoM\b|\bYoY\b|\bWoW\b/i.test(quote)) return true;
  return false;
}

function looksLikeRowCountContext(quote: string): boolean {
  return /\b(row|record|entry|customer|user|invoice|transaction|charge|payment|subscription)s?\b/i.test(
    quote,
  );
}

function isValidIsoDate(s: string | undefined): boolean {
  if (!s || typeof s !== 'string') return false;
  // Accept "YYYY-MM-DD" or full ISO timestamps.
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}|$)/.test(s)) return false;
  const t = Date.parse(s);
  return Number.isFinite(t);
}
