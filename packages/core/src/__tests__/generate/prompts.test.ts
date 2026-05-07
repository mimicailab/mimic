import { describe, it, expect } from 'vitest';
import {
  buildPrompt,
  buildAdapterBatchPrompt,
  buildDistributionPrompt,
  buildSchemaMappingPrompt,
} from '../../generate/prompts.js';
import type { SchemaModel } from '../../types/schema.js';

const EMPTY_SCHEMA: SchemaModel = { tables: [], enums: [], insertionOrder: [] };

const PERSONA = {
  name: 'Sarah Lee',
  description:
    'AE at Cumulus, working a £220k Northwind deal. On Apr 22 the SOC 2 ' +
    'package arrived from procurement. The 47-message Gmail thread closed last week.',
};

describe('prompts: date-driven archetype rules', () => {
  // ── SYSTEM_PROMPT (full blueprint generation) ──────────────────────────────

  it('buildPrompt system prompt includes RULE I (date-driven archetypes)', () => {
    const { system } = buildPrompt({
      schema: EMPTY_SCHEMA,
      persona: PERSONA,
      domain: 'sales-operations',
      currentDate: '2026-05-02',
      volume: '6 months',
    });
    expect(system).toContain('RULE I — DATE-DRIVEN ARCHETYPES');
    // Surfaces the actual failure mode the rule is fixing
    expect(system).toMatch(/mid-range/i);
    // Shows how to encode a date-anchored cluster
    expect(system).toContain("type: 'range'");
    // Names timestamp-bearing fields the LLM must anchor
    expect(system).toMatch(/sent_at|created_at|closed_at/);
  });

  it('buildPrompt system prompt still has RULE H (numbers) — date rule is additive', () => {
    const { system } = buildPrompt({
      schema: EMPTY_SCHEMA,
      persona: PERSONA,
      domain: 'sales-operations',
      currentDate: '2026-05-02',
    });
    expect(system).toContain('RULE H — FACT-DRIVEN ARCHETYPES');
  });

  // ── BATCH_SYSTEM_PROMPT (batched API-only generation) ──────────────────────

  it('buildAdapterBatchPrompt system prompt includes RULE G (date-driven archetypes)', () => {
    const { system } = buildAdapterBatchPrompt({
      persona: PERSONA,
      domain: 'sales-operations',
      apis: { gmail: { adapter: 'gmail' } },
      currentDate: '2026-05-02',
    });
    expect(system).toContain('RULE G — DATE-DRIVEN ARCHETYPES');
    expect(system).toContain('relative date');
    expect(system).toContain("type: 'range'");
  });

  it('buildAdapterBatchPrompt system prompt still has RULE F (numbers)', () => {
    const { system } = buildAdapterBatchPrompt({
      persona: PERSONA,
      domain: 'sales-operations',
      apis: { gmail: { adapter: 'gmail' } },
    });
    expect(system).toContain('RULE F — FACT-DRIVEN ARCHETYPES');
  });

  // ── DISTRIBUTION_SYSTEM_PROMPT (distribution-only) ─────────────────────────

  it('buildDistributionPrompt system prompt includes the DATE-DRIVEN DISTRIBUTIONS section', () => {
    const { system } = buildDistributionPrompt({
      persona: PERSONA,
      domain: 'sales-operations',
      resourceSpecs: {},
      currentDate: '2026-05-02',
      volume: '6 months',
    });
    expect(system).toContain('CRITICAL — DATE-DRIVEN DISTRIBUTIONS');
    expect(system).toContain('event anchor');
    expect(system).toContain("type: 'range'");
  });

  it('buildDistributionPrompt system prompt still has the FACT-DRIVEN section', () => {
    const { system } = buildDistributionPrompt({
      persona: PERSONA,
      domain: 'sales-operations',
      resourceSpecs: {},
      currentDate: '2026-05-02',
    });
    expect(system).toContain('CRITICAL — FACT-DRIVEN DISTRIBUTIONS');
  });

  // ── Sanity: persona description still reaches the user prompt ──────────────

  it('user prompts surface the persona narrative with explicit dates intact', () => {
    const { user } = buildPrompt({
      schema: EMPTY_SCHEMA,
      persona: PERSONA,
      domain: 'sales-operations',
      currentDate: '2026-05-02',
    });
    expect(user).toContain('On Apr 22');
    expect(user).toContain('Current date: 2026-05-02');
  });
});

describe('prompts: narrative-named-entity rules', () => {
  // ── SYSTEM_PROMPT (full blueprint generation) ──────────────────────────────

  it('buildPrompt system prompt includes RULE J (narrative-named-entity archetypes)', () => {
    const { system } = buildPrompt({
      schema: EMPTY_SCHEMA,
      persona: PERSONA,
      domain: 'sales-operations',
      currentDate: '2026-05-02',
      volume: '6 months',
    });
    expect(system).toContain('RULE J — NARRATIVE-NAMED-ENTITY ARCHETYPES');
    // Names the failure modes the rule fixes
    expect(system).toMatch(/generic placeholder/i);
    expect(system).toMatch(/collapsing|collapse|merges/i);
    // Names the cross-resource-label requirement
    expect(system).toContain('channel_name');
    // Calls out the marshaller-group-by-string mechanism
    expect(system).toMatch(/marshaller/i);
  });

  it('buildPrompt example shows multi-archetype name-pinned encoding', () => {
    const { system } = buildPrompt({
      schema: EMPTY_SCHEMA,
      persona: PERSONA,
      domain: 'sales-operations',
      currentDate: '2026-05-02',
    });
    // The two worked examples (Slack channels + Gmail threads)
    expect(system).toContain('"name": "deals"');
    expect(system).toContain('"name": "engineering"');
    expect(system).toContain('thread_subject');
  });

  // ── BATCH_SYSTEM_PROMPT (batched API-only generation) ──────────────────────

  it('buildAdapterBatchPrompt system prompt includes RULE H (named-entity archetypes)', () => {
    const { system } = buildAdapterBatchPrompt({
      persona: PERSONA,
      domain: 'sales-operations',
      apis: { gmail: { adapter: 'gmail' } },
      currentDate: '2026-05-02',
    });
    expect(system).toContain('RULE H — NARRATIVE-NAMED-ENTITY ARCHETYPES');
    expect(system).toMatch(/generic placeholder/i);
    expect(system).toContain('channel_name');
  });

  // ── DISTRIBUTION_SYSTEM_PROMPT (distribution-only) ─────────────────────────

  it('buildDistributionPrompt system prompt includes the NAMED-ENTITY DISTRIBUTIONS section', () => {
    const { system } = buildDistributionPrompt({
      persona: PERSONA,
      domain: 'sales-operations',
      resourceSpecs: {},
      currentDate: '2026-05-02',
      volume: '6 months',
    });
    expect(system).toContain('CRITICAL — NARRATIVE-NAMED-ENTITY DISTRIBUTIONS');
    expect(system).toMatch(/generic placeholder/i);
    expect(system).toContain('channel_name');
    expect(system).toContain('thread_subject');
  });

  // ── Date rule survives the addition (regression guard) ────────────────────

  it('all three prompts still carry the date-driven rules after the named-entity addition', () => {
    const { system: blueprintSys } = buildPrompt({
      schema: EMPTY_SCHEMA,
      persona: PERSONA,
      domain: 'sales-operations',
      currentDate: '2026-05-02',
    });
    const { system: batchSys } = buildAdapterBatchPrompt({
      persona: PERSONA,
      domain: 'sales-operations',
      apis: { gmail: { adapter: 'gmail' } },
      currentDate: '2026-05-02',
    });
    const { system: distSys } = buildDistributionPrompt({
      persona: PERSONA,
      domain: 'sales-operations',
      resourceSpecs: {},
      currentDate: '2026-05-02',
    });
    expect(blueprintSys).toContain('RULE I — DATE-DRIVEN ARCHETYPES');
    expect(batchSys).toContain('RULE G — DATE-DRIVEN ARCHETYPES');
    expect(distSys).toContain('CRITICAL — DATE-DRIVEN DISTRIBUTIONS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IDENTITY CONTRACT (cross-surface ID prefix pinning, derived from schema map)
// ─────────────────────────────────────────────────────────────────────────────

import type { SchemaMapping } from '../../types/blueprint.js';
import type { PromptContext } from '../../types/index.js';

const STRIPE_PROMPT_CTX: Record<string, PromptContext> = {
  stripe: {
    resources: ['customer'],
    amountFormat: 'integer cents',
    relationships: [],
    requiredFields: { customer: ['id', 'email'] },
    idPrefix: 'cus_',
  },
};

const STRIPE_FK_MAPPING: SchemaMapping = {
  bridgeTables: [],
  mappings: [
    {
      dbTable: 'customers',
      dbColumn: 'stripe_customer_id',
      adapterId: 'stripe',
      apiResource: 'customer',
      apiField: 'id',
      isBridgeTable: false,
    },
  ],
};

describe('IDENTITY CONTRACT — Phase 1 (DB) prompt', () => {
  it('renders a DB-side contract block when schemaMapping has cross-surface FKs', () => {
    const { user } = buildPrompt({
      schema: EMPTY_SCHEMA,
      persona: PERSONA,
      domain: 'sales-operations',
      personaIndex: 1,
      promptContexts: STRIPE_PROMPT_CTX,
      schemaMapping: STRIPE_FK_MAPPING,
    });
    expect(user).toContain('IDENTITY CONTRACT (DB side');
    expect(user).toContain('informational');
    expect(user).toContain('customers.stripe_customer_id');
    expect(user).toContain('"cus_p1_"');
    expect(user).toContain('joins stripe.customer.id');
  });

  it('does NOT render when no schemaMapping is provided (briefing-agent case)', () => {
    const { user } = buildPrompt({
      schema: EMPTY_SCHEMA,
      persona: PERSONA,
      domain: 'sales-operations',
      personaIndex: 1,
    });
    expect(user).not.toContain('IDENTITY CONTRACT');
  });

  it('does NOT render when mapping has only bridge-table entries (existing path)', () => {
    const bridgeOnly: SchemaMapping = {
      bridgeTables: ['customers'],
      mappings: [
        {
          dbTable: 'customers', dbColumn: 'external_id', adapterId: 'stripe',
          apiResource: 'customer', apiField: 'id', isBridgeTable: true,
        },
      ],
    };
    const { user } = buildPrompt({
      schema: EMPTY_SCHEMA,
      persona: PERSONA,
      domain: 'sales-operations',
      personaIndex: 1,
      promptContexts: STRIPE_PROMPT_CTX,
      schemaMapping: bridgeOnly,
    });
    expect(user).not.toContain('IDENTITY CONTRACT');
  });
});

describe('IDENTITY CONTRACT — Phase 2 (API) prompt', () => {
  it('renders an informational API-side contract block', () => {
    const { user } = buildAdapterBatchPrompt({
      persona: PERSONA,
      domain: 'sales-operations',
      apis: { stripe: { adapter: 'stripe' } },
      promptContexts: STRIPE_PROMPT_CTX,
      personaIndex: 1,
      schemaMapping: STRIPE_FK_MAPPING,
    });
    expect(user).toContain('IDENTITY CONTRACT (API side');
    expect(user).toContain('informational');
    expect(user).toContain('stripe.customer.id');
    expect(user).toContain('"cus_p1_"');
    expect(user).toContain('matches customers.stripe_customer_id');
  });

  it('filters entries to the current batch — does not leak other adapters in', () => {
    const multi: SchemaMapping = {
      bridgeTables: [],
      mappings: [
        { dbTable: 'customers', dbColumn: 'stripe_customer_id', adapterId: 'stripe', apiResource: 'customer', apiField: 'id', isBridgeTable: false },
        { dbTable: 'orders', dbColumn: 'paddle_subscription_id', adapterId: 'paddle', apiResource: 'subscription', apiField: 'id', isBridgeTable: false },
      ],
    };
    const { user } = buildAdapterBatchPrompt({
      persona: PERSONA,
      domain: 'sales-operations',
      apis: { stripe: { adapter: 'stripe' } },
      promptContexts: STRIPE_PROMPT_CTX,
      personaIndex: 1,
      schemaMapping: multi,
    });
    expect(user).toContain('stripe.customer.id');
    expect(user).not.toContain('paddle.subscription.id');
  });

  it('is a no-op when schemaMapping is undefined', () => {
    const { user } = buildAdapterBatchPrompt({
      persona: PERSONA,
      domain: 'sales-operations',
      apis: { stripe: { adapter: 'stripe' } },
      promptContexts: STRIPE_PROMPT_CTX,
      personaIndex: 1,
    });
    expect(user).not.toContain('IDENTITY CONTRACT');
  });
});

describe('SCHEMA_MAPPING_SYSTEM_PROMPT — cross-surface identity rule', () => {
  it('includes the cross-surface identity columns rule with worked examples', () => {
    const { system } = buildSchemaMappingPrompt({
      schema: { tables: [], enums: [], insertionOrder: [] },
      adapterResources: { stripe: ['customer'] },
    });
    expect(system).toContain('Cross-Surface Identity Columns');
    expect(system).toContain('stripe_customer_id');
    expect(system).toContain('isBridgeTable: false');
  });
});
