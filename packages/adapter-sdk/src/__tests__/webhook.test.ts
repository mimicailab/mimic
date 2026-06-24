import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebhookHub } from '@mimicai/core';
import { createWebhookEmitSink, webhookSinkFromConfig, WebhookDelivery } from '../behavior/webhook.js';

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
      { log: () => {} },
    );
    expect(sink).toBeDefined();
    sink!({ type: 'invoice.paid', data: { id: 'in_1' } });
    const { body } = await srv.received;
    srv.close();
    expect(JSON.parse(body).type).toBe('invoice.paid');
  });

  it('delivers a generic envelope when configured', async () => {
    const srv = await captureServer();
    const sink = webhookSinkFromConfig(
      { events: { recurly: { type: 'webhook', config: { endpoint: srv.url } } } },
      'recurly',
      { log: () => {}, defaultEnvelope: 'generic' },
    );
    sink!({ type: 'subscription.canceled', data: { id: 'sub_1', state: 'canceled' } });
    const { body } = await srv.received;
    srv.close();
    const evt = JSON.parse(body);
    expect(evt.type).toBe('subscription.canceled');
    expect(evt.id).toMatch(/^evt_/);
    expect(evt.data).toEqual({ id: 'sub_1', state: 'canceled' });   // generic: data is the resource directly
    expect(evt.object).toBeUndefined();                              // not stripe-style
  });
});

describe('sync (flush) delivery + determinism', () => {
  it('buffers in sync mode and delivers only on flush, deterministically', async () => {
    const srv = await captureServer();
    const hub = new WebhookHub();
    const delivery = new WebhookDelivery({
      endpoint: srv.url, mode: 'sync', deterministic: true, seed: 1000,
      source: 'stripe', envelope: 'stripe', log: () => {}, hub,
    });

    delivery.sink({ type: 'payment_intent.succeeded', data: { id: 'pi_1' } });
    delivery.sink({ type: 'invoice.paid', data: { id: 'in_1' } });

    // Nothing delivered yet; buffered + recorded deterministically.
    expect(delivery.pending).toBe(2);
    expect(hub.pending).toBe(2);
    expect(hub.inbox.map((e) => e.id)).toEqual(['evt_1', 'evt_2']);
    expect(hub.inbox.map((e) => e.created)).toEqual([1001, 1002]);
    expect(hub.inbox.every((e) => !e.delivered)).toBe(true);

    const first = srv.received;
    await delivery.flush();
    const { body } = await first;
    expect(JSON.parse(body).id).toBe('evt_1');
    expect(JSON.parse(body).created).toBe(1001);

    srv.close();
    expect(delivery.pending).toBe(0);
    expect(hub.pending).toBe(0);
    expect(hub.inbox.every((e) => e.delivered)).toBe(true);
  });

  it('hub.flush() drives buffered deliveries (control-plane path)', async () => {
    const hub = new WebhookHub();
    const delivery = new WebhookDelivery({ mode: 'sync', deterministic: true, source: 'recurly', hub, log: () => {} });
    delivery.sink({ type: 'subscription.canceled', data: { id: 'sub_1' } });
    expect(hub.pending).toBe(1);
    const flushed = await hub.flush();
    expect(flushed).toBe(1);
    expect(hub.pending).toBe(0);
    expect(hub.inbox[0]).toMatchObject({ id: 'evt_1', type: 'subscription.canceled', delivered: true });
  });
});
