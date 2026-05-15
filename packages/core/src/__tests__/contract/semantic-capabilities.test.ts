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

  it('canonicalises raw product user cohorts onto semantic targets and tighter db filters', () => {
    const clauses: Clause[] = [
      {
        id: 'paying-users',
        quote: '2,847 paying customers in the product database',
        family: 'count',
        strength: 'hard',
        target: {
          surface: 'db',
          name: 'users',
          filter: { status: 'active' },
        },
        expected: 2847,
      },
      {
        id: 'orphans',
        quote: '34 users in the database with paid plan flags but no corresponding billing platform record',
        family: 'count',
        strength: 'hard',
        target: {
          surface: 'db',
          name: 'users',
          filter: { status: 'active' },
        },
        expected: 34,
      },
      {
        id: 'stripe-mrr',
        quote: '£77k MRR on Stripe',
        family: 'aggregate',
        op: 'sum',
        strength: 'hard',
        target: {
          surface: 'db',
          name: 'users',
          filter: { status: 'active', billing_platform: 'stripe' },
        },
        field: 'mrr_cents',
        expected: 7_700_000,
      },
    ];

    const changed = canonicaliseSemanticClauses(clauses);

    expect(changed).toBe(7);
    expect(clauses[0]).toMatchObject({
      semanticTarget: {
        kind: 'product_user_cohort',
        table: 'users',
        facets: { billingState: 'paying' },
      },
      target: {
        filter: { status: 'active', plan: { neq: 'free' } },
      },
    });
    expect(clauses[1]).toMatchObject({
      semanticTarget: {
        kind: 'product_user_cohort',
        table: 'users',
        facets: { billingState: 'paying', linkage: 'unlinked' },
      },
      target: {
        filter: { status: 'active', plan: { neq: 'free' }, billing_platform: null },
      },
    });
    expect(clauses[2]).toMatchObject({
      semanticTarget: {
        kind: 'product_user_cohort',
        table: 'users',
        facets: { billingState: 'paying' },
      },
      target: {
        filter: { status: 'active', billing_platform: 'stripe', plan: { neq: 'free' } },
      },
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

  it('resolves product user cohorts into executable db user targets', () => {
    const resolved = resolveSemanticTarget({
      kind: 'product_user_cohort',
      table: 'users',
      facets: { billingState: 'paying', linkage: 'unlinked' },
    });

    expect(resolved?.target).toEqual({
      surface: 'db',
      name: 'users',
      filter: { plan: { neq: 'free' }, billing_platform: null },
    });
  });
});