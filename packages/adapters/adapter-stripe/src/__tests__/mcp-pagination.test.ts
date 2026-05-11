import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import { StripeAdapter } from '../stripe-adapter.js';
import { registerStripeTools } from '../mcp.js';

// Minimal McpServer stub — captures handlers so we can invoke them directly
// without spinning up a stdio MCP transport.
class HandlerCollector {
  handlers: Record<string, (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>> = {};
  tool(
    name: string,
    _desc: string,
    _schema: unknown,
    handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>,
  ): void {
    this.handlers[name] = handler;
  }
}

describe('Stripe MCP — auto-pagination', () => {
  let ts: TestServer;
  let baseUrl: string;
  let collector: HandlerCollector;

  beforeAll(async () => {
    ts = await buildTestServer(new StripeAdapter());
    baseUrl = await ts.server.listen({ port: 0, host: '127.0.0.1' });

    // Seed 250 customers — well above the mock's 100/page cap so we can verify
    // the MCP tool walks pages and aggregates.
    for (let i = 0; i < 250; i++) {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/v1/customers',
        payload: { name: `Customer ${i}`, email: `cust${i}@example.com` },
      });
      expect(res.statusCode).toBe(200);
    }

    collector = new HandlerCollector();
    registerStripeTools(collector as unknown as Parameters<typeof registerStripeTools>[0], baseUrl);
  });

  afterAll(async () => {
    await ts.close();
  });

  it('list_customers without args auto-paginates and reports the full count (>100)', async () => {
    const res = await collector.handlers.list_customers!({});
    const text = res.content[0]!.text;
    expect(text).toMatch(/Customers \(250\)/);
  });

  it('list_customers with explicit limit returns only one page and flags has_more', async () => {
    const res = await collector.handlers.list_customers!({ limit: 25 });
    const text = res.content[0]!.text;
    // Single-page mode with more records remaining: 25+ (has_more true).
    expect(text).toMatch(/Customers \(25\+\)/);
  });

  it('list_customers with starting_after returns the next page after that cursor', async () => {
    const firstPage = await collector.handlers.list_customers!({ limit: 100 });
    const firstText = firstPage.content[0]!.text;
    const cursorIds = firstText.match(/cus_[A-Za-z0-9_-]+/g)!;
    const lastIdOnFirstPage = cursorIds[cursorIds.length - 1]!;

    const nextPage = await collector.handlers.list_customers!({
      limit: 100,
      starting_after: lastIdOnFirstPage,
    });
    const nextText = nextPage.content[0]!.text;
    expect(nextText).not.toContain(lastIdOnFirstPage);
    // 100 records remain after the cursor; total is 250 so still has_more.
    expect(nextText).toMatch(/Customers \(100\+\)/);
  });
});
