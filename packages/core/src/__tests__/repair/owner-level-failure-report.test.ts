import { describe, expect, it } from 'vitest';

import { formatOwnerLevelFailureReport } from '../../repair/owner-level-failure-report.js';
import type { OwnerLevelFailureReport } from '../../repair/owner-level-failure-report.js';

describe('owner-level failure report formatting', () => {
  it('renders per-failure owners instead of collapsing to the first owner', () => {
    const report: OwnerLevelFailureReport = {
      cause: 'regen_exhausted',
      ownerId: 'population',
      clauseIds: ['total-paying-customers', 'total-mrr-reconciliation'],
      quotes: ['Total ~2,847 paying customers.', 'approximately £127k MRR across 8 billing platforms'],
      failures: [
        {
          clauseId: 'total-paying-customers',
          family: 'count',
          strength: 'hard',
          passed: false,
          quote: 'Total ~2,847 paying customers.',
          predicate: 'count(db.users where status=active) = 2847',
          reason: 'expected 2847, got 34',
          actual: 34,
          ownerId: 'population',
          source: 'planner',
        },
        {
          clauseId: 'total-mrr-reconciliation',
          family: 'reconciliation',
          strength: 'hard',
          passed: false,
          quote: 'approximately £127k MRR across 8 billing platforms',
          predicate: 'reconciliation(mrr) headline=12700000 ≈ Σbuckets',
          reason: 'bucket sum mismatch',
          actual: { headline: 12700000, bucketSum: 40965300 },
          ownerId: 'reconciliation',
          source: 'planner',
        },
      ],
      attempts: 2,
    };

    const formatted = formatOwnerLevelFailureReport(report);

    expect(formatted).toContain('2 clause(s) still failing across population, reconciliation.');
    expect(formatted).toContain('First failing planner: "population".');
    expect(formatted).toContain('[owner=population] total-paying-customers');
    expect(formatted).toContain('[owner=reconciliation] total-mrr-reconciliation');
  });
});