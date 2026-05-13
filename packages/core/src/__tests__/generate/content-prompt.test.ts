import { describe, it, expect } from 'vitest';
import { buildContentPrompt } from '../../generate/prompts.js';
import type { TableInfo, ResourceSpec, AdapterResourceSpecs } from '../../types/index.js';
import type { Claim } from '../../types/claim.js';

const USERS_TABLE: TableInfo = {
  name: 'users',
  columns: [
    { name: 'id', type: 'integer', pgType: 'integer', isNullable: false, hasDefault: false, isAutoIncrement: true, isGenerated: false },
    { name: 'email', type: 'text', pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
    { name: 'plan', type: 'text', pgType: 'text', isNullable: false, hasDefault: false, isAutoIncrement: false, isGenerated: false },
    { name: 'last_login_at', type: 'timestamp', pgType: 'timestamp', isNullable: true, hasDefault: false, isAutoIncrement: false, isGenerated: false },
  ],
  primaryKey: ['id'],
  foreignKeys: [],
  uniqueConstraints: [],
  checkConstraints: [],
};

const STRIPE_PLATFORM: AdapterResourceSpecs['platform'] = {
  timestampFormat: 'unix_seconds',
  amountFormat: 'integer_cents',
  idPrefix: 'cus_',
};

const STRIPE_CUSTOMER: ResourceSpec = {
  objectType: 'customer',
  volumeHint: 'entity',
  fields: {
    id: { type: 'string', required: true, idPrefix: 'cus_' },
    email: { type: 'string', required: true, semanticType: 'email' },
    created: { type: 'integer', required: true, timestamp: 'unix_seconds', auto: true },
    name: { type: 'string', required: false },
    currency: { type: 'string', required: false, semanticType: 'currency_code' },
  },
};

const ROW_COUNT_CLAIM: Claim = {
  id: 'pro_inactive_14',
  quote: '14 Pro customers haven\'t logged in for 30+ days',
  kind: 'row_count',
  target: { surface: 'db', name: 'users', filter: { plan: 'pro', last_login_at: { age_days_gte: 30 } } },
  expected: 14,
};

describe('content prompt', () => {
  it('renders persona, slot, schema, and claims for a DB slot', () => {
    const { system, user } = buildContentPrompt({
      persona: { name: 'Sarah', description: 'Northwind CFO' },
      domain: 'billing-ops',
      surface: 'db',
      name: 'users',
      dbTable: USERS_TABLE,
      claims: [ROW_COUNT_CLAIM as unknown as Parameters<typeof buildContentPrompt>[0]['claims'][number]],
      anchors: [],
      identityContractEntries: [],
      currentDate: '2026-05-12',
      volume: '6 months',
      personaIndex: 1,
      defaultCountHint: 200,
    });

    expect(system).toContain('ARCHETYPES for ONE resource slot');
    expect(user).toContain('Sarah');
    expect(user).toContain('Slot: db.users');
    expect(user).toContain('Default total row count hint: ~200');
    expect(user).toContain('--- CLAIMS FOR THIS SLOT');
    expect(user).toContain('pro_inactive_14');
    expect(user).toContain('14 Pro customers');
    // Schema appears
    expect(user).toContain('Table: users');
    expect(user).toMatch(/last_login_at/);
  });

  it('renders API resource field list for an API slot', () => {
    const { user } = buildContentPrompt({
      persona: { name: 'p', description: 'd' },
      domain: 'd',
      surface: 'api',
      name: 'stripe.customer',
      apiPlatform: STRIPE_PLATFORM,
      apiResource: STRIPE_CUSTOMER,
      claims: [],
      anchors: [],
      identityContractEntries: [],
      defaultCountHint: 100,
    });
    expect(user).toContain('Slot: api.stripe.customer');
    expect(user).toContain('Resource: stripe.customer (entity)');
    expect(user).toContain('Timestamps: unix_seconds');
    expect(user).toContain('Amounts: integer_cents');
    expect(user).toMatch(/Required fields:.*id/);
  });

  it('renders anchors block when anchors are supplied', () => {
    const { user } = buildContentPrompt({
      persona: { name: 'p', description: 'd' },
      domain: 'd',
      surface: 'api',
      name: 'stripe.customer',
      apiPlatform: STRIPE_PLATFORM,
      apiResource: STRIPE_CUSTOMER,
      claims: [],
      anchors: [
        { id: 'klein_double_charge', customer: { match: 'Klein Records' }, dates: { event: '2026-04-29T00:00:00Z' } },
      ],
      identityContractEntries: [],
    });
    expect(user).toContain('--- ANCHORS');
    expect(user).toContain('klein_double_charge');
    expect(user).toContain('Klein Records');
  });

  it('renders identity contract block for matching slot', () => {
    const { user } = buildContentPrompt({
      persona: { name: 'p', description: 'd' },
      domain: 'd',
      surface: 'db',
      name: 'users',
      dbTable: USERS_TABLE,
      claims: [],
      anchors: [],
      identityContractEntries: [
        { dbTable: 'users', dbColumn: 'external_id', adapterId: 'stripe', apiResource: 'customer', apiField: 'id', prefix: 'cus_p1_' },
      ],
    });
    expect(user).toContain('--- IDENTITY CONTRACT');
    expect(user).toContain('cus_p1_');
  });

  it('explicitly tells the LLM how to handle empty claim lists', () => {
    const { user } = buildContentPrompt({
      persona: { name: 'p', description: 'd' },
      domain: 'd',
      surface: 'db',
      name: 'users',
      dbTable: USERS_TABLE,
      claims: [],
      anchors: [],
      identityContractEntries: [],
    });
    expect(user).toMatch(/none.*no persona-narrated/i);
  });
});
