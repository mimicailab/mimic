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
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GoCardless mock error ${res.status}: ${text}`);
    }
    return res.json();
  };
}

function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    (e): e is [string, string | number] => e[1] !== undefined,
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

function json(data: unknown) {
  return text(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Factory — GoCardless MCP tools (Tier 2: community parity + extras)
// ---------------------------------------------------------------------------

export function registerGoCardlessTools(server: McpServer, baseUrl: string = 'http://localhost:4100'): void {
  const call = makeCall(baseUrl);

  // ── Customers ──────────────────────────────────────────────────────

  server.tool('create_customer', 'Create a GoCardless customer', {
    email: z.string().describe('Customer email'),
    given_name: z.string().optional().describe('First name'),
    family_name: z.string().optional().describe('Last name'),
    company_name: z.string().optional().describe('Company name'),
    country_code: z.string().optional().describe('ISO country code'),
    metadata: z.record(z.string()).optional().describe('Metadata'),
  }, async (params) => {
    const data = await call('POST', '/gocardless/customers', { customers: params }) as any;
    return text(`Created customer ${data.customers.id}: ${data.customers.given_name ?? ''} ${data.customers.family_name ?? ''}`);
  });

  server.tool('get_customer', 'Get a GoCardless customer by ID', {
    customer_id: z.string().describe('Customer ID'),
  }, async ({ customer_id }) => {
    const data = await call('GET', `/gocardless/customers/${customer_id}`);
    return json(data);
  });

  server.tool('list_customers', 'List GoCardless customers', {
    email: z.string().optional().describe('Filter by email'),
  }, async ({ email }) => {
    const data = await call('GET', `/gocardless/customers${qs({ email })}`) as any;
    if (!data.customers?.length) return text('No customers found.');
    const lines = data.customers.map((c: any) => `• ${c.id} — ${c.given_name ?? ''} ${c.family_name ?? ''} (${c.email})`);
    return text(`Customers (${data.customers.length}):\n${lines.join('\n')}`);
  });

  server.tool('update_customer', 'Update a GoCardless customer', {
    customer_id: z.string().describe('Customer ID'),
    email: z.string().optional().describe('Email'),
    given_name: z.string().optional().describe('First name'),
    family_name: z.string().optional().describe('Last name'),
    company_name: z.string().optional().describe('Company name'),
    metadata: z.record(z.string()).optional().describe('Metadata'),
  }, async ({ customer_id, ...rest }) => {
    const data = await call('PUT', `/gocardless/customers/${customer_id}`, { customers: rest }) as any;
    return text(`Updated customer ${data.customers.id}`);
  });

  // ── Customer Bank Accounts ─────────────────────────────────────────

  server.tool('create_customer_bank_account', 'Create a bank account for a customer', {
    customer: z.string().describe('Customer ID (links.customer)'),
    account_holder_name: z.string().describe('Account holder name'),
    country_code: z.string().describe('Country code (GB, DE, etc.)'),
    currency: z.string().optional().describe('Currency (GBP, EUR, etc.)'),
    account_number: z.string().optional().describe('Account number'),
    sort_code: z.string().optional().describe('Sort code (UK)'),
    iban: z.string().optional().describe('IBAN (EU)'),
  }, async (params) => {
    const data = await call('POST', '/gocardless/customer_bank_accounts', { customer_bank_accounts: params }) as any;
    return text(`Created bank account ${data.customer_bank_accounts.id}`);
  });

  server.tool('get_customer_bank_account', 'Get a bank account by ID', {
    bank_account_id: z.string().describe('Bank account ID'),
  }, async ({ bank_account_id }) => {
    const data = await call('GET', `/gocardless/customer_bank_accounts/${bank_account_id}`);
    return json(data);
  });

  server.tool('list_customer_bank_accounts', 'List bank accounts', {
    customer: z.string().optional().describe('Filter by customer ID'),
  }, async ({ customer }) => {
    const data = await call('GET', `/gocardless/customer_bank_accounts${qs({ customer })}`) as any;
    if (!data.customer_bank_accounts?.length) return text('No bank accounts found.');
    const lines = data.customer_bank_accounts.map((a: any) => `• ${a.id} — ${a.account_holder_name} (${a.currency})`);
    return text(`Bank accounts (${data.customer_bank_accounts.length}):\n${lines.join('\n')}`);
  });

  server.tool('disable_customer_bank_account', 'Disable a bank account', {
    bank_account_id: z.string().describe('Bank account ID'),
  }, async ({ bank_account_id }) => {
    const data = await call('POST', `/gocardless/customer_bank_accounts/${bank_account_id}/actions/disable`) as any;
    return text(`Disabled bank account ${data.customer_bank_accounts.id}`);
  });

  // ── Mandates ───────────────────────────────────────────────────────

  server.tool('create_mandate', 'Create a direct debit mandate', {
    scheme: z.enum(['bacs', 'sepa_core', 'ach', 'autogiro']).describe('Direct debit scheme'),
    customer_bank_account: z.string().describe('Bank account ID (links)'),
    metadata: z.record(z.string()).optional().describe('Metadata'),
  }, async ({ customer_bank_account, ...rest }) => {
    const data = await call('POST', '/gocardless/mandates', {
      mandates: { ...rest, links: { customer_bank_account } },
    }) as any;
    return text(`Created mandate ${data.mandates.id} [${data.mandates.status}]`);
  });

  server.tool('get_mandate', 'Get a mandate by ID', {
    mandate_id: z.string().describe('Mandate ID'),
  }, async ({ mandate_id }) => {
    const data = await call('GET', `/gocardless/mandates/${mandate_id}`);
    return json(data);
  });

  server.tool('list_mandates', 'List mandates', {
    customer: z.string().optional().describe('Filter by customer'),
    status: z.string().optional().describe('Filter by status'),
  }, async ({ customer, status }) => {
    const data = await call('GET', `/gocardless/mandates${qs({ customer, status })}`) as any;
    if (!data.mandates?.length) return text('No mandates found.');
    const lines = data.mandates.map((m: any) => `• ${m.id} — ${m.scheme} [${m.status}]`);
    return text(`Mandates (${data.mandates.length}):\n${lines.join('\n')}`);
  });

  server.tool('cancel_mandate', 'Cancel a mandate', {
    mandate_id: z.string().describe('Mandate ID'),
  }, async ({ mandate_id }) => {
    const data = await call('POST', `/gocardless/mandates/${mandate_id}/actions/cancel`) as any;
    return text(`Cancelled mandate ${data.mandates.id}`);
  });

  server.tool('reinstate_mandate', 'Reinstate a cancelled mandate', {
    mandate_id: z.string().describe('Mandate ID'),
  }, async ({ mandate_id }) => {
    const data = await call('POST', `/gocardless/mandates/${mandate_id}/actions/reinstate`) as any;
    return text(`Reinstated mandate ${data.mandates.id}`);
  });

  // ── Payments ───────────────────────────────────────────────────────

  server.tool('create_payment', 'Create a payment (collect money via direct debit)', {
    amount: z.number().int().positive().describe('Amount in minor units (pence/cents)'),
    currency: z.string().describe('Currency code (GBP, EUR, USD)'),
    mandate: z.string().describe('Mandate ID (links.mandate)'),
    description: z.string().optional().describe('Payment description'),
    charge_date: z.string().optional().describe('Charge date (YYYY-MM-DD)'),
    metadata: z.record(z.string()).optional().describe('Metadata'),
  }, async ({ mandate, ...rest }) => {
    const data = await call('POST', '/gocardless/payments', {
      payments: { ...rest, links: { mandate } },
    }) as any;
    return text(`Created payment ${data.payments.id} for ${data.payments.amount} ${data.payments.currency} [${data.payments.status}]`);
  });

  server.tool('get_payment', 'Get a payment by ID', {
    payment_id: z.string().describe('Payment ID'),
  }, async ({ payment_id }) => {
    const data = await call('GET', `/gocardless/payments/${payment_id}`);
    return json(data);
  });

  server.tool('list_payments', 'List payments', {
    mandate: z.string().optional().describe('Filter by mandate'),
    subscription: z.string().optional().describe('Filter by subscription'),
    status: z.string().optional().describe('Filter by status'),
  }, async ({ mandate, subscription, status }) => {
    const data = await call('GET', `/gocardless/payments${qs({ mandate, subscription, status })}`) as any;
    if (!data.payments?.length) return text('No payments found.');
    const lines = data.payments.map((p: any) => `• ${p.id} — ${p.amount} ${p.currency} [${p.status}]`);
    return text(`Payments (${data.payments.length}):\n${lines.join('\n')}`);
  });

  server.tool('cancel_payment', 'Cancel a pending payment', {
    payment_id: z.string().describe('Payment ID'),
  }, async ({ payment_id }) => {
    const data = await call('POST', `/gocardless/payments/${payment_id}/actions/cancel`) as any;
    return text(`Cancelled payment ${data.payments.id}`);
  });

  server.tool('retry_payment', 'Retry a failed payment', {
    payment_id: z.string().describe('Payment ID'),
  }, async ({ payment_id }) => {
    const data = await call('POST', `/gocardless/payments/${payment_id}/actions/retry`) as any;
    return text(`Retried payment ${data.payments.id} [${data.payments.status}]`);
  });

  // ── Subscriptions ──────────────────────────────────────────────────

  server.tool('create_subscription', 'Create a recurring subscription', {
    amount: z.number().int().positive().describe('Amount per payment in minor units'),
    currency: z.string().describe('Currency code'),
    mandate: z.string().describe('Mandate ID (links.mandate)'),
    name: z.string().optional().describe('Subscription name'),
    interval_unit: z.enum(['weekly', 'monthly', 'yearly']).optional().describe('Interval unit'),
    interval: z.number().int().positive().optional().describe('Interval count'),
    day_of_month: z.number().int().min(1).max(28).optional().describe('Day of month to collect'),
    metadata: z.record(z.string()).optional().describe('Metadata'),
  }, async ({ mandate, ...rest }) => {
    const data = await call('POST', '/gocardless/subscriptions', {
      subscriptions: { ...rest, links: { mandate } },
    }) as any;
    return text(`Created subscription ${data.subscriptions.id} for ${data.subscriptions.amount} ${data.subscriptions.currency} [${data.subscriptions.status}]`);
  });

  server.tool('get_subscription', 'Get a subscription by ID', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('GET', `/gocardless/subscriptions/${subscription_id}`);
    return json(data);
  });

  server.tool('list_subscriptions', 'List subscriptions', {
    mandate: z.string().optional().describe('Filter by mandate'),
    customer: z.string().optional().describe('Filter by customer'),
    status: z.string().optional().describe('Filter by status'),
  }, async ({ mandate, customer, status }) => {
    const data = await call('GET', `/gocardless/subscriptions${qs({ mandate, customer, status })}`) as any;
    if (!data.subscriptions?.length) return text('No subscriptions found.');
    const lines = data.subscriptions.map((s: any) => `• ${s.id} — ${s.amount} ${s.currency} [${s.status}]`);
    return text(`Subscriptions (${data.subscriptions.length}):\n${lines.join('\n')}`);
  });

  server.tool('cancel_subscription', 'Cancel a subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('POST', `/gocardless/subscriptions/${subscription_id}/actions/cancel`) as any;
    return text(`Cancelled subscription ${data.subscriptions.id}`);
  });

  server.tool('pause_subscription', 'Pause a subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('POST', `/gocardless/subscriptions/${subscription_id}/actions/pause`) as any;
    return text(`Paused subscription ${data.subscriptions.id}`);
  });

  server.tool('resume_subscription', 'Resume a paused subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('POST', `/gocardless/subscriptions/${subscription_id}/actions/resume`) as any;
    return text(`Resumed subscription ${data.subscriptions.id}`);
  });

  // ── Refunds ────────────────────────────────────────────────────────

  server.tool('create_refund', 'Create a refund for a payment', {
    amount: z.number().int().positive().describe('Refund amount in minor units'),
    payment: z.string().describe('Payment ID to refund (links.payment)'),
    reference: z.string().optional().describe('Refund reference'),
    metadata: z.record(z.string()).optional().describe('Metadata'),
  }, async ({ payment, ...rest }) => {
    const data = await call('POST', '/gocardless/refunds', {
      refunds: { ...rest, links: { payment } },
    }) as any;
    return text(`Created refund ${data.refunds.id} for ${data.refunds.amount} ${data.refunds.currency}`);
  });

  server.tool('get_refund', 'Get a refund by ID', {
    refund_id: z.string().describe('Refund ID'),
  }, async ({ refund_id }) => {
    const data = await call('GET', `/gocardless/refunds/${refund_id}`);
    return json(data);
  });

  server.tool('list_refunds', 'List refunds', {
    payment: z.string().optional().describe('Filter by payment'),
  }, async ({ payment }) => {
    const data = await call('GET', `/gocardless/refunds${qs({ payment })}`) as any;
    if (!data.refunds?.length) return text('No refunds found.');
    const lines = data.refunds.map((r: any) => `• ${r.id} — ${r.amount} ${r.currency}`);
    return text(`Refunds (${data.refunds.length}):\n${lines.join('\n')}`);
  });

  // ── Payouts ────────────────────────────────────────────────────────

  server.tool('list_payouts', 'List payouts', {}, async () => {
    const data = await call('GET', '/gocardless/payouts') as any;
    if (!data.payouts?.length) return text('No payouts found.');
    const lines = data.payouts.map((p: any) => `• ${p.id} — ${p.amount} ${p.currency}`);
    return text(`Payouts (${data.payouts.length}):\n${lines.join('\n')}`);
  });

  server.tool('get_payout', 'Get a payout by ID', {
    payout_id: z.string().describe('Payout ID'),
  }, async ({ payout_id }) => {
    const data = await call('GET', `/gocardless/payouts/${payout_id}`);
    return json(data);
  });

  // ── Payout Items ───────────────────────────────────────────────────

  server.tool('list_payout_items', 'List payout items', {
    payout: z.string().optional().describe('Filter by payout ID'),
  }, async ({ payout }) => {
    const data = await call('GET', `/gocardless/payout_items${qs({ payout })}`) as any;
    if (!data.payout_items?.length) return text('No payout items found.');
    return text(`Payout items (${data.payout_items.length}):\n${JSON.stringify(data.payout_items, null, 2)}`);
  });

  // ── Instalment Schedules ───────────────────────────────────────────

  server.tool('create_instalment_schedule', 'Create an instalment schedule', {
    total_amount: z.number().int().positive().describe('Total amount in minor units'),
    currency: z.string().describe('Currency code'),
    mandate: z.string().describe('Mandate ID (links.mandate)'),
    instalments: z.array(z.object({
      charge_date: z.string(),
      amount: z.number().int().positive(),
    })).describe('Instalment details'),
    metadata: z.record(z.string()).optional().describe('Metadata'),
  }, async ({ mandate, ...rest }) => {
    const data = await call('POST', '/gocardless/instalment_schedules', {
      instalment_schedules: { ...rest, links: { mandate } },
    }) as any;
    return text(`Created instalment schedule ${data.instalment_schedules.id}`);
  });

  server.tool('get_instalment_schedule', 'Get an instalment schedule by ID', {
    instalment_schedule_id: z.string().describe('Instalment schedule ID'),
  }, async ({ instalment_schedule_id }) => {
    const data = await call('GET', `/gocardless/instalment_schedules/${instalment_schedule_id}`);
    return json(data);
  });

  server.tool('list_instalment_schedules', 'List instalment schedules', {}, async () => {
    const data = await call('GET', '/gocardless/instalment_schedules') as any;
    if (!data.instalment_schedules?.length) return text('No instalment schedules found.');
    const lines = data.instalment_schedules.map((s: any) => `• ${s.id} — ${s.total_amount} ${s.currency} [${s.status}]`);
    return text(`Instalment schedules (${data.instalment_schedules.length}):\n${lines.join('\n')}`);
  });

  server.tool('cancel_instalment_schedule', 'Cancel an instalment schedule', {
    instalment_schedule_id: z.string().describe('Instalment schedule ID'),
  }, async ({ instalment_schedule_id }) => {
    const data = await call('POST', `/gocardless/instalment_schedules/${instalment_schedule_id}/actions/cancel`) as any;
    return text(`Cancelled instalment schedule ${data.instalment_schedules.id}`);
  });

  // ── Billing Requests ───────────────────────────────────────────────

  server.tool('create_billing_request', 'Create a billing request for bank account setup', {
    mandate_request: z.object({
      scheme: z.string().optional(),
    }).optional().describe('Mandate request details'),
    payment_request: z.object({
      amount: z.number().int().positive().optional(),
      currency: z.string().optional(),
      description: z.string().optional(),
    }).optional().describe('Payment request details'),
    metadata: z.record(z.string()).optional().describe('Metadata'),
  }, async (params) => {
    const data = await call('POST', '/gocardless/billing_requests', { billing_requests: params }) as any;
    return text(`Created billing request ${data.billing_requests.id} [${data.billing_requests.status}]`);
  });

  server.tool('get_billing_request', 'Get a billing request by ID', {
    billing_request_id: z.string().describe('Billing request ID'),
  }, async ({ billing_request_id }) => {
    const data = await call('GET', `/gocardless/billing_requests/${billing_request_id}`);
    return json(data);
  });

  server.tool('list_billing_requests', 'List billing requests', {}, async () => {
    const data = await call('GET', '/gocardless/billing_requests') as any;
    if (!data.billing_requests?.length) return text('No billing requests found.');
    const lines = data.billing_requests.map((b: any) => `• ${b.id} — [${b.status}]`);
    return text(`Billing requests (${data.billing_requests.length}):\n${lines.join('\n')}`);
  });

  // ── Billing Request Flows ──────────────────────────────────────────

  server.tool('create_billing_request_flow', 'Create a hosted flow for a billing request', {
    billing_request: z.string().describe('Billing request ID (links.billing_request)'),
    redirect_uri: z.string().optional().describe('Redirect URI after completion'),
    auto_fulfil: z.boolean().optional().describe('Auto-fulfil after completion'),
  }, async ({ billing_request, ...rest }) => {
    const data = await call('POST', '/gocardless/billing_request_flows', {
      billing_request_flows: { ...rest, links: { billing_request } },
    }) as any;
    return text(`Created flow: ${data.billing_request_flows.authorisation_url}`);
  });

  // ── Creditors ──────────────────────────────────────────────────────

  server.tool('list_creditors', 'List creditors', {}, async () => {
    const data = await call('GET', '/gocardless/creditors') as any;
    if (!data.creditors?.length) return text('No creditors found.');
    const lines = data.creditors.map((c: any) => `• ${c.id} — ${c.name} (${c.country_code})`);
    return text(`Creditors (${data.creditors.length}):\n${lines.join('\n')}`);
  });

  server.tool('get_creditor', 'Get a creditor by ID', {
    creditor_id: z.string().describe('Creditor ID'),
  }, async ({ creditor_id }) => {
    const data = await call('GET', `/gocardless/creditors/${creditor_id}`);
    return json(data);
  });

  // ── Events ─────────────────────────────────────────────────────────

  server.tool('list_events', 'List GoCardless events', {
    resource_type: z.string().optional().describe('Filter by resource type'),
    action: z.string().optional().describe('Filter by action'),
  }, async ({ resource_type, action }) => {
    const data = await call('GET', `/gocardless/events${qs({ resource_type, action })}`) as any;
    if (!data.events?.length) return text('No events found.');
    const lines = data.events.map((e: any) => `• ${e.id} — ${e.resource_type}.${e.action}`);
    return text(`Events (${data.events.length}):\n${lines.join('\n')}`);
  });

  server.tool('get_event', 'Get an event by ID', {
    event_id: z.string().describe('Event ID'),
  }, async ({ event_id }) => {
    const data = await call('GET', `/gocardless/events/${event_id}`);
    return json(data);
  });

  // ── Composite Tools (MCP only) ────────────────────────────────────

  server.tool('get_subscription_details', 'Get subscription with mandate and customer details in one call', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const subData = await call('GET', `/gocardless/subscriptions/${subscription_id}`) as any;
    const sub = subData.subscriptions;
    const result: any = { subscription: sub };

    if (sub.links?.mandate) {
      try {
        const mdData = await call('GET', `/gocardless/mandates/${sub.links.mandate}`) as any;
        result.mandate = mdData.mandates;
        if (mdData.mandates?.links?.customer) {
          const custData = await call('GET', `/gocardless/customers/${mdData.mandates.links.customer}`) as any;
          result.customer = custData.customers;
        }
      } catch { /* skip */ }
    }

    return json(result);
  });
}

/**
 * Create a standalone Mimic MCP server for GoCardless.
 */
export function createGoCardlessMcpServer(baseUrl: string = 'http://localhost:4100'): McpServer {
  const server = new McpServer({
    name: 'mimic-gocardless',
    version: '0.5.0',
    description: 'Mimic MCP server for GoCardless — direct debit, bank payments, mandates, subscriptions',
  });
  registerGoCardlessTools(server, baseUrl);
  return server;
}

/**
 * Start the GoCardless MCP server on stdio transport.
 */
export async function startGoCardlessMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4100';
  const server = createGoCardlessMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic GoCardless MCP server running on stdio');
}
