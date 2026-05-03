import { describe, it, expect } from 'vitest';
import {
  buildPrompt,
  buildAdapterBatchPrompt,
  buildDistributionPrompt,
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
