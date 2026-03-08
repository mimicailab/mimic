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
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer FLWSECK_TEST-mimic-mock-key',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && res.status !== 201 && res.status !== 202 && res.status !== 204) {
      const text = await res.text();
      throw new Error(`Flutterwave mock error ${res.status}: ${text}`);
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

export function registerFlutterwaveTools(
  server: McpServer,
  baseUrl: string = 'http://localhost:4104',
): void {
  const call = makeCall(baseUrl);

  // ── 1. create_payment
  server.tool('create_payment', 'Create a Flutterwave hosted payment link', {
    tx_ref: z.string().describe('Unique transaction reference'),
    amount: z.number().describe('Payment amount'),
    currency: z.string().optional().describe('Currency (default NGN)'),
    customer_email: z.string().optional().describe('Customer email'),
    redirect_url: z.string().optional().describe('Redirect URL after payment'),
  }, async ({ tx_ref, amount, currency, customer_email, redirect_url }) => {
    const data = await call('POST', '/flutterwave/v3/payments', {
      tx_ref,
      amount,
      currency: currency || 'NGN',
      customer: customer_email ? { email: customer_email } : {},
      redirect_url,
    }) as any;
    return text(`Payment link created: ${data.data?.link || 'N/A'}`);
  });

  // ── 2. charge_card
  server.tool('charge_card', 'Initiate a direct card charge', {
    tx_ref: z.string().describe('Unique transaction reference'),
    amount: z.number().describe('Charge amount'),
    currency: z.string().optional().describe('Currency (default NGN)'),
    email: z.string().describe('Customer email'),
  }, async ({ tx_ref, amount, currency, email }) => {
    const data = await call('POST', '/flutterwave/v3/charges?type=card', {
      tx_ref,
      amount,
      currency: currency || 'NGN',
      email,
      card_number: '4111111111111111',
      cvv: '123',
      expiry_month: '12',
      expiry_year: '27',
    }) as any;
    const txn = data.data;
    return text(`Charge ${txn?.id} [${txn?.status}] - ${txn?.amount} ${txn?.currency}`);
  });

  // ── 3. validate_charge
  server.tool('validate_charge', 'Validate a charge with OTP', {
    flw_ref: z.string().describe('Flutterwave reference from charge response'),
    otp: z.string().describe('OTP code'),
  }, async ({ flw_ref, otp }) => {
    const data = await call('POST', '/flutterwave/v3/validate-charge', { flw_ref, otp }) as any;
    const txn = data.data;
    return text(`Charge validated: ${txn?.id} [${txn?.status}]`);
  });

  // ── 4. get_transaction
  server.tool('get_transaction', 'Get a transaction by ID', {
    transaction_id: z.string().describe('Transaction ID'),
  }, async ({ transaction_id }) => {
    const data = await call('GET', `/flutterwave/v3/transactions/${transaction_id}`) as any;
    const txn = data.data;
    return text(`Transaction ${txn?.id}: ${txn?.amount} ${txn?.currency} [${txn?.status}]`);
  });

  // ── 5. verify_transaction
  server.tool('verify_transaction', 'Verify a transaction by ID', {
    transaction_id: z.string().describe('Transaction ID'),
  }, async ({ transaction_id }) => {
    const data = await call('GET', `/flutterwave/v3/transactions/${transaction_id}/verify`) as any;
    const txn = data.data;
    return text(`Verified: ${txn?.id} [${txn?.status}] - ${txn?.amount} ${txn?.currency}`);
  });

  // ── 6. list_transactions
  server.tool('list_transactions', 'List transactions with optional filters', {
    status: z.string().optional().describe('Filter by status'),
    page: z.number().optional().describe('Page number'),
  }, async ({ status, page }) => {
    const qp = new URLSearchParams();
    if (status) qp.set('status', status);
    if (page) qp.set('page', String(page));
    const data = await call('GET', `/flutterwave/v3/transactions?${qp.toString()}`) as any;
    const items = data.data || [];
    if (!items.length) return text('No transactions found.');
    const lines = items.map((t: any) => `  ${t.id} - ${t.amount} ${t.currency} [${t.status}]`);
    return text(`Transactions (${data.meta?.page_info?.total || items.length}):\n${lines.join('\n')}`);
  });

  // ── 7. refund_transaction
  server.tool('refund_transaction', 'Refund a transaction', {
    transaction_id: z.string().describe('Transaction ID'),
    amount: z.number().optional().describe('Partial refund amount'),
  }, async ({ transaction_id, amount }) => {
    const body: any = {};
    if (amount) body.amount = amount;
    const data = await call('POST', `/flutterwave/v3/transactions/${transaction_id}/refund`, body) as any;
    const refund = data.data;
    return text(`Refund ${refund?.id} [${refund?.status}] - ${refund?.amount_refunded}`);
  });

  // ── 8. create_transfer
  server.tool('create_transfer', 'Create a payout transfer', {
    account_bank: z.string().describe('Bank code'),
    account_number: z.string().describe('Account number'),
    amount: z.number().describe('Transfer amount'),
    currency: z.string().optional().describe('Currency (default NGN)'),
    narration: z.string().optional().describe('Transfer narration'),
  }, async ({ account_bank, account_number, amount, currency, narration }) => {
    const data = await call('POST', '/flutterwave/v3/transfers', {
      account_bank,
      account_number,
      amount,
      currency: currency || 'NGN',
      narration,
    }) as any;
    const t = data.data;
    return text(`Transfer ${t?.id} [${t?.status}] - ${t?.amount} ${t?.currency}`);
  });

  // ── 9. get_transfer
  server.tool('get_transfer', 'Get a transfer by ID', {
    transfer_id: z.string().describe('Transfer ID'),
  }, async ({ transfer_id }) => {
    const data = await call('GET', `/flutterwave/v3/transfers/${transfer_id}`) as any;
    const t = data.data;
    return text(`Transfer ${t?.id} [${t?.status}] - ${t?.amount} ${t?.currency}`);
  });

  // ── 10. create_beneficiary
  server.tool('create_beneficiary', 'Create a transfer beneficiary', {
    account_number: z.string().describe('Account number'),
    account_bank: z.string().describe('Bank code'),
    beneficiary_name: z.string().describe('Beneficiary name'),
  }, async ({ account_number, account_bank, beneficiary_name }) => {
    const data = await call('POST', '/flutterwave/v3/beneficiaries', {
      account_number,
      account_bank,
      beneficiary_name,
    }) as any;
    const b = data.data;
    return text(`Beneficiary ${b?.id} created: ${b?.full_name}`);
  });

  // ── 11. create_payment_plan
  server.tool('create_payment_plan', 'Create a payment plan', {
    name: z.string().describe('Plan name'),
    amount: z.number().describe('Plan amount'),
    interval: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).describe('Billing interval'),
    currency: z.string().optional().describe('Currency (default NGN)'),
  }, async ({ name, amount, interval, currency }) => {
    const data = await call('POST', '/flutterwave/v3/payment-plans', {
      name,
      amount,
      interval,
      currency: currency || 'NGN',
    }) as any;
    const plan = data.data;
    return text(`Plan ${plan?.id} created: ${plan?.name} - ${plan?.amount} ${plan?.currency} (${plan?.interval})`);
  });

  // ── 12. cancel_payment_plan
  server.tool('cancel_payment_plan', 'Cancel a payment plan', {
    plan_id: z.string().describe('Payment plan ID'),
  }, async ({ plan_id }) => {
    const data = await call('PUT', `/flutterwave/v3/payment-plans/${plan_id}/cancel`) as any;
    const plan = data.data;
    return text(`Plan ${plan?.id} cancelled [${plan?.status}]`);
  });

  // ── 13. create_virtual_account
  server.tool('create_virtual_account', 'Create a virtual account number', {
    tx_ref: z.string().describe('Unique transaction reference'),
    amount: z.number().describe('Expected amount'),
    email: z.string().describe('Customer email'),
    currency: z.string().optional().describe('Currency (default NGN)'),
  }, async ({ tx_ref, amount, email, currency }) => {
    const data = await call('POST', '/flutterwave/v3/virtual-account-numbers', {
      tx_ref,
      amount,
      email,
      currency: currency || 'NGN',
    }) as any;
    const va = data.data;
    return text(`Virtual account created: ${va?.account_number} at ${va?.bank_name}`);
  });

  // ── 14. create_bill_payment
  server.tool('create_bill_payment', 'Create a bill payment (airtime, DSTV, electricity)', {
    customer: z.string().describe('Customer ID (phone number, smartcard, meter)'),
    amount: z.number().describe('Bill amount'),
    type: z.string().describe('Bill type (AIRTIME, DSTV, etc.)'),
    country: z.string().optional().describe('Country code'),
  }, async ({ customer, amount, type, country }) => {
    const data = await call('POST', '/flutterwave/v3/bills', {
      customer,
      amount,
      type,
      country: country || 'NG',
    }) as any;
    const bill = data.data;
    return text(`Bill payment [${bill?.status}]: ${bill?.type} - ${bill?.amount}`);
  });

  // ── 15. get_balances
  server.tool('get_balances', 'Get all wallet balances', {}, async () => {
    const data = await call('GET', '/flutterwave/v3/balances') as any;
    const balances = data.data || [];
    const lines = balances.map((b: any) => `  ${b.currency}: ${b.available_balance} (ledger: ${b.ledger_balance})`);
    return text(`Wallet Balances:\n${lines.join('\n')}`);
  });

  // ── 16. get_balance_by_currency
  server.tool('get_balance_by_currency', 'Get wallet balance for a specific currency', {
    currency: z.string().describe('Currency code (e.g. NGN, USD, KES)'),
  }, async ({ currency }) => {
    const data = await call('GET', `/flutterwave/v3/balances/${currency}`) as any;
    const bal = data.data;
    return text(`${bal?.currency}: Available ${bal?.available_balance}, Ledger ${bal?.ledger_balance}`);
  });

  // ── 17. list_banks
  server.tool('list_banks', 'List banks by country', {
    country_code: z.string().describe('Country code (e.g. NG, GH, KE, ZA)'),
  }, async ({ country_code }) => {
    const data = await call('GET', `/flutterwave/v3/banks/${country_code}`) as any;
    const banks = data.data || [];
    if (!banks.length) return text(`No banks found for ${country_code}`);
    const lines = banks.map((b: any) => `  ${b.code} - ${b.name}`);
    return text(`Banks in ${country_code} (${banks.length}):\n${lines.join('\n')}`);
  });

  // ── 18. calculate_fees
  server.tool('calculate_fees', 'Calculate transaction fees', {
    amount: z.number().describe('Transaction amount'),
    currency: z.string().optional().describe('Currency (default NGN)'),
  }, async ({ amount, currency }) => {
    const qp = new URLSearchParams();
    qp.set('amount', String(amount));
    if (currency) qp.set('currency', currency);
    const data = await call('GET', `/flutterwave/v3/transactions/fee?${qp.toString()}`) as any;
    const fee = data.data;
    return text(`Fee: ${fee?.fee} ${fee?.currency}, Total: ${fee?.charge_amount}`);
  });

  // ── 19. create_subaccount
  server.tool('create_subaccount', 'Create a subaccount for split payments', {
    account_bank: z.string().describe('Bank code'),
    account_number: z.string().describe('Account number'),
    business_name: z.string().describe('Business name'),
    split_value: z.number().describe('Split value (percentage or flat)'),
    split_type: z.enum(['percentage', 'flat']).optional().describe('Split type'),
  }, async ({ account_bank, account_number, business_name, split_value, split_type }) => {
    const data = await call('POST', '/flutterwave/v3/subaccounts', {
      account_bank,
      account_number,
      business_name,
      split_value,
      split_type: split_type || 'percentage',
    }) as any;
    const sub = data.data;
    return text(`Subaccount ${sub?.id} created: ${sub?.business_name} (${sub?.subaccount_id})`);
  });

  // ── 20. search_flutterwave_documentation
  server.tool('search_flutterwave_documentation', 'Search Flutterwave documentation', {
    query: z.string().describe('Topic to search'),
  }, async ({ query }) => {
    return text(
      `Flutterwave documentation search for "${query}":\n\n` +
      `This is a mock Mimic server. For real docs, visit https://developer.flutterwave.com\n\n` +
      `Payment Flow: Create Payment -> Customer pays -> Verify transaction\n\n` +
      `API Products:\n` +
      `  Payments: POST /v3/payments (hosted link) or /v3/charges (direct)\n` +
      `  Transactions: GET /v3/transactions + /verify\n` +
      `  Transfers: POST /v3/transfers (payouts)\n` +
      `  Payment Plans: /v3/payment-plans\n` +
      `  Subscriptions: /v3/subscriptions\n` +
      `  Virtual Accounts: /v3/virtual-account-numbers\n` +
      `  Bills: /v3/bills (airtime, DSTV, electricity)\n` +
      `  Settlements: /v3/settlements\n` +
      `  Chargebacks: /v3/chargebacks\n` +
      `  Banks: /v3/banks/:country_code\n`,
    );
  });
}

/**
 * Create a standalone Mimic MCP server for Flutterwave.
 */
export function createFlutterwaveMcpServer(
  baseUrl: string = 'http://localhost:4104',
): McpServer {
  const server = new McpServer({
    name: 'mimic-flutterwave',
    version: '0.7.0',
    description:
      'Mimic MCP server for Flutterwave — payments, charges, transfers, subscriptions, virtual accounts, bills against mock data',
  });
  registerFlutterwaveTools(server, baseUrl);
  return server;
}

/**
 * Start the Flutterwave MCP server on stdio transport.
 */
export async function startFlutterwaveMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4104';
  const server = createFlutterwaveMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic Flutterwave MCP server running on stdio');
}
