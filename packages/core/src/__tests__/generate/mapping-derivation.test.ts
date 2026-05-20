import { describe, it, expect } from 'vitest';
import {
  parsePath,
  resolvePath,
  applyDerivation,
  validateMappings,
  formatValidationErrorsForRetry,
} from '../../generate/mapping-derivation.js';
import type { SchemaMapping } from '../../types/blueprint.js';
import type { SchemaModel } from '../../types/schema.js';
import type { AdapterResourceSpecs } from '../../types/adapter.js';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe('mapping-derivation — parsePath', () => {
  it('splits a dotted path', () => {
    expect(parsePath('items.data.0.price.unit_amount')).toEqual([
      'items', 'data', '0', 'price', 'unit_amount',
    ]);
  });

  it('normalizes [N] bracket form to bare segments', () => {
    expect(parsePath('items.data[0].price.unit_amount')).toEqual([
      'items', 'data', '0', 'price', 'unit_amount',
    ]);
  });

  it('handles a single segment', () => {
    expect(parsePath('product_id')).toEqual(['product_id']);
  });

  it('ignores empty segments from leading/trailing dots', () => {
    expect(parsePath('.items.data.')).toEqual(['items', 'data']);
  });
});

describe('mapping-derivation — resolvePath', () => {
  const body = {
    id: 'sub_001',
    items: {
      data: [
        { id: 'si_001', price: { unit_amount: 2900, currency: 'gbp' } },
        { id: 'si_002', price: { unit_amount: 99,   currency: 'gbp' } },
      ],
    },
    metadata: { tier: 'starter' },
  };

  it('walks nested objects', () => {
    expect(resolvePath(body, 'metadata.tier')).toBe('starter');
  });

  it('walks into arrays via numeric segment', () => {
    expect(resolvePath(body, 'items.data.0.price.unit_amount')).toBe(2900);
    expect(resolvePath(body, 'items.data.1.price.currency')).toBe('gbp');
  });

  it('accepts [N] bracket form', () => {
    expect(resolvePath(body, 'items.data[0].price.unit_amount')).toBe(2900);
  });

  it('returns undefined when a segment is missing', () => {
    expect(resolvePath(body, 'items.data.0.price.unknown')).toBeUndefined();
    expect(resolvePath(body, 'missing.path')).toBeUndefined();
    expect(resolvePath(null, 'x')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// applyDerivation runtime
// ---------------------------------------------------------------------------

describe('mapping-derivation — applyDerivation', () => {
  it('constant always returns its value', () => {
    const r = applyDerivation(
      { whatever: 'ignored' },
      { kind: 'constant', value: 'starter' },
    );
    expect(r).toEqual({ ok: true, value: 'starter' });
  });

  it('derive picks the case matching the path value (numeric source)', () => {
    const body = { items: { data: [{ price: { unit_amount: 7900 } }] } };
    const r = applyDerivation(body, {
      kind: 'derive',
      from: 'items.data[0].price.unit_amount',
      cases: { '2900': 'starter', '7900': 'pro', '49900': 'enterprise' },
      default: 'free',
    });
    expect(r).toEqual({ ok: true, value: 'pro' });
  });

  it('derive falls back to default when no case matches', () => {
    const body = { items: { data: [{ price: { unit_amount: 12345 } }] } };
    const r = applyDerivation(body, {
      kind: 'derive',
      from: 'items.data[0].price.unit_amount',
      cases: { '2900': 'starter', '7900': 'pro' },
      default: 'free',
    });
    expect(r).toEqual({ ok: true, value: 'free' });
  });

  it('derive returns ok:false when no case matches and no default', () => {
    const body = { items: { data: [{ price: { unit_amount: 12345 } }] } };
    const r = applyDerivation(body, {
      kind: 'derive',
      from: 'items.data[0].price.unit_amount',
      cases: { '2900': 'starter' },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('12345');
  });

  it('derive falls back to default when path is missing', () => {
    const r = applyDerivation({}, {
      kind: 'derive',
      from: 'items.data[0].price.unit_amount',
      cases: { '2900': 'starter' },
      default: 'free',
    });
    expect(r).toEqual({ ok: true, value: 'free' });
  });

  it('derive returns ok:false when path is missing and no default', () => {
    const r = applyDerivation({}, {
      kind: 'derive',
      from: 'items.data[0].price.unit_amount',
      cases: { '2900': 'starter' },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('missing');
  });

  it('derive matches string source values too', () => {
    const body = { product_id: 'com.foo.starter.monthly' };
    const r = applyDerivation(body, {
      kind: 'derive',
      from: 'product_id',
      cases: {
        'com.foo.starter.monthly': 'starter',
        'com.foo.pro.monthly': 'pro',
      },
    });
    expect(r).toEqual({ ok: true, value: 'starter' });
  });
});

// ---------------------------------------------------------------------------
// validateMappings — pre-mirror catch
// ---------------------------------------------------------------------------

function makeSchema(): SchemaModel {
  return {
    tables: [
      {
        name: 'users',
        columns: [
          {
            name: 'plan', type: 'varchar', pgType: 'varchar',
            isNullable: false, isAutoIncrement: false, isGenerated: false,
            hasDefault: false, enumValues: ['free', 'starter', 'pro', 'enterprise'],
          },
          {
            name: 'email', type: 'varchar', pgType: 'varchar',
            isNullable: true, isAutoIncrement: false, isGenerated: false,
            hasDefault: false,
          },
        ],
        primaryKey: ['plan'],
        foreignKeys: [],
        uniqueConstraints: [],
        checkConstraints: [],
      },
    ],
    enums: [],
    insertionOrder: ['users'],
  };
}

function makeSpecs(): Record<string, AdapterResourceSpecs> {
  return {
    stripe: {
      platform: { timestampFormat: 'unix_seconds', amountFormat: 'integer_cents' },
      resources: {
        subscription: {
          objectType: 'subscription', volumeHint: 'entity',
          fields: {
            id: { type: 'string', required: true },
            items: { type: 'object', required: true,
              default: { object: 'list', data: [] } },
          },
        },
        customer: {
          objectType: 'customer', volumeHint: 'entity',
          fields: { id: { type: 'string', required: true } },
        },
      },
    },
    paddle: {
      platform: { timestampFormat: 'unix_seconds', amountFormat: 'integer_cents' },
      resources: {
        subscription: {
          objectType: 'subscription', volumeHint: 'entity',
          fields: {
            id: { type: 'string', required: true },
            collection_mode: {
              type: 'string', required: true,
              enum: ['automatic', 'manual'],
            },
          },
        },
      },
    },
  };
}

describe('mapping-derivation — validateMappings', () => {
  it('accepts a well-formed derive mapping', () => {
    const mapping: SchemaMapping = {
      mappings: [{
        dbTable: 'users', dbColumn: 'plan',
        adapterId: 'stripe', apiResource: 'subscription', apiField: 'id',
        isBridgeTable: true, direction: 'drift_capable',
        derivation: {
          kind: 'derive',
          from: 'items.data[0].price.unit_amount',
          cases: { '2900': 'starter', '7900': 'pro', '49900': 'enterprise' },
          default: 'free',
        },
      }],
      bridgeTables: ['users'],
    };
    expect(validateMappings(mapping, makeSchema(), makeSpecs())).toEqual([]);
  });

  it('flags cases values outside the destination enum', () => {
    const mapping: SchemaMapping = {
      mappings: [{
        dbTable: 'users', dbColumn: 'plan',
        adapterId: 'stripe', apiResource: 'subscription', apiField: 'id',
        isBridgeTable: true, direction: 'drift_capable',
        derivation: {
          kind: 'derive',
          from: 'items.data[0].price.unit_amount',
          cases: { '2900': 'starter', '7900': 'premium' },  // 'premium' not in enum
        },
      }],
      bridgeTables: ['users'],
    };
    const errors = validateMappings(mapping, makeSchema(), makeSpecs());
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('enum_violation_in_cases');
  });

  it('flags constant value outside the destination enum', () => {
    const mapping: SchemaMapping = {
      mappings: [{
        dbTable: 'users', dbColumn: 'plan',
        adapterId: 'stripe', apiResource: 'customer', apiField: 'id',
        isBridgeTable: true, direction: 'mirror',
        derivation: { kind: 'constant', value: 'platinum' },  // not in enum
      }],
      bridgeTables: ['users'],
    };
    const errors = validateMappings(mapping, makeSchema(), makeSpecs());
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('enum_violation_in_constant');
  });

  it('flags default value outside the destination enum', () => {
    const mapping: SchemaMapping = {
      mappings: [{
        dbTable: 'users', dbColumn: 'plan',
        adapterId: 'stripe', apiResource: 'subscription', apiField: 'id',
        isBridgeTable: true, direction: 'drift_capable',
        derivation: {
          kind: 'derive',
          from: 'items.data[0].price.unit_amount',
          cases: { '2900': 'starter' },
          default: 'unlimited',  // not in enum
        },
      }],
      bridgeTables: ['users'],
    };
    const errors = validateMappings(mapping, makeSchema(), makeSpecs());
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('enum_violation_in_default');
  });

  it('flags blind copy from a disjoint source enum (the cfo bug)', () => {
    const mapping: SchemaMapping = {
      mappings: [{
        // Mimics the actual cfo failure: users.plan ← paddle.subscription.collection_mode
        dbTable: 'users', dbColumn: 'plan',
        adapterId: 'paddle', apiResource: 'subscription', apiField: 'collection_mode',
        isBridgeTable: true, direction: 'drift_capable',
        // NO derivation — this is the blind-copy case the cfo run actually had.
      }],
      bridgeTables: ['users'],
    };
    const errors = validateMappings(mapping, makeSchema(), makeSpecs());
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('enum_violation_in_copy');
    expect(errors[0]!.message).toContain('automatic');
  });

  it('accepts blind copy when source and dest value spaces overlap', () => {
    const mapping: SchemaMapping = {
      mappings: [{
        dbTable: 'users', dbColumn: 'email',  // nullable, no enum
        adapterId: 'stripe', apiResource: 'customer', apiField: 'id',
        isBridgeTable: true, direction: 'mirror',
      }],
      bridgeTables: ['users'],
    };
    expect(validateMappings(mapping, makeSchema(), makeSpecs())).toEqual([]);
  });

  it('flags an unknown DB column', () => {
    const mapping: SchemaMapping = {
      mappings: [{
        dbTable: 'users', dbColumn: 'plan_v2',
        adapterId: 'stripe', apiResource: 'customer', apiField: 'id',
        isBridgeTable: true, direction: 'mirror',
      }],
      bridgeTables: ['users'],
    };
    const errors = validateMappings(mapping, makeSchema(), makeSpecs());
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('unknown_db_column');
  });

  it('flags an unknown API resource on a known adapter', () => {
    const mapping: SchemaMapping = {
      mappings: [{
        dbTable: 'users', dbColumn: 'email',
        adapterId: 'stripe', apiResource: 'made_up_thing', apiField: 'id',
        isBridgeTable: true, direction: 'mirror',
      }],
      bridgeTables: ['users'],
    };
    const errors = validateMappings(mapping, makeSchema(), makeSpecs());
    expect(errors.find((e) => e.code === 'unknown_api_resource')).toBeTruthy();
  });

  it('flags derive.from whose first segment is not on the api resource', () => {
    const mapping: SchemaMapping = {
      mappings: [{
        dbTable: 'users', dbColumn: 'plan',
        adapterId: 'stripe', apiResource: 'subscription', apiField: 'id',
        isBridgeTable: true, direction: 'drift_capable',
        derivation: {
          kind: 'derive',
          from: 'nope.does.not.exist',
          cases: { 'x': 'starter' },
        },
      }],
      bridgeTables: ['users'],
    };
    const errors = validateMappings(mapping, makeSchema(), makeSpecs());
    expect(errors.find((e) => e.code === 'path_unresolved_in_spec')).toBeTruthy();
  });
});

describe('mapping-derivation — formatValidationErrorsForRetry', () => {
  it('produces a non-empty retry prompt fragment listing each error', () => {
    const mapping: SchemaMapping = {
      mappings: [{
        dbTable: 'users', dbColumn: 'plan',
        adapterId: 'paddle', apiResource: 'subscription', apiField: 'collection_mode',
        isBridgeTable: true, direction: 'drift_capable',
      }],
      bridgeTables: ['users'],
    };
    const errors = validateMappings(mapping, makeSchema(), makeSpecs());
    const fragment = formatValidationErrorsForRetry(errors);
    expect(fragment).toContain('paddle.subscription');
    expect(fragment).toContain('users.plan');
    expect(fragment).toContain('derive');
  });

  it('returns empty string when there are no errors', () => {
    expect(formatValidationErrorsForRetry([])).toBe('');
  });
});
