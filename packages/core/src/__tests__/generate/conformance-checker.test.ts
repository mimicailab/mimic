import { describe, it, expect } from 'vitest';
import { checkConformance, summarizeReport } from '../../generate/conformance-checker.js';
import type { ExpandedData, ApiResponse } from '../../types/dataset.js';
import type { ILLMClient, GenerateObjectOptions, GenerateObjectResult } from '../../llm/client.js';
import type { z } from 'zod';

// A scriptable fake LLM that returns a canned assertions list, so the
// conformance evaluator can be tested without network calls.
function fakeLLM(assertions: unknown[]): ILLMClient {
  return {
    async generateObject<T extends z.ZodTypeAny>(
      _opts: GenerateObjectOptions<T>,
    ): Promise<GenerateObjectResult<z.infer<T>>> {
      return {
        object: { assertions } as z.infer<T>,
        promptTokens: 0,
        completionTokens: 0,
      };
    },
    async generateText() {
      throw new Error('not used');
    },
  } as unknown as ILLMClient;
}

function makeApi(
  platform: string,
  resource: string,
  bodies: Array<Record<string, unknown>>,
): ExpandedData {
  const responses: Record<string, ApiResponse[]> = {
    [resource]: bodies.map((body) => ({
      statusCode: 200,
      headers: {},
      body,
      personaId: 'p',
    })),
  };
  return {
    personaId: 'p',
    blueprint: {} as never,
    tables: {},
    documents: {},
    apiResponses: { [platform]: { adapterId: platform, responses } },
    files: [],
    events: [],
    facts: [],
  };
}

function makeTable(name: string, rows: Array<Record<string, unknown>>): ExpandedData {
  return {
    personaId: 'p',
    blueprint: {} as never,
    tables: { [name]: rows },
    documents: {},
    apiResponses: {},
    files: [],
    events: [],
    facts: [],
  };
}

describe('conformance checker', () => {
  it('count predicate passes when filter matches expected count', async () => {
    const llm = fakeLLM([
      {
        id: 'overdue-count',
        description: 'three invoices payment_due',
        source: { kind: 'api', platform: 'chargebee', resource: 'invoice' },
        predicate: { kind: 'count', equals: 3, where: [{ field: 'status', op: 'eq', value: 'payment_due' }] },
      },
    ]);
    const data = makeApi('chargebee', 'invoice', [
      { status: 'paid' },
      { status: 'payment_due' },
      { status: 'payment_due' },
      { status: 'payment_due' },
      { status: 'voided' },
    ]);
    const report = await checkConformance(llm, data, { name: 'p', description: '' }, 'd');
    expect(report.total).toBe(1);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(0);
  });

  it('count predicate fails and surfaces actual vs expected', async () => {
    const llm = fakeLLM([
      {
        id: 'three-overdue',
        description: 'three invoices payment_due',
        source: { kind: 'api', platform: 'chargebee', resource: 'invoice' },
        predicate: { kind: 'count', equals: 3, where: [{ field: 'status', op: 'eq', value: 'payment_due' }] },
      },
    ]);
    const data = makeApi('chargebee', 'invoice', [{ status: 'paid' }, { status: 'payment_due' }]);
    const report = await checkConformance(llm, data, { name: 'p', description: '' }, 'd');
    expect(report.failed).toBe(1);
    expect(report.results[0]!.expected).toBe(3);
    expect(report.results[0]!.actual).toBe(1);
  });

  it('sum predicate sums a numeric field across filtered rows', async () => {
    const llm = fakeLLM([
      {
        id: 'overdue-total',
        description: 'overdue invoices sum to 1240000 pence',
        source: { kind: 'api', platform: 'chargebee', resource: 'invoice' },
        predicate: {
          kind: 'sum', field: 'total', equals: 1240000,
          where: [{ field: 'status', op: 'eq', value: 'payment_due' }],
        },
      },
    ]);
    const data = makeApi('chargebee', 'invoice', [
      { status: 'payment_due', total: 480000 },
      { status: 'payment_due', total: 420000 },
      { status: 'payment_due', total: 340000 },
      { status: 'paid', total: 999 },
    ]);
    const report = await checkConformance(llm, data, { name: 'p', description: '' }, 'd');
    expect(report.passed).toBe(1);
    expect(report.results[0]!.actual).toBe(1240000);
  });

  it('every_field_equals detects offenders in a table source', async () => {
    const llm = fakeLLM([
      {
        id: 'all-active',
        description: 'every user status=active',
        source: { kind: 'table', table: 'users' },
        predicate: { kind: 'every_field_equals', field: 'status', value: 'active' },
      },
    ]);
    const data = makeTable('users', [
      { status: 'active' },
      { status: 'active' },
      { status: 'archived' },
    ]);
    const report = await checkConformance(llm, data, { name: 'p', description: '' }, 'd');
    expect(report.failed).toBe(1);
    expect((report.results[0]!.actual as { offenderCount: number }).offenderCount).toBe(1);
  });

  it('every_field_in catches out-of-enum plan values', async () => {
    const llm = fakeLLM([
      {
        id: 'plan-enum',
        description: 'plan in allowed set',
        source: { kind: 'table', table: 'users' },
        predicate: {
          kind: 'every_field_in', field: 'plan',
          allowed: ['free', 'starter', 'pro', 'enterprise'],
        },
      },
    ]);
    const data = makeTable('users', [
      { plan: 'free' },
      { plan: 'plan_p1_001' },
      { plan: 'automatic' },
    ]);
    const report = await checkConformance(llm, data, { name: 'p', description: '' }, 'd');
    expect(report.failed).toBe(1);
    expect((report.results[0]!.actual as { offenderCount: number }).offenderCount).toBe(2);
  });

  it('field_invariant catches amount_refunded > amount', async () => {
    const llm = fakeLLM([
      {
        id: 'refund-le-amount',
        description: 'refund cannot exceed amount',
        source: { kind: 'api', platform: 'gocardless', resource: 'payment' },
        predicate: { kind: 'field_invariant', left: 'amount_refunded', op: 'le', right: 'amount' },
      },
    ]);
    const data = makeApi('gocardless', 'payment', [
      { amount: 1000, amount_refunded: 500 },
      { amount: 47682, amount_refunded: 82551 },
    ]);
    const report = await checkConformance(llm, data, { name: 'p', description: '' }, 'd');
    expect(report.failed).toBe(1);
  });

  it('dot-path resolves nested fields like unit_price.amount', async () => {
    const llm = fakeLLM([
      {
        id: 'paddle-prices',
        description: 'paddle prices are GBP only',
        source: { kind: 'api', platform: 'paddle', resource: 'price' },
        predicate: { kind: 'every_field_equals', field: 'unit_price.currency_code', value: 'GBP' },
      },
    ]);
    const data = makeApi('paddle', 'price', [
      { unit_price: { amount: '49900', currency_code: 'GBP' } },
      { unit_price: { amount: '7900', currency_code: 'GBP' } },
    ]);
    const report = await checkConformance(llm, data, { name: 'p', description: '' }, 'd');
    expect(report.passed).toBe(1);
  });

  it('skips assertions when the source does not exist', async () => {
    const llm = fakeLLM([
      {
        id: 'missing',
        description: 'nonexistent',
        source: { kind: 'api', platform: 'nope', resource: 'thing' },
        predicate: { kind: 'count', equals: 0 },
      },
    ]);
    const data = makeApi('chargebee', 'invoice', [{ status: 'paid' }]);
    const report = await checkConformance(llm, data, { name: 'p', description: '' }, 'd');
    expect(report.skipped).toBe(1);
    expect(report.failed).toBe(0);
  });

  it('summarizeReport prints failures with expected/actual', async () => {
    const llm = fakeLLM([
      {
        id: 'three-overdue',
        description: 'three payment_due',
        source: { kind: 'api', platform: 'chargebee', resource: 'invoice' },
        predicate: { kind: 'count', equals: 3, where: [{ field: 'status', op: 'eq', value: 'payment_due' }] },
      },
    ]);
    const data = makeApi('chargebee', 'invoice', [{ status: 'paid' }]);
    const report = await checkConformance(llm, data, { name: 'p', description: '' }, 'd');
    const text = summarizeReport(report);
    expect(text).toContain('1 failed');
    expect(text).toContain('three payment_due');
    expect(text).toContain('expected=3');
  });
});
