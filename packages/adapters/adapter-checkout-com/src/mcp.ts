import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCall(baseUrl: string) {
  return async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && res.status !== 201 && res.status !== 202 && res.status !== 204) {
      const text = await res.text();
      throw new Error(`Checkout.com mock error ${res.status}: ${text}`);
    }
    if (res.status === 204) return {};
    return res.json();
  };
}

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function registerCheckoutComTools(
  server: McpServer,
  baseUrl: string = 'http://localhost:4104',
): void {
  const call = makeCall(baseUrl);

  // ── 1. request_payment
  server.tool('request_payment', 'Request a Checkout.com payment', {
    amount: z.number().describe('Amount in minor units (e.g. 1000 = 10.00)'),
    currency: z.string().length(3).optional().describe('Currency code (e.g. USD)'),
    reference: z.string().optional().describe('Payment reference'),
    capture: z.boolean().optional().describe('Auto-capture (default true)'),
    source_type: z.string().optional().describe('Payment source type (default card)'),
  }, async ({ amount, currency, reference, capture, source_type }) => {
    const data = await call('POST', '/checkout/payments', {
      amount,
      currency: currency || 'USD',
      reference,
      capture: capture ?? true,
      source: { type: source_type || 'card' },
    }) as any;
    return text(`Payment ${data.id} [${data.status}] — ${data.amount} ${data.currency}\nApproved: ${data.approved}\nResponse: ${data.response_code} ${data.response_summary}`);
  });

  // ── 2. get_payment
  server.tool('get_payment', 'Get payment details by ID', {
    payment_id: z.string().describe('Payment ID (pay_xxx)'),
  }, async ({ payment_id }) => {
    const data = await call('GET', `/checkout/payments/${payment_id}`) as any;
    return text(`Payment ${data.id} [${data.status}] — ${data.amount} ${data.currency}\nApproved: ${data.approved}`);
  });

  // ── 3. capture_payment
  server.tool('capture_payment', 'Capture an authorized payment', {
    payment_id: z.string().describe('Payment ID to capture'),
    reference: z.string().optional().describe('Capture reference'),
  }, async ({ payment_id, reference }) => {
    const data = await call('POST', `/checkout/payments/${payment_id}/captures`, { reference }) as any;
    return text(`Capture accepted — action ${data.action_id}`);
  });

  // ── 4. refund_payment
  server.tool('refund_payment', 'Refund a captured payment', {
    payment_id: z.string().describe('Payment ID to refund'),
    reference: z.string().optional().describe('Refund reference'),
  }, async ({ payment_id, reference }) => {
    const data = await call('POST', `/checkout/payments/${payment_id}/refunds`, { reference }) as any;
    return text(`Refund accepted — action ${data.action_id}`);
  });

  // ── 5. void_payment
  server.tool('void_payment', 'Void an authorized payment', {
    payment_id: z.string().describe('Payment ID to void'),
    reference: z.string().optional().describe('Void reference'),
  }, async ({ payment_id, reference }) => {
    const data = await call('POST', `/checkout/payments/${payment_id}/voids`, { reference }) as any;
    return text(`Void accepted — action ${data.action_id}`);
  });

  // ── 6. get_payment_actions
  server.tool('get_payment_actions', 'Get payment action history', {
    payment_id: z.string().describe('Payment ID'),
  }, async ({ payment_id }) => {
    const data = await call('GET', `/checkout/payments/${payment_id}/actions`) as any;
    const actions = Array.isArray(data) ? data : [];
    const lines = actions.map((a: any) => `  ${a.id} — ${a.type} ${a.amount} [${a.response_code}]`);
    return text(`Actions for ${payment_id}:\n${lines.join('\n')}`);
  });

  // ── 7. tokenize_card
  server.tool('tokenize_card', 'Tokenize a card number', {
    number: z.string().describe('Card number'),
    expiry_month: z.number().optional().describe('Expiry month'),
    expiry_year: z.number().optional().describe('Expiry year'),
  }, async ({ number, expiry_month, expiry_year }) => {
    const data = await call('POST', '/checkout/tokens', { number, expiry_month, expiry_year }) as any;
    return text(`Token: ${data.token}\nScheme: ${data.scheme} ...${data.last4}\nExpires: ${data.expires_on}`);
  });

  // ── 8. create_instrument
  server.tool('create_instrument', 'Create a payment instrument (vault a card)', {
    type: z.string().optional().describe('Instrument type (default card)'),
    token: z.string().optional().describe('Token ID from tokenization'),
    customer_id: z.string().optional().describe('Customer ID to associate'),
  }, async ({ type, token, customer_id }) => {
    const data = await call('POST', '/checkout/instruments', {
      type: type || 'card',
      token,
      customer: customer_id ? { id: customer_id } : undefined,
    }) as any;
    return text(`Instrument ${data.id} created — ${data.scheme} ...${data.last4}`);
  });

  // ── 9. get_instrument
  server.tool('get_instrument', 'Get a payment instrument by ID', {
    instrument_id: z.string().describe('Instrument ID (src_xxx)'),
  }, async ({ instrument_id }) => {
    const data = await call('GET', `/checkout/instruments/${instrument_id}`) as any;
    return text(`Instrument ${data.id} — ${data.scheme} ...${data.last4} exp ${data.expiry_month}/${data.expiry_year}`);
  });

  // ── 10. create_customer
  server.tool('create_customer', 'Create a Checkout.com customer', {
    email: z.string().describe('Customer email'),
    name: z.string().optional().describe('Customer name'),
  }, async ({ email, name }) => {
    const data = await call('POST', '/checkout/customers', { email, name }) as any;
    return text(`Customer ${data.id} created — ${data.email}`);
  });

  // ── 11. get_customer
  server.tool('get_customer', 'Get a customer by ID', {
    customer_id: z.string().describe('Customer ID (cus_xxx)'),
  }, async ({ customer_id }) => {
    const data = await call('GET', `/checkout/customers/${customer_id}`) as any;
    return text(`Customer ${data.id} — ${data.email} ${data.name || ''}`);
  });

  // ── 12. list_disputes
  server.tool('list_disputes', 'List all disputes', {}, async () => {
    const data = await call('GET', '/checkout/disputes') as any;
    const items = data.data || [];
    if (!items.length) return text('No disputes found.');
    const lines = items.map((d: any) => `  ${d.id} — ${d.amount} ${d.currency} [${d.status}]`);
    return text(`Disputes (${data.total_count}):\n${lines.join('\n')}`);
  });

  // ── 13. create_hosted_payment
  server.tool('create_hosted_payment', 'Create a hosted payment page', {
    amount: z.number().describe('Amount in minor units'),
    currency: z.string().length(3).optional().describe('Currency code'),
    reference: z.string().optional().describe('Reference'),
  }, async ({ amount, currency, reference }) => {
    const data = await call('POST', '/checkout/hosted-payments', {
      amount,
      currency: currency || 'USD',
      reference,
    }) as any;
    return text(`Hosted payment ${data.id}\nRedirect: ${data._links?.redirect?.href}`);
  });

  // ── 14. create_payment_link
  server.tool('create_payment_link', 'Create a payment link', {
    amount: z.number().describe('Amount in minor units'),
    currency: z.string().length(3).optional().describe('Currency code'),
    reference: z.string().optional().describe('Reference'),
    description: z.string().optional().describe('Description'),
  }, async ({ amount, currency, reference, description }) => {
    const data = await call('POST', '/checkout/payment-links', {
      amount,
      currency: currency || 'USD',
      reference,
      description,
    }) as any;
    return text(`Payment link ${data.id}\nURL: ${data._links?.redirect?.href}\nExpires: ${data.expires_on}`);
  });

  // ── 15. create_3ds_session
  server.tool('create_3ds_session', 'Create a 3DS authentication session', {
    amount: z.number().describe('Amount in minor units'),
    currency: z.string().length(3).optional().describe('Currency code'),
  }, async ({ amount, currency }) => {
    const data = await call('POST', '/checkout/sessions', {
      amount,
      currency: currency || 'USD',
      source: { type: 'card' },
    }) as any;
    return text(`3DS Session ${data.id} [${data.status}]\nRedirect: ${data._links?.redirect_url?.href}`);
  });

  // ── 16. get_fx_rates
  server.tool('get_fx_rates', 'Get indicative FX rates', {
    source: z.string().optional().describe('Source currency (default USD)'),
    target: z.string().optional().describe('Target currency (default EUR)'),
  }, async ({ source, target }) => {
    const qp = new URLSearchParams();
    if (source) qp.set('source', source);
    if (target) qp.set('target', target);
    const data = await call('GET', `/checkout/forex/rates?${qp.toString()}`) as any;
    const rate = data.rates?.[0];
    return text(`FX Rate: ${data.source} -> ${rate?.target}: ${rate?.exchange_rate?.toFixed(4)}`);
  });

  // ── 17. create_transfer
  server.tool('create_transfer', 'Transfer funds between entities', {
    source_entity_id: z.string().describe('Source entity ID'),
    destination_entity_id: z.string().describe('Destination entity ID'),
    amount: z.number().describe('Amount in minor units'),
    currency: z.string().length(3).optional().describe('Currency code'),
    reference: z.string().optional().describe('Reference'),
  }, async ({ source_entity_id, destination_entity_id, amount, currency, reference }) => {
    const data = await call('POST', '/checkout/transfers', {
      source: { entity_id: source_entity_id },
      destination: { entity_id: destination_entity_id },
      amount,
      currency: currency || 'USD',
      reference,
    }) as any;
    return text(`Transfer ${data.id} [${data.status}] — ${data.amount} ${data.currency}`);
  });

  // ── 18. get_balance
  server.tool('get_balance', 'Get entity balance', {
    entity_id: z.string().describe('Entity ID'),
  }, async ({ entity_id }) => {
    const data = await call('GET', `/checkout/balances/${entity_id}`) as any;
    const lines = (data.balances || []).map((b: any) => `  ${b.currency}: available=${b.available} pending=${b.pending}`);
    return text(`Balances for ${data.entity_id}:\n${lines.join('\n')}`);
  });

  // ── 19. create_workflow
  server.tool('create_workflow', 'Create a webhook workflow', {
    name: z.string().describe('Workflow name'),
    url: z.string().optional().describe('Webhook URL'),
    event_types: z.array(z.string()).optional().describe('Event types'),
  }, async ({ name, url, event_types }) => {
    const data = await call('POST', '/checkout/workflows', {
      name,
      actions: url ? [{ type: 'webhook', url }] : [],
      conditions: event_types?.length
        ? [{ type: 'event', events: event_types.reduce((m: any, e) => ({ ...m, [e]: true }), {}) }]
        : [],
    }) as any;
    return text(`Workflow ${data.id} created — ${data.name}`);
  });

  // ── 20. search_checkout_documentation
  server.tool('search_checkout_documentation', 'Search Checkout.com documentation', {
    query: z.string().describe('Topic to search'),
  }, async ({ query }) => {
    return text(
      `Checkout.com documentation search for "${query}":\n\n` +
      `This is a mock Mimic server. For real docs, visit https://www.checkout.com/docs\n\n` +
      `Payment Flow: Request Payment (POST /payments) -> Capture/Void/Refund\n\n` +
      `API Products:\n` +
      `  Payments: POST /payments + /captures, /refunds, /voids\n` +
      `  Tokens: POST /tokens (card tokenization)\n` +
      `  Instruments: /instruments (vault cards)\n` +
      `  Customers: /customers (CRUD)\n` +
      `  Disputes: /disputes (list, evidence, accept)\n` +
      `  Hosted Payments: /hosted-payments\n` +
      `  Payment Links: /payment-links\n` +
      `  3DS Sessions: /sessions\n` +
      `  FX Rates: /forex/rates\n` +
      `  Transfers: /transfers (platform)\n` +
      `  Balances: /balances/:entityId\n` +
      `  Workflows: /workflows (webhooks)\n` +
      `  Events: /event-types, /events/:id\n`,
    );
  });
}

/**
 * Create a standalone Mimic MCP server for Checkout.com.
 */
export function createCheckoutComMcpServer(
  baseUrl: string = 'http://localhost:4104',
): McpServer {
  const server = new McpServer({
    name: 'mimic-checkout-com',
    version: '0.7.0',
    description:
      'Mimic MCP server for Checkout.com — payments, tokens, instruments, customers, disputes against mock data',
  });
  registerCheckoutComTools(server, baseUrl);
  return server;
}

/**
 * Start the Checkout.com MCP server on stdio transport.
 */
export async function startCheckoutComMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4104';
  const server = createCheckoutComMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic Checkout.com MCP server running on stdio');
}
