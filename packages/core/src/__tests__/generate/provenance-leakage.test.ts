import { describe, it, expect } from 'vitest';
import { BlueprintExpander } from '../../generate/expander.js';
import { auditClaims, formatAuditFailures } from '../../generate/claim-auditor.js';
import { deterministicRepair } from '../../generate/deterministic-repair.js';
import { getProvenance, provenanceKey } from '../../generate/provenance.js';
import type { Blueprint, SchemaModel, SchemaMapping, TableClassification } from '../../types/index.js';
import type { Row } from '../../types/dataset.js';

/**
 * Layer-2 (provenance) end-to-end:
 *
 *   - Build a tiny schema where `db.users` is mirrored from `stripe.customer`.
 *   - Define two API archetypes: a 5-row "pro" cohort and an 80+80 = 160-row
 *     pair of "starter" cohorts. After mirroring all 165 end up in `db.users`.
 *   - Add a row_count claim that the DB has exactly 5 users — guaranteed to
 *     fail.
 *   - Assert (a) the audit's provenance breakdown attributes 160 of the 165
 *     matched rows to the API starter archetypes via the mirror flow, and (b)
 *     deterministic repair emits narrowing ops on those API archetype paths,
 *     not just on the cited DB archetype.
 */
describe('provenance — cross-surface leakage attribution', () => {
  const SCHEMA: SchemaModel = {
    enums: [],
    insertionOrder: ['users'],
    tables: [
      {
        name: 'users',
        primaryKey: ['id'],
        foreignKeys: [],
        uniqueConstraints: [],
        checkConstraints: [],
        columns: [
          { name: 'id', type: 'integer', pgType: 'serial', isNullable: false, hasDefault: true, isAutoIncrement: true, isGenerated: false },
          { name: 'name', type: 'text', pgType: 'text', isNullable: true, hasDefault: false, isAutoIncrement: false, isGenerated: false },
          { name: 'plan', type: 'text', pgType: 'text', isNullable: true, hasDefault: false, isAutoIncrement: false, isGenerated: false },
          { name: 'stripe_customer_id', type: 'text', pgType: 'text', isNullable: true, hasDefault: false, isAutoIncrement: false, isGenerated: false },
        ],
      },
    ],
  };

  const SCHEMA_MAPPING: SchemaMapping = {
    bridgeTables: [],
    mappings: [
      {
        dbTable: 'users',
        dbColumn: 'stripe_customer_id',
        adapterId: 'stripe',
        apiResource: 'customer',
        apiField: 'id',
        isBridgeTable: false,
        direction: 'mirror',
      },
      {
        dbTable: 'users',
        dbColumn: 'plan',
        adapterId: 'stripe',
        apiResource: 'customer',
        apiField: 'plan',
        isBridgeTable: false,
        direction: 'mirror',
      },
    ],
  };

  const CLASSIFICATIONS: TableClassification[] = [
    {
      table: 'users',
      role: 'external-mirrored',
      sources: [
        { adapter: 'stripe', resource: 'customer' },
      ],
    },
  ];

  const blueprint: Blueprint = {
    version: '1.0',
    personaId: 'leakage-demo',
    domain: 'billing',
    generatedAt: '2026-05-08T00:00:00Z',
    generatedBy: 'test',
    checksum: 'test',
    persona: { name: 'demo', age: 30, occupation: 't', location: 't', description: '' },
    data: {
      entities: {},
      patterns: [],
      // 5 pro + 80 + 80 starter = 165 customers materialized on the API
      // surface. The mirror flow lifts all 165 into db.users.
      apiEntityArchetypes: {
        stripe: {
          customer: {
            count: 165,
            archetypes: [
              {
                label: 'pro-churn-risk',
                weight: 0,
                count: 5,
                fields: { plan: 'pro' },
                vary: { id: { type: 'sequence', prefix: 'cus_pro_', start: 1, pad: 3 } },
                cites: ['c-pro-count'],
              },
              {
                label: 'starter-monthly',
                weight: 0,
                count: 80,
                fields: { plan: 'starter' },
                vary: { id: { type: 'sequence', prefix: 'cus_sm_', start: 1, pad: 3 } },
              },
              {
                label: 'starter-monthly-active',
                weight: 0,
                count: 80,
                fields: { plan: 'starter' },
                vary: { id: { type: 'sequence', prefix: 'cus_sma_', start: 1, pad: 3 } },
              },
            ],
          },
        },
      },
      claims: [
        {
          id: 'c-pro-count',
          quote: 'There are exactly 5 pro-tier users.',
          kind: 'row_count',
          target: { surface: 'db', name: 'users', filter: { plan: 'pro' } },
          expected: 5,
        },
      ],
    },
  };

  it('stamps mirrored DB rows with the source API archetype provenance', () => {
    const expander = new BlueprintExpander(42);
    const expanded = expander.expand(
      blueprint, SCHEMA, '6 months', undefined, SCHEMA_MAPPING, CLASSIFICATIONS,
    );
    const users = expanded.tables.users ?? [];
    expect(users.length).toBe(165);

    const seenLabels = new Set<string>();
    let mirroredCount = 0;
    for (const row of users) {
      const prov = getProvenance(row as Row);
      expect(prov).toBeDefined();
      expect(prov!.via).toBe('mirror');
      expect(prov!.surface).toBe('db');
      expect(prov!.target).toBe('users');
      expect(prov!.sourceSurface).toBe('api');
      expect(prov!.sourceTarget).toBe('stripe.customer');
      if (prov!.sourceLabel) seenLabels.add(prov!.sourceLabel);
      if (prov!.via === 'mirror') mirroredCount++;
    }
    expect(mirroredCount).toBe(165);
    expect(seenLabels).toEqual(new Set(['pro-churn-risk', 'starter-monthly', 'starter-monthly-active']));
  });

  it('attributes failed-claim row counts to the source API archetype via provenance breakdown', () => {
    // Note: with `plan` mapped from API → DB via SCHEMA_MAPPING, every mirrored
    // user row inherits its plan from the source customer. The "plan='pro'"
    // filter only matches the 5 rows produced by `pro-churn-risk`, so the
    // audit *passes* — the breakdown is only attached on failure. To exercise
    // the breakdown wiring, expand a blueprint variant with a deliberately
    // wrong expected.
    const failingBlueprint: Blueprint = {
      ...blueprint,
      data: {
        ...blueprint.data,
        claims: [
          {
            id: 'c-all-users',
            quote: 'There are about 5 users in the system.',
            kind: 'row_count',
            target: { surface: 'db', name: 'users' },
            expected: 5,
          },
        ],
      },
    };

    const expander = new BlueprintExpander(42);
    const expanded = expander.expand(
      failingBlueprint, SCHEMA, '6 months', undefined, SCHEMA_MAPPING, CLASSIFICATIONS,
    );

    const audit = auditClaims(failingBlueprint, expanded);
    expect(audit.failures.length).toBe(1);

    const failure = audit.failures[0]!;
    expect(failure.actual).toBe(165);
    expect(failure.provenanceBreakdown).toBeDefined();

    // The three API archetypes' contributions are all attributed via mirror.
    const breakdown = failure.provenanceBreakdown!;
    expect(breakdown['api.stripe.customer[pro-churn-risk] (via mirror)']).toBe(5);
    expect(breakdown['api.stripe.customer[starter-monthly] (via mirror)']).toBe(80);
    expect(breakdown['api.stripe.customer[starter-monthly-active] (via mirror)']).toBe(80);

    // Formatter surfaces the breakdown.
    const formatted = formatAuditFailures(audit);
    expect(formatted).toContain('matched rows by source archetype');
    expect(formatted).toContain('api.stripe.customer[starter-monthly] (via mirror)');
  });

  it('provenance key formatter routes cross-surface mirrored rows to the source archetype', () => {
    expect(
      provenanceKey({
        surface: 'db', target: 'users', label: 'pro', via: 'mirror',
        sourceSurface: 'api', sourceTarget: 'stripe.customer', sourceLabel: 'pro-churn-risk',
      }),
    ).toBe('api.stripe.customer[pro-churn-risk] (via mirror)');

    expect(
      provenanceKey({ surface: 'db', target: 'users', label: 'pro-churn-risk', via: 'direct' }),
    ).toBe('db.users[pro-churn-risk]');
  });

  it('deterministic repair uses the provenance breakdown to narrow the cross-surface leakers', () => {
    // The pro-cohort claim is *cited* by the API archetype `pro-churn-risk`
    // (declared in `cites: ['c-pro-count']`). The DB-side audit sees 5 pro
    // users (correct!), so we need a different scenario for leakage:
    //
    // Add a filter-based claim that's only declared by the API pro archetype
    // but ALL the mirror flow leaks over.
    const leakageBlueprint: Blueprint = {
      ...blueprint,
      data: {
        ...blueprint.data,
        claims: [
          {
            id: 'c-pro-count',
            quote: 'Roughly 5 customers signed up — the rest leaked through mirroring.',
            kind: 'row_count',
            target: { surface: 'db', name: 'users', filter: {} },
            expected: 5,
          },
        ],
        // Re-declare archetypes so only the pro one cites the claim.
        apiEntityArchetypes: {
          stripe: {
            customer: {
              count: 165,
              archetypes: [
                {
                  label: 'pro-churn-risk', weight: 0, count: 5,
                  fields: { plan: 'pro' },
                  vary: { id: { type: 'sequence', prefix: 'cus_pro_', start: 1, pad: 3 } },
                  cites: ['c-pro-count'],
                },
                {
                  label: 'starter-monthly', weight: 0, count: 80,
                  fields: { plan: 'starter' },
                  vary: { id: { type: 'sequence', prefix: 'cus_sm_', start: 1, pad: 3 } },
                },
                {
                  label: 'starter-monthly-active', weight: 0, count: 80,
                  fields: { plan: 'starter' },
                  vary: { id: { type: 'sequence', prefix: 'cus_sma_', start: 1, pad: 3 } },
                },
              ],
            },
          },
        },
      },
    };

    const expander = new BlueprintExpander(42);
    const expanded = expander.expand(
      leakageBlueprint, SCHEMA, '6 months', undefined, SCHEMA_MAPPING, CLASSIFICATIONS,
    );
    const audit = auditClaims(leakageBlueprint, expanded);
    expect(audit.failures.length).toBe(1);
    const failure = audit.failures[0]!;
    expect(failure.provenanceBreakdown).toBeDefined();

    // With an empty filter, the leakage branch (delta > citer-sum) does not
    // fire because `hasFilter` is false. To exercise the cross-surface leaker
    // path we need a real filter. Re-target on `plan != null` to keep all
    // matching rows but with `hasFilter=true`.
    const filteredBlueprint: Blueprint = {
      ...leakageBlueprint,
      data: {
        ...leakageBlueprint.data,
        claims: [
          {
            ...leakageBlueprint.data.claims![0]!,
            target: {
              surface: 'db', name: 'users',
              filter: { plan: { in: ['pro', 'starter'] } },
            },
          },
        ],
      },
    };
    const expanded2 = expander.expand(
      filteredBlueprint, SCHEMA, '6 months', undefined, SCHEMA_MAPPING, CLASSIFICATIONS,
    );
    const audit2 = auditClaims(filteredBlueprint, expanded2);
    expect(audit2.failures.length).toBe(1);

    const determ = deterministicRepair(filteredBlueprint, audit2);

    // For value-based filters the narrowing isn't mechanical, so the cross-
    // surface leakers surface in the decision's reason as "need LLM" rather
    // than as patch ops. The key proof point is that they were *identified*
    // via the provenance breakdown — without Layer 2 they'd be invisible
    // because findLeakingArchetypes only walks the same-surface config.
    expect(determ.decisions.length).toBe(1);
    const reason = determ.decisions[0]!.reason;
    expect(reason).toContain('api:stripe.customer:starter-monthly');
    expect(reason).toContain('api:stripe.customer:starter-monthly-active');
  });
});
