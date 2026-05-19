import { describe, it, expect } from 'vitest';
import {
  detectEmbedRules,
  applyEmbedRules,
  embedObjectRefs,
} from '../../generate/object-ref-embed.js';
import { SeededRandom } from '../../generate/seed-random.js';
import type { AdapterResourceSpecs } from '../../types/adapter.js';
import type { ApiResponseSet, ApiResponse } from '../../types/dataset.js';

function resp(body: Record<string, unknown>): ApiResponse {
  return { statusCode: 200, headers: {}, body, personaId: 'p' };
}

function makeSpecs(): AdapterResourceSpecs {
  return {
    platform: { timestampFormat: 'unix_seconds', amountFormat: 'integer_cents' },
    resources: {
      subscription_item: {
        objectType: 'subscription_item',
        volumeHint: 'reference',
        fields: {
          id: { type: 'string', required: true, idPrefix: 'si_' },
          subscription: { type: 'string', required: true },
          price: {
            type: 'object', required: true, ref: 'price',
            default: { id: '', object: 'price', unit_amount: null },
          },
          quantity: { type: 'integer', required: false, default: 1 },
        },
      },
      price: {
        objectType: 'price',
        volumeHint: 'reference',
        fields: {
          id: { type: 'string', required: true, idPrefix: 'price_' },
          unit_amount: { type: 'integer', required: false },
          currency: { type: 'string', required: true, default: 'gbp' },
        },
      },
    },
  };
}

describe('object-ref-embed — detection', () => {
  it('detects type:object + ref fields as embed rules', () => {
    const rules = detectEmbedRules(makeSpecs());
    expect(rules).toEqual([
      { parentResource: 'subscription_item', fieldName: 'price', targetResource: 'price' },
    ]);
  });

  it('skips string ref fields (not embed candidates)', () => {
    const specs: AdapterResourceSpecs = {
      platform: { timestampFormat: 'unix_seconds', amountFormat: 'integer_cents' },
      resources: {
        subscription: {
          objectType: 'subscription',
          volumeHint: 'entity',
          fields: {
            id: { type: 'string', required: true, idPrefix: 'sub_' },
            customer: { type: 'string', required: true, ref: 'customer' },
          },
        },
        customer: {
          objectType: 'customer', volumeHint: 'entity',
          fields: { id: { type: 'string', required: true, idPrefix: 'cus_' } },
        },
      },
    };
    expect(detectEmbedRules(specs)).toEqual([]);
  });

  it('skips object refs that point to a missing resource', () => {
    const specs: AdapterResourceSpecs = {
      platform: { timestampFormat: 'unix_seconds', amountFormat: 'integer_cents' },
      resources: {
        subscription_item: {
          objectType: 'subscription_item', volumeHint: 'reference',
          fields: {
            id: { type: 'string', required: true, idPrefix: 'si_' },
            price: { type: 'object', required: true, ref: 'price' },
          },
        },
        // No `price` resource declared.
      },
    };
    expect(detectEmbedRules(specs)).toEqual([]);
  });
});

describe('object-ref-embed — apply', () => {
  function makeResponseSet(): ApiResponseSet {
    return {
      adapterId: 'stripe',
      responses: {
        subscription_item: [
          resp({ id: 'si_001', subscription: 'sub_001',
                 price: { id: '', object: 'price', unit_amount: null } }),
          resp({ id: 'si_002', subscription: 'sub_002',
                 price: { id: '', object: 'price', unit_amount: null } }),
        ],
        price: [
          resp({ id: 'price_starter', unit_amount: 2900, currency: 'gbp' }),
          resp({ id: 'price_pro',     unit_amount: 7900, currency: 'gbp' }),
        ],
      },
    };
  }

  const rule = { parentResource: 'subscription_item', fieldName: 'price', targetResource: 'price' };

  it('replaces the empty skeleton with a real target body', () => {
    const set = makeResponseSet();
    const stats = applyEmbedRules(set, [rule], new SeededRandom(42));
    expect(stats.embedsApplied).toBe(2);
    for (const r of set.responses.subscription_item!) {
      const body = r.body as Record<string, unknown>;
      const price = body.price as { id: string; unit_amount: number };
      expect(typeof price).toBe('object');
      expect(price.id).toMatch(/^price_/);
      expect(typeof price.unit_amount).toBe('number');
    }
  });

  it('honours an LLM-pinned target id (keyed lookup)', () => {
    const set = makeResponseSet();
    // Override one child to pin price_pro.
    (set.responses.subscription_item![0]!.body as Record<string, unknown>).price = {
      id: 'price_pro', object: 'price', unit_amount: null,
    };
    applyEmbedRules(set, [rule], new SeededRandom(42));
    const pinned = (set.responses.subscription_item![0]!.body as Record<string, unknown>)
      .price as { id: string; unit_amount: number };
    expect(pinned.id).toBe('price_pro');
    expect(pinned.unit_amount).toBe(7900);
  });

  it('embeds when the string IS a real target id (assembler/resolver leftover)', () => {
    // This is the cfo-shape case: the assembler emitted a sequence
    // variation for an object-ref field, the cross-ref resolver landed
    // on a real id string. The spec still says this field is an embed,
    // so the embed phase should recover by looking up the id in the
    // target pool.
    const set = makeResponseSet();
    (set.responses.subscription_item![0]!.body as Record<string, unknown>).price = 'price_starter';
    const stats = applyEmbedRules(set, [rule], new SeededRandom(42));
    expect(stats.embedsApplied).toBeGreaterThanOrEqual(1);
    const v = (set.responses.subscription_item![0]!.body as Record<string, unknown>).price;
    expect(typeof v).toBe('object');
    expect((v as { unit_amount: number }).unit_amount).toBe(2900);
  });

  it('preserves a string that does NOT match any pool id (deliberate literal)', () => {
    const set = makeResponseSet();
    (set.responses.subscription_item![0]!.body as Record<string, unknown>).price = 'arbitrary_value';
    const stats = applyEmbedRules(set, [rule], new SeededRandom(42));
    expect(stats.embedsSkipped).toBeGreaterThanOrEqual(1);
    const v = (set.responses.subscription_item![0]!.body as Record<string, unknown>).price;
    expect(v).toBe('arbitrary_value');
  });

  it('produces deterministic embeds for a given seed', () => {
    const a = makeResponseSet();
    const b = makeResponseSet();
    applyEmbedRules(a, [rule], new SeededRandom(123));
    applyEmbedRules(b, [rule], new SeededRandom(123));
    const aPrice = (a.responses.subscription_item![0]!.body as Record<string, unknown>).price as { id: string };
    const bPrice = (b.responses.subscription_item![0]!.body as Record<string, unknown>).price as { id: string };
    expect(aPrice.id).toBe(bPrice.id);
  });

  it('no-op when the target pool is empty', () => {
    const set: ApiResponseSet = {
      adapterId: 'stripe',
      responses: {
        subscription_item: [
          resp({ id: 'si_001', subscription: 'sub_001',
                 price: { id: '', object: 'price', unit_amount: null } }),
        ],
        price: [],
      },
    };
    const stats = applyEmbedRules(set, [rule], new SeededRandom(42));
    expect(stats.embedsApplied).toBe(0);
    const body = set.responses.subscription_item![0]!.body as Record<string, unknown>;
    const price = body.price as { id: string; unit_amount: unknown };
    expect(price.id).toBe('');
    expect(price.unit_amount).toBe(null);
  });
});

describe('object-ref-embed — embedObjectRefs (end-to-end)', () => {
  it('detects + embeds across every adapter in the bundle', () => {
    const set: ApiResponseSet = {
      adapterId: 'stripe',
      responses: {
        subscription_item: [
          resp({ id: 'si_001', subscription: 'sub_001',
                 price: { id: '', object: 'price', unit_amount: null } }),
        ],
        price: [resp({ id: 'price_starter', unit_amount: 2900, currency: 'gbp' })],
      },
    };
    const apiResponses: Record<string, ApiResponseSet> = { stripe: set };
    embedObjectRefs(apiResponses, { stripe: makeSpecs() }, new SeededRandom(42));
    const price = (set.responses.subscription_item![0]!.body as Record<string, unknown>)
      .price as { unit_amount: number };
    expect(price.unit_amount).toBe(2900);
  });

  it('is a no-op when resourceSpecs is undefined', () => {
    const set: ApiResponseSet = {
      adapterId: 'stripe',
      responses: {
        subscription_item: [
          resp({ id: 'si_001', price: { id: '', unit_amount: null } }),
        ],
      },
    };
    embedObjectRefs({ stripe: set }, undefined, new SeededRandom(42));
    const price = (set.responses.subscription_item![0]!.body as Record<string, unknown>)
      .price as { unit_amount: unknown };
    expect(price.unit_amount).toBe(null);
  });
});
