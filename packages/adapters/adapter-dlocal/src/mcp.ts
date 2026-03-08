import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DL_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Login': 'dl_mock_login',
  'X-Trans-Key': 'mock_trans_key',
  'X-Date': new Date().toISOString(),
  'X-Version': '2.1',
  'Authorization': 'V2-HMAC-SHA256, Signature: mock_signature',
};

function makeCall(baseUrl: string) {
  return async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...DL_HEADERS, 'X-Date': new Date().toISOString() },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && res.status !== 201 && res.status !== 202 && res.status !== 204) {
      const text = await res.text();
      throw new Error(`dLocal mock error ${res.status}: ${text}`);
    }
    if (res.status === 204 || res.status === 202) return {};
    return res.json();
  };
}

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function registerDlocalTools(
  server: McpServer,
  baseUrl: string = 'http://localhost:4104',
): void {
  const call = makeCall(baseUrl);

  // ── 1. create_payment
  server.tool('create_payment', 'Create a dLocal payment', {
    amount: z.number().describe('Payment amount'),
    currency: z.string().length(3).optional().describe('Currency code (e.g. USD)'),
    country: z.string().length(2).optional().describe('Country code (e.g. BR)'),
    payment_method_id: z.string().optional().describe('Payment method ID (e.g. CARD, PIX)'),
    description: z.string().optional().describe('Payment description (use REJECT/PENDING/AUTHORIZE to control outcome)'),
  }, async ({ amount, currency, country, payment_method_id, description }) => {
    const data = await call('POST', '/dlocal/payments', {
      amount,
      currency: currency || 'USD',
      country: country || 'BR',
      payment_method_id: payment_method_id || 'CARD',
      description,
    }) as any;
    return text(`Payment ${data.id} created [${data.status}] — ${data.amount} ${data.currency}`);
  });

  // ── 2. create_secure_payment
  server.tool('create_secure_payment', 'Create a dLocal payment with raw card data', {
    amount: z.number().describe('Payment amount'),
    currency: z.string().length(3).optional().describe('Currency code'),
    country: z.string().length(2).optional().describe('Country code'),
    card_number: z.string().optional().describe('Card number'),
    card_holder_name: z.string().optional().describe('Cardholder name'),
    card_expiration_month: z.number().optional().describe('Card expiration month'),
    card_expiration_year: z.number().optional().describe('Card expiration year'),
    card_cvv: z.string().optional().describe('Card CVV'),
  }, async ({ amount, currency, country, card_number, card_holder_name, card_expiration_month, card_expiration_year, card_cvv }) => {
    const data = await call('POST', '/dlocal/secure_payments', {
      amount,
      currency: currency || 'USD',
      country: country || 'BR',
      card: {
        holder_name: card_holder_name || 'John Doe',
        number: card_number || '4111111111111111',
        expiration_month: card_expiration_month || 12,
        expiration_year: card_expiration_year || 2027,
        cvv: card_cvv || '123',
      },
    }) as any;
    return text(`Secure payment ${data.id} created [${data.status}] — ${data.amount} ${data.currency}\nCard: ****${data.card?.last4}`);
  });

  // ── 3. get_payment
  server.tool('get_payment', 'Get a dLocal payment by ID', {
    payment_id: z.string().describe('Payment ID'),
  }, async ({ payment_id }) => {
    const data = await call('GET', `/dlocal/payments/${payment_id}`) as any;
    return text(`Payment ${data.id}: ${data.amount} ${data.currency} [${data.status}] — ${data.country}`);
  });

  // ── 4. cancel_payment
  server.tool('cancel_payment', 'Cancel a pending/authorized dLocal payment', {
    payment_id: z.string().describe('Payment ID to cancel'),
  }, async ({ payment_id }) => {
    const data = await call('POST', `/dlocal/payments/${payment_id}/cancel`) as any;
    return text(`Payment ${data.id} cancelled [${data.status}]`);
  });

  // ── 5. capture_payment
  server.tool('capture_payment', 'Capture an authorized dLocal payment', {
    payment_id: z.string().describe('Payment ID to capture'),
    amount: z.number().optional().describe('Amount to capture (optional, defaults to full amount)'),
  }, async ({ payment_id, amount }) => {
    const body: any = {};
    if (amount !== undefined) body.amount = amount;
    const data = await call('POST', `/dlocal/payments/${payment_id}/capture`, body) as any;
    return text(`Payment ${data.id} captured [${data.status}] — ${data.amount} ${data.currency}`);
  });

  // ── 6. create_refund
  server.tool('create_refund', 'Refund a dLocal payment', {
    payment_id: z.string().describe('Payment ID to refund'),
    amount: z.number().optional().describe('Refund amount (optional, defaults to full amount)'),
    currency: z.string().length(3).optional().describe('Currency code'),
    description: z.string().optional().describe('Refund description'),
  }, async ({ payment_id, amount, currency, description }) => {
    const body: any = { payment_id };
    if (amount !== undefined) body.amount = amount;
    if (currency) body.currency = currency;
    if (description) body.description = description;
    const data = await call('POST', '/dlocal/refunds', body) as any;
    return text(`Refund ${data.id} [${data.status}] — ${data.amount} ${data.currency}`);
  });

  // ── 7. get_refund
  server.tool('get_refund', 'Get a dLocal refund by ID', {
    refund_id: z.string().describe('Refund ID'),
  }, async ({ refund_id }) => {
    const data = await call('GET', `/dlocal/refunds/${refund_id}`) as any;
    return text(`Refund ${data.id}: ${data.amount} ${data.currency} [${data.status}]`);
  });

  // ── 8. create_payout
  server.tool('create_payout', 'Create a dLocal payout', {
    amount: z.number().describe('Payout amount'),
    currency: z.string().length(3).optional().describe('Currency code'),
    country: z.string().length(2).optional().describe('Country code'),
    type: z.string().optional().describe('Payout type (e.g. BANK_TRANSFER)'),
    beneficiary_name: z.string().optional().describe('Beneficiary name'),
  }, async ({ amount, currency, country, type, beneficiary_name }) => {
    const data = await call('POST', '/dlocal/payouts', {
      amount,
      currency: currency || 'USD',
      country: country || 'BR',
      type: type || 'BANK_TRANSFER',
      beneficiary: beneficiary_name ? { name: beneficiary_name } : {},
    }) as any;
    return text(`Payout ${data.id} created [${data.status}] — ${data.amount} ${data.currency}`);
  });

  // ── 9. get_payout
  server.tool('get_payout', 'Get a dLocal payout by ID', {
    payout_id: z.string().describe('Payout ID'),
  }, async ({ payout_id }) => {
    const data = await call('GET', `/dlocal/payouts/${payout_id}`) as any;
    return text(`Payout ${data.id}: ${data.amount} ${data.currency} [${data.status}]`);
  });

  // ── 10. list_payment_methods
  server.tool('list_payment_methods', 'List available dLocal payment methods for a country', {
    country: z.string().length(2).optional().describe('Country code (e.g. BR, MX, IN)'),
  }, async ({ country }) => {
    const data = await call('GET', `/dlocal/payments-methods?country=${country || 'BR'}`) as any;
    const methods = Array.isArray(data) ? data : [];
    if (!methods.length) return text('No payment methods found.');
    const lines = methods.map((m: any) => `  ${m.id} — ${m.name} [${m.type}] (${m.flow})`);
    return text(`Payment methods for ${country || 'BR'}:\n${lines.join('\n')}`);
  });

  // ── 11. get_exchange_rate
  server.tool('get_exchange_rate', 'Get dLocal exchange rate between currencies', {
    from: z.string().length(3).optional().describe('Source currency (default USD)'),
    to: z.string().length(3).optional().describe('Target currency (default BRL)'),
  }, async ({ from, to }) => {
    const data = await call('GET', `/dlocal/exchange-rates?from=${from || 'USD'}&to=${to || 'BRL'}`) as any;
    return text(`Exchange rate: ${data.from} -> ${data.to} = ${data.rate}`);
  });

  // ── 12. get_installment_plans
  server.tool('get_installment_plans', 'Get dLocal installment plans for a payment', {
    country: z.string().length(2).optional().describe('Country code'),
    bin: z.string().optional().describe('Card BIN (first 6 digits)'),
    amount: z.number().optional().describe('Payment amount'),
    currency: z.string().length(3).optional().describe('Currency code'),
  }, async ({ country, bin, amount, currency }) => {
    const qp = new URLSearchParams();
    if (country) qp.set('country', country);
    if (bin) qp.set('bin', bin);
    if (amount !== undefined) qp.set('amount', String(amount));
    if (currency) qp.set('currency', currency);
    const data = await call('GET', `/dlocal/installments-plans?${qp.toString()}`) as any;
    const plans = data.installments || [];
    const lines = plans.map((p: any) => `  ${p.installments}x ${p.installment_amount} (total: ${p.total_amount})`);
    return text(`Installment plans for ${data.amount} ${data.currency}:\n${lines.join('\n')}`);
  });

  // ── 13. submit_chargeback_dispute
  server.tool('submit_chargeback_dispute', 'Submit evidence for a dLocal chargeback dispute', {
    chargeback_id: z.string().describe('Chargeback ID'),
    evidence: z.string().optional().describe('Dispute evidence text'),
  }, async ({ chargeback_id, evidence }) => {
    const data = await call('POST', `/dlocal/chargebacks/dispute/${chargeback_id}`, {
      evidence_text: evidence || 'Dispute evidence provided',
    }) as any;
    return text(`Chargeback ${data.id} — dispute submitted [${data.status}]`);
  });

  // ── 14. search_dlocal_documentation
  server.tool('search_dlocal_documentation', 'Search dLocal documentation', {
    query: z.string().describe('Topic to search'),
  }, async ({ query }) => {
    return text(
      `dLocal documentation search for "${query}":\n\n` +
      `This is a mock Mimic server. For real docs, visit https://docs.dlocal.com\n\n` +
      `Payment Flow: Create Payment -> PAID | REJECTED | PENDING | AUTHORIZED\n` +
      `Authorized: Capture or Cancel\n\n` +
      `API Products:\n` +
      `  Payments: POST /payments + /secure_payments\n` +
      `  Refunds: POST /refunds\n` +
      `  Payouts: POST /payouts\n` +
      `  Chargebacks: POST /chargebacks/dispute/:id\n` +
      `  Payment Methods: GET /payments-methods?country=XX\n` +
      `  Exchange Rates: GET /exchange-rates?from=USD&to=BRL\n` +
      `  Installments: GET /installments-plans\n\n` +
      `Supported regions: LatAm (BR, MX, AR, CO, CL, PE), Africa (NG, KE, ZA, GH, EG), Asia (IN, ID, PH, TH, VN, JP, MY)\n`,
    );
  });
}

/**
 * Create a standalone Mimic MCP server for dLocal.
 */
export function createDlocalMcpServer(
  baseUrl: string = 'http://localhost:4104',
): McpServer {
  const server = new McpServer({
    name: 'mimic-dlocal',
    version: '0.7.0',
    description:
      'Mimic MCP server for dLocal — payments, refunds, payouts, chargebacks, local payment methods against mock data',
  });
  registerDlocalTools(server, baseUrl);
  return server;
}

/**
 * Start the dLocal MCP server on stdio transport.
 */
export async function startDlocalMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4104';
  const server = createDlocalMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic dLocal MCP server running on stdio');
}
