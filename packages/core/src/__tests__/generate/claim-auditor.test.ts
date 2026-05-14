import { describe, expect, it } from 'vitest';
import { auditClaims } from '../../generate/claim-auditor.js';
import type { Claim } from '../../types/claim.js';
import type { ExpandedData } from '../../types/dataset.js';

describe('claim auditor nested API filters', () => {
  it('matches Stripe subscription item-price filters through items.data arrays', () => {
    const claim: Claim = {
      id: 'c_starter_subs',
      quote: '1 starter subscription',
      kind: 'row_count',
      target: {
        surface: 'api',
        name: 'stripe.subscription',
        filter: { 'items.data.price.nickname': 'starter-monthly' },
      },
      expected: 1,
    };

    const blueprint = {
      data: {
        claims: [claim],
        entityArchetypes: {},
        apiEntityArchetypes: {},
      },
    } as any;

    const expanded: ExpandedData = {
      personaId: 'persona_1',
      blueprint,
      tables: {},
      documents: {},
      apiResponses: {
        stripe: {
          adapterId: 'stripe',
          responses: {
            subscription: [
              {
                statusCode: 200,
                headers: {},
                personaId: 'persona_1',
                body: {
                  id: 'sub_1',
                  items: {
                    data: [
                      {
                        price: {
                          nickname: 'starter-monthly',
                          lookup_key: 'starter-monthly',
                        },
                      },
                    ],
                    has_more: false,
                    object: 'list',
                    url: '/v1/subscription_items',
                  },
                },
              },
              {
                statusCode: 200,
                headers: {},
                personaId: 'persona_1',
                body: {
                  id: 'sub_2',
                  items: {
                    data: [
                      {
                        price: {
                          nickname: 'pro-monthly',
                          lookup_key: 'pro-monthly',
                        },
                      },
                    ],
                    has_more: false,
                    object: 'list',
                    url: '/v1/subscription_items',
                  },
                },
              },
            ],
          },
        },
      },
      files: [],
      events: [],
      facts: [],
    };

    const audit = auditClaims(blueprint, expanded);

    expect(audit.failures).toHaveLength(0);
    expect(audit.evaluations[0]?.actual).toBe(1);
  });
});