import { describe, it, expect } from 'vitest';
import {
  detectSpliceRules,
  applySpliceRules,
  spliceListEnvelopes,
  __testing__,
} from '../../generate/envelope-splice.js';
import type { AdapterResourceSpecs } from '../../types/adapter.js';
import type { ApiResponseSet, ApiResponse } from '../../types/dataset.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resp(body: Record<string, unknown>): ApiResponse {
  return {
    statusCode: 200,
    headers: {},
    body,
    personaId: 'p',
  };
}

function makeStripeLikeSpecs(): AdapterResourceSpecs {
  return {
    platform: { timestampFormat: 'unix_seconds', amountFormat: 'integer_cents' },
    resources: {
      subscription: {
        objectType: 'subscription',
        volumeHint: 'entity',
        refs: ['customer'],
        fields: {
          id: { type: 'string', required: true, idPrefix: 'sub_' },
          status: { type: 'string', required: true, default: 'active' },
          items: {
            type: 'object',
            required: true,
            default: { object: 'list', data: [], has_more: false, url: '' },
          },
        },
      },
      subscription_item: {
        objectType: 'subscription_item',
        volumeHint: 'reference',
        refs: ['price'],
        fields: {
          id: { type: 'string', required: true, idPrefix: 'si_' },
          object: { type: 'string', required: true, default: 'subscription_item' },
          subscription: { type: 'string', required: true },
          // Real Stripe specs include a full empty-Price skeleton as the
          // default for `price`. Without embed, the skeleton stays. With
          // embed, the skeleton is overwritten by the matching target body.
          price: {
            type: 'object', required: true, ref: 'price',
            default: { id: '', object: 'price', unit_amount: null, currency: '' },
          },
          quantity: { type: 'integer', required: false, default: 1 },
        },
      },
      price: {
        objectType: 'price',
        volumeHint: 'reference',
        refs: [],
        fields: {
          id: { type: 'string', required: true, idPrefix: 'price_' },
          unit_amount: { type: 'integer', required: false },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

describe('envelope-splice — detection', () => {
  it('isListEnvelopeDefault recognises Stripe-style empty list envelopes', () => {
    const { isListEnvelopeDefault } = __testing__;
    expect(isListEnvelopeDefault({ object: 'list', data: [], has_more: false, url: '' })).toBe(true);
    expect(isListEnvelopeDefault({ object: 'list', data: [] })).toBe(true);
    expect(isListEnvelopeDefault({ data: [] })).toBe(false); // missing object: 'list'
    expect(isListEnvelopeDefault({ object: 'list' })).toBe(false); // missing data
    expect(isListEnvelopeDefault(null)).toBe(false);
    expect(isListEnvelopeDefault([])).toBe(false);
    expect(isListEnvelopeDefault('list')).toBe(false);
  });

  it('singularize handles common Stripe collection names', () => {
    const { singularize } = __testing__;
    expect(singularize('items')).toBe('item');
    expect(singularize('lines')).toBe('line');
    expect(singularize('charges')).toBe('charge');
    expect(singularize('discounts')).toBe('discount');
    // edge — irregular plurals fall back to bare-strip-s; structural fallback
    // catches these elsewhere.
    expect(singularize('addresses')).toBe('address');
  });

  it('detects subscription.items ↔ subscription_item splice rule from Stripe-like spec', () => {
    const specs = makeStripeLikeSpecs();
    const rules = detectSpliceRules(specs);
    expect(rules).toEqual([
      {
        parentResource: 'subscription',
        envelopeField: 'items',
        childResource: 'subscription_item',
        backLinkField: 'subscription',
      },
    ]);
  });

  it('uses structural fallback when naming convention does not match', () => {
    const specs: AdapterResourceSpecs = {
      platform: { timestampFormat: 'unix_seconds', amountFormat: 'integer_cents' },
      resources: {
        invoice: {
          objectType: 'invoice',
          volumeHint: 'entity',
          fields: {
            id: { type: 'string', required: true, idPrefix: 'in_' },
            lines: {
              type: 'object',
              required: true,
              default: { object: 'list', data: [] },
            },
          },
        },
        // Irregular name — does NOT match invoice_line, but its default
        // `object` field is "line", which matches singular("lines").
        invoice_line_item: {
          objectType: 'invoice_line_item',
          volumeHint: 'reference',
          fields: {
            id: { type: 'string', required: true, idPrefix: 'il_' },
            object: { type: 'string', required: true, default: 'line' },
            invoice: { type: 'string', required: true },
          },
        },
      },
    };
    const rules = detectSpliceRules(specs);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      parentResource: 'invoice',
      envelopeField: 'lines',
      childResource: 'invoice_line_item',
      backLinkField: 'invoice',
    });
  });

  it('skips when no child resource matches', () => {
    const specs: AdapterResourceSpecs = {
      platform: { timestampFormat: 'unix_seconds', amountFormat: 'integer_cents' },
      resources: {
        subscription: {
          objectType: 'subscription',
          volumeHint: 'entity',
          fields: {
            id: { type: 'string', required: true, idPrefix: 'sub_' },
            items: { type: 'object', required: true, default: { object: 'list', data: [] } },
          },
        },
        // No subscription_item resource declared anywhere
      },
    };
    expect(detectSpliceRules(specs)).toEqual([]);
  });

  it('skips fields that are not list envelopes', () => {
    const specs: AdapterResourceSpecs = {
      platform: { timestampFormat: 'unix_seconds', amountFormat: 'integer_cents' },
      resources: {
        subscription: {
          objectType: 'subscription',
          volumeHint: 'entity',
          fields: {
            id: { type: 'string', required: true, idPrefix: 'sub_' },
            // Single-object field, not a list envelope
            discount: { type: 'object', required: false, default: null },
          },
        },
      },
    };
    expect(detectSpliceRules(specs)).toEqual([]);
  });

  it('detects back-link via ref field when name does not match', () => {
    const specs: AdapterResourceSpecs = {
      platform: { timestampFormat: 'unix_seconds', amountFormat: 'integer_cents' },
      resources: {
        subscription: {
          objectType: 'subscription',
          volumeHint: 'entity',
          fields: {
            id: { type: 'string', required: true, idPrefix: 'sub_' },
            items: { type: 'object', required: true, default: { object: 'list', data: [] } },
          },
        },
        subscription_item: {
          objectType: 'subscription_item',
          volumeHint: 'reference',
          fields: {
            id: { type: 'string', required: true, idPrefix: 'si_' },
            // Field name does NOT match parent — but ref does.
            parent_id: { type: 'string', required: true, ref: 'subscription' },
          },
        },
      },
    };
    const rules = detectSpliceRules(specs);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.backLinkField).toBe('parent_id');
  });
});

// ---------------------------------------------------------------------------
// Splice
// ---------------------------------------------------------------------------

describe('envelope-splice — apply', () => {
  function makeResponseSet(): ApiResponseSet {
    return {
      adapterId: 'stripe',
      responses: {
        subscription: [
          resp({ id: 'sub_001', status: 'active',
            items: { object: 'list', data: [], has_more: false, url: '' } }),
          resp({ id: 'sub_002', status: 'active',
            items: { object: 'list', data: [], has_more: false, url: '' } }),
        ],
        subscription_item: [
          resp({ id: 'si_001', object: 'subscription_item', subscription: 'sub_001',
            price: { id: 'price_starter', unit_amount: 2900 }, quantity: 1 }),
          resp({ id: 'si_002', object: 'subscription_item', subscription: 'sub_002',
            price: { id: 'price_pro', unit_amount: 7900 }, quantity: 1 }),
          resp({ id: 'si_003', object: 'subscription_item', subscription: 'sub_001',
            price: { id: 'price_addon', unit_amount: 500 }, quantity: 2 }),
        ],
      },
    };
  }

  it('splices children into the parent envelope by back-link', () => {
    const set = makeResponseSet();
    const stats = applySpliceRules(set, [{
      parentResource: 'subscription',
      envelopeField: 'items',
      childResource: 'subscription_item',
      backLinkField: 'subscription',
    }]);
    expect(stats.envelopesPopulated).toBe(2);
    expect(stats.childrenAttached).toBe(3);

    const sub1 = set.responses.subscription![0]!.body as Record<string, unknown>;
    const sub2 = set.responses.subscription![1]!.body as Record<string, unknown>;
    const items1 = sub1.items as { object: string; data: Array<{ id: string }>; has_more: boolean };
    const items2 = sub2.items as { object: string; data: Array<{ id: string }>; has_more: boolean };

    expect(items1.object).toBe('list');
    expect(items1.has_more).toBe(false);
    expect(items1.data.map((c) => c.id)).toEqual(['si_001', 'si_003']);
    expect(items2.data.map((c) => c.id)).toEqual(['si_002']);
  });

  it('leaves children as top-level siblings (Stripe-style two-path access)', () => {
    const set = makeResponseSet();
    applySpliceRules(set, [{
      parentResource: 'subscription',
      envelopeField: 'items',
      childResource: 'subscription_item',
      backLinkField: 'subscription',
    }]);
    // The child resource list is untouched — children appear both inline
    // and as siblings.
    expect(set.responses.subscription_item!.length).toBe(3);
  });

  it('produces empty envelope when no children match (rare but valid)', () => {
    const set: ApiResponseSet = {
      adapterId: 'stripe',
      responses: {
        subscription: [
          resp({ id: 'sub_lonely', items: { object: 'list', data: [], has_more: false } }),
        ],
        subscription_item: [],
      },
    };
    applySpliceRules(set, [{
      parentResource: 'subscription',
      envelopeField: 'items',
      childResource: 'subscription_item',
      backLinkField: 'subscription',
    }]);
    const body = set.responses.subscription![0]!.body as Record<string, unknown>;
    const items = body.items as { data: unknown[] };
    expect(items.data).toEqual([]);
  });

  it('children with dangling back-link end up in no envelope', () => {
    const set: ApiResponseSet = {
      adapterId: 'stripe',
      responses: {
        subscription: [
          resp({ id: 'sub_001', items: { object: 'list', data: [] } }),
        ],
        subscription_item: [
          resp({ id: 'si_001', subscription: 'sub_001', price: { unit_amount: 2900 } }),
          resp({ id: 'si_orphan', subscription: 'sub_does_not_exist', price: { unit_amount: 99 } }),
        ],
      },
    };
    const stats = applySpliceRules(set, [{
      parentResource: 'subscription',
      envelopeField: 'items',
      childResource: 'subscription_item',
      backLinkField: 'subscription',
    }]);
    expect(stats.childrenAttached).toBe(1);
    // The orphan is still reachable as a sibling — not deleted.
    expect(set.responses.subscription_item!.length).toBe(2);
  });

  it('skips rules whose parent or child resource is absent from the response set', () => {
    const set: ApiResponseSet = {
      adapterId: 'stripe',
      responses: {
        subscription: [resp({ id: 'sub_001', items: { object: 'list', data: [] } })],
        // subscription_item missing
      },
    };
    const stats = applySpliceRules(set, [{
      parentResource: 'subscription',
      envelopeField: 'items',
      childResource: 'subscription_item',
      backLinkField: 'subscription',
    }]);
    expect(stats.envelopesPopulated).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: spliceListEnvelopes() against a spec bundle
// ---------------------------------------------------------------------------

describe('envelope-splice — spliceListEnvelopes (end-to-end)', () => {
  it('detects + splices for each adapter in the bundle', () => {
    const apiResponses: Record<string, ApiResponseSet> = {
      stripe: {
        adapterId: 'stripe',
        responses: {
          subscription: [
            resp({ id: 'sub_001', items: { object: 'list', data: [] } }),
          ],
          subscription_item: [
            resp({ id: 'si_001', subscription: 'sub_001',
              price: { id: 'price_starter', unit_amount: 2900 } }),
          ],
          price: [resp({ id: 'price_starter', unit_amount: 2900 })],
        },
      },
    };
    const specs = { stripe: makeStripeLikeSpecs() };

    spliceListEnvelopes(apiResponses, specs);

    const sub = apiResponses.stripe!.responses.subscription![0]!.body as Record<string, unknown>;
    const items = sub.items as { data: Array<{ price: { unit_amount: number } }> };
    expect(items.data).toHaveLength(1);
    expect(items.data[0]!.price.unit_amount).toBe(2900);
  });

  it('implicit back-link gets resolved via assembler + resolver, then spliced', async () => {
    // End-to-end: feed a Stripe-like spec through assembler → expander, and
    // confirm the spliced parent envelope carries the real child record with
    // its price intact. Proves the three changes work together:
    //   1. Assembler emits gen_subscription_* placeholder on the back-link.
    //   2. Cross-ref resolver swaps the placeholder for a real parent id
    //      (via implicit back-link detection on the resourceSpecs).
    //   3. Splice groups children under the matching parent envelope.
    const { assembleResourceArchetypes } = await import(
      '../../generate/resource-assembler.js'
    );
    const { BlueprintExpander } = await import('../../generate/expander.js');

    const specs = makeStripeLikeSpecs();
    const distributions = {
      subscription: {
        count: 2,
        archetypes: [{
          label: 'active', weight: 1,
          fieldOverrides: { status: 'active' },
        }],
      },
      subscription_item: {
        count: 2,
        archetypes: [{ label: 'item', weight: 1 }],
      },
      price: {
        count: 1,
        archetypes: [{
          label: 'starter', weight: 1,
          fieldOverrides: { unit_amount: 2900 },
        }],
      },
    };
    const apiEntityArchetypes = {
      stripe: assembleResourceArchetypes(specs, distributions),
    };

    const blueprint = {
      version: '1.0' as const,
      personaId: 'test',
      domain: 'test',
      generatedAt: new Date().toISOString(),
      generatedBy: 'test',
      checksum: 'test',
      persona: {} as never,
      data: {
        entities: {},
        patterns: [],
        annotations: {},
        facts: [],
        entityArchetypes: {},
        apiEntityArchetypes,
        anchors: [],
      },
    };

    const expander = new BlueprintExpander(42);
    const expanded = expander.expand(
      blueprint,
      { tables: [], enums: [], insertionOrder: [] },
      '1 month',
      undefined,
      undefined,
      undefined,
      undefined,
      { stripe: specs },
    );

    const subs = expanded.apiResponses.stripe!.responses.subscription!;
    expect(subs).toHaveLength(2);

    // Parent envelopes populated, each child's back-link points to its
    // parent, AND each child's `price` is the full embedded Price object
    // (not a string id). This is the end-to-end contract: splice + embed
    // together produce Stripe's actual subscription response shape.
    let envelopesPopulated = 0;
    for (const subResp of subs) {
      const body = subResp.body as Record<string, unknown>;
      const items = body.items as { object: string; data: Array<Record<string, unknown>> };
      expect(items.object).toBe('list');
      if (items.data.length > 0) {
        envelopesPopulated += 1;
        for (const child of items.data) {
          expect(child.subscription).toBe(body.id);
          const price = child.price as { id: string; unit_amount: number };
          expect(typeof price).toBe('object');
          expect(price.unit_amount).toBe(2900);
          expect(price.id).toMatch(/^price_/);
        }
      }
    }
    expect(envelopesPopulated).toBeGreaterThan(0);
  });

  it('is a no-op when resourceSpecs is undefined', () => {
    const apiResponses: Record<string, ApiResponseSet> = {
      stripe: {
        adapterId: 'stripe',
        responses: {
          subscription: [resp({ id: 'sub_001', items: { object: 'list', data: [] } })],
        },
      },
    };
    spliceListEnvelopes(apiResponses, undefined);
    const sub = apiResponses.stripe!.responses.subscription![0]!.body as Record<string, unknown>;
    expect((sub.items as { data: unknown[] }).data).toEqual([]);
  });
});
