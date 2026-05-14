import { describe, it, expect } from 'vitest';
import type { Clause } from '../../contract/clause-types.js';
import {
  buildBillingTierAliases,
  canonicaliseBillingTierValue,
  canonicaliseSemanticClauses,
  resolveSemanticTarget,
} from '../../contract/semantic-capabilities.js';

describe('semantic capability registry', () => {
  it('canonicalises tier labels and alias variants', () => {
    expect(canonicaliseBillingTierValue('starter-monthly')).toBe('starter');
    expect(buildBillingTierAliases('starter')).toContain('starter-monthly');
    expect(buildBillingTierAliases('starter')).toContain('starter_annual');
  });

  it('canonicalises raw subscription tier clauses onto semantic targets', () => {
    const clauses: Clause[] = [
      {
        id: 'starter-customers',
        quote: '100 starter customers',
        family: 'count',
        strength: 'hard',
        target: {
          surface: 'api',
          name: 'stripe.subscription',
          filter: { plan_nickname: 'starter-monthly' },
        },
        expected: 100,
      },
      {
        id: 'tier-mix',
        quote: '60% starter, 40% pro',
        family: 'distribution',
        strength: 'hard',
        target: { surface: 'api', name: 'stripe.subscription' },
        field: 'items.data.price.lookup_key',
        values: { 'starter-monthly': 60, pro: 40 },
      },
    ];

    const changed = canonicaliseSemanticClauses(clauses);
    expect(changed).toBe(3);
    expect(clauses[0]).toMatchObject({
      semanticTarget: {
        kind: 'billing_customer_cohort',
        adapter: 'stripe',
        facets: { billingState: 'paying', tier: 'starter' },
      },
    });
    expect(clauses[1]).toMatchObject({
      semanticTarget: {
        kind: 'billing_customer_cohort',
        adapter: 'stripe',
        facets: { billingState: 'paying' },
      },
      semanticField: 'tier',
      values: { starter: 60, pro: 40 },
    });
  });

  it('resolves billing customer cohorts into executable Stripe subscription targets', () => {
    const resolved = resolveSemanticTarget({
      kind: 'billing_customer_cohort',
      adapter: 'stripe',
      facets: { billingState: 'paying', tier: 'starter' },
    });

    expect(resolved?.target.surface).toBe('api');
    expect(resolved?.target.name).toBe('stripe.subscription');
    expect(resolved?.target.filter).toMatchObject({
      status: { in: ['active', 'trialing', 'past_due', 'unpaid'] },
      'items.data.price.lookup_key': {
        in: expect.arrayContaining(['starter', 'starter-monthly', 'starter_annual']),
      },
    });
  });
});