import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createWebhookEmitSink, webhookSinkFromConfig } from '../behavior/webhook.js';

/** Spin an ephemeral HTTP server that captures the first request. */
function captureServer(): Promise<{ url: string; received: Promise<{ headers: Record<string, string | string[] | undefined>; body: string }>; close: () => void }> {
  return new Promise((resolve) => {
    let resolveReceived: (v: { headers: Record<string, string | string[] | undefined>; body: string }) => void;
    const received = new Promise<{ headers: Record<string, string | string[] | undefined>; body: string }>((r) => { resolveReceived = r; });
    const server: Server = createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        res.writeHead(200); res.end('{}');
        resolveReceived({ headers: req.headers, body });
      });
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}/hook`, received, close: () => server.close() });
    });
  });
}

describe('webhook delivery', () => {
  it('delivers a Stripe-style signed event envelope', async () => {
    const srv = await captureServer();
    const sink = createWebhookEmitSink({ endpoint: srv.url, secret: 'whsec_test', source: 'stripe', log: () => {} });

    sink({ type: 'payment_intent.succeeded', data: { id: 'pi_123', status: 'succeeded' } });

    const { headers, body } = await srv.received;
    srv.close();

    const evt = JSON.parse(body);
    expect(evt.object).toBe('event');
    expect(evt.type).toBe('payment_intent.succeeded');
    expect(evt.id).toMatch(/^evt_/);
    expect(evt.data.object).toEqual({ id: 'pi_123', status: 'succeeded' });
    // signed
    expect(String(headers['stripe-signature'])).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
  });

  it('returns undefined when no webhook is configured for the adapter', () => {
    expect(webhookSinkFromConfig({ events: {} }, 'stripe')).toBeUndefined();
    expect(webhookSinkFromConfig({}, 'stripe')).toBeUndefined();
    expect(webhookSinkFromConfig({ events: { stripe: { type: 'kafka', config: {} } } }, 'stripe')).toBeUndefined();
  });

  it('builds a sink from an events config block', async () => {
    const srv = await captureServer();
    const sink = webhookSinkFromConfig(
      { events: { stripe: { type: 'webhook', config: { endpoint: srv.url } } } },
      'stripe',
      () => {},
    );
    expect(sink).toBeDefined();
    sink!({ type: 'invoice.paid', data: { id: 'in_1' } });
    const { body } = await srv.received;
    srv.close();
    expect(JSON.parse(body).type).toBe('invoice.paid');
  });
});
