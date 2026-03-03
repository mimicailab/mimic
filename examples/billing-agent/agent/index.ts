import { Agent, run, MCPServerStdio } from '@openai/agents';
import { tool } from '@openai/agents';
import { anthropic } from '@ai-sdk/anthropic';
import { aisdk } from '@openai/agents-extensions/ai-sdk';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? '3010', 10);
const MODEL = process.env.MODEL ?? 'claude-haiku-4-5';
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://mimic:mimic@localhost:5433/mimic_billing';

const STRIPE_API_URL =
  process.env.STRIPE_API_URL ?? 'http://localhost:12111';

// Toggle between MCP-only (default) and HTTP tools for Stripe.
// Set USE_HTTP_STRIPE=true to use direct fetch() calls instead of Stripe MCP.
const USE_HTTP_STRIPE = process.env.USE_HTTP_STRIPE === 'true';

// ---------------------------------------------------------------------------
// MCP Server — Mimic (Postgres via `mimic host --transport stdio`)
// ---------------------------------------------------------------------------

// Resolve the local CLI binary. Falls back to MIMIC_CLI env var if set.
const MIMIC_CLI =
  process.env.MIMIC_CLI ??
  resolve(__dirname, '..', '..', '..', 'packages', 'cli', 'dist', 'bin', 'mimic.js');

const mimicMcpServer = new MCPServerStdio({
  name: 'mimic',
  command: 'node',
  args: [MIMIC_CLI, 'host', '--transport', 'stdio', '--no-api'],
  env: {
    ...process.env as Record<string, string>,
    DATABASE_URL,
  },
  cwd: resolve(__dirname, '..'),
  cacheToolsList: true,
});

// ---------------------------------------------------------------------------
// MCP Server — Stripe (optional, used when USE_HTTP_STRIPE is false)
// ---------------------------------------------------------------------------

// When Stripe MCP is enabled, we spawn the Mimic Stripe MCP server alongside
// the Mimic Postgres MCP server. Both talk to the same mock environment.
const STRIPE_MCP_BIN =
  process.env.STRIPE_MCP_BIN ??
  resolve(__dirname, '..', '..', '..', 'packages', 'adapters', 'adapter-stripe', 'dist', 'bin', 'mcp.js');

const stripeMcpServer = !USE_HTTP_STRIPE
  ? new MCPServerStdio({
      name: 'stripe',
      command: 'node',
      args: [STRIPE_MCP_BIN],
      env: {
        ...process.env as Record<string, string>,
        MIMIC_BASE_URL: STRIPE_API_URL.replace(/\/stripe$/, '') || 'http://localhost:4100',
      },
      cacheToolsList: true,
    })
  : null;

// ---------------------------------------------------------------------------
// HTTP-based Stripe tools (alternative to MCP, toggled via USE_HTTP_STRIPE)
// ---------------------------------------------------------------------------
// These tools call the Stripe mock API directly via fetch(). Use this approach
// when you want fine-grained control over the Stripe interactions or when the
// Stripe MCP server is not available.

const stripeCreateCharge = tool({
  name: 'stripe_create_charge',
  description:
    'Create a charge against a customer via the Stripe mock API. ' +
    'Charges are in the smallest currency unit (cents for USD).',
  parameters: z.object({
    customer_id: z
      .string()
      .describe('The Stripe customer ID (e.g. "cus_xxx")'),
    amount: z
      .number()
      .describe('Amount in cents (e.g. 2999 for $29.99)'),
    currency: z
      .string()
      .optional()
      .default('usd')
      .describe('Three-letter ISO currency code (default: usd)'),
    description: z
      .string()
      .optional()
      .describe('An arbitrary string attached to the charge'),
  }),
  execute: async ({ customer_id, amount, currency, description }) => {
    const params = new URLSearchParams({
      customer: customer_id,
      amount: String(amount),
      currency: currency ?? 'usd',
    });
    if (description) params.set('description', description);

    const res = await fetch(`${STRIPE_API_URL}/v1/charges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    return JSON.stringify(await res.json());
  },
});

const stripeCreateRefund = tool({
  name: 'stripe_create_refund',
  description:
    'Refund a charge (fully or partially) via the Stripe mock API.',
  parameters: z.object({
    charge_id: z
      .string()
      .describe('The Stripe charge ID to refund (e.g. "ch_xxx")'),
    amount: z
      .number()
      .optional()
      .describe('Amount in cents to refund. Omit for a full refund.'),
    reason: z
      .enum(['duplicate', 'fraudulent', 'requested_by_customer'])
      .optional()
      .describe('Reason for the refund'),
  }),
  execute: async ({ charge_id, amount, reason }) => {
    const params = new URLSearchParams({ charge: charge_id });
    if (amount !== undefined) params.set('amount', String(amount));
    if (reason) params.set('reason', reason);

    const res = await fetch(`${STRIPE_API_URL}/v1/refunds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    return JSON.stringify(await res.json());
  },
});

const stripeGetCustomer = tool({
  name: 'stripe_get_customer',
  description:
    'Retrieve a customer object from the Stripe mock API by their Stripe customer ID.',
  parameters: z.object({
    customer_id: z
      .string()
      .describe('The Stripe customer ID (e.g. "cus_xxx")'),
  }),
  execute: async ({ customer_id }) => {
    const res = await fetch(
      `${STRIPE_API_URL}/v1/customers/${customer_id}`,
    );

    return JSON.stringify(await res.json());
  },
});

const stripeListSubscriptions = tool({
  name: 'stripe_list_subscriptions',
  description:
    'List subscriptions for a customer from the Stripe mock API.',
  parameters: z.object({
    customer_id: z
      .string()
      .describe('The Stripe customer ID to list subscriptions for'),
    status: z
      .enum(['active', 'past_due', 'canceled', 'trialing', 'all'])
      .optional()
      .default('all')
      .describe('Filter by subscription status (default: all)'),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe('Maximum number of subscriptions to return'),
  }),
  execute: async ({ customer_id, status, limit }) => {
    const params = new URLSearchParams({
      customer: customer_id,
      limit: String(limit ?? 10),
    });
    if (status && status !== 'all') params.set('status', status);

    const res = await fetch(
      `${STRIPE_API_URL}/v1/subscriptions?${params.toString()}`,
    );

    return JSON.stringify(await res.json());
  },
});

const stripeGetBalance = tool({
  name: 'stripe_get_balance',
  description:
    'Retrieve the current account balance from the Stripe mock API. ' +
    'Shows available and pending balances by currency.',
  parameters: z.object({}),
  execute: async () => {
    const res = await fetch(`${STRIPE_API_URL}/v1/balance`);
    return JSON.stringify(await res.json());
  },
});

const stripeListInvoices = tool({
  name: 'stripe_list_invoices',
  description:
    'List invoices for a customer from the Stripe mock API.',
  parameters: z.object({
    customer_id: z
      .string()
      .describe('The Stripe customer ID to list invoices for'),
    status: z
      .enum(['draft', 'open', 'paid', 'void', 'uncollectible'])
      .optional()
      .describe('Filter by invoice status'),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe('Maximum number of invoices to return'),
  }),
  execute: async ({ customer_id, status, limit }) => {
    const params = new URLSearchParams({
      customer: customer_id,
      limit: String(limit ?? 10),
    });
    if (status) params.set('status', status);

    const res = await fetch(
      `${STRIPE_API_URL}/v1/invoices?${params.toString()}`,
    );

    return JSON.stringify(await res.json());
  },
});

// Collect all HTTP-based Stripe tools
const httpStripeTools = [
  stripeCreateCharge,
  stripeCreateRefund,
  stripeGetCustomer,
  stripeListSubscriptions,
  stripeGetBalance,
  stripeListInvoices,
];

// ---------------------------------------------------------------------------
// Claude model via Vercel AI SDK adapter
// ---------------------------------------------------------------------------

const model = aisdk(anthropic(MODEL));

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  'You are a SaaS billing assistant for a subscription management platform.',
  'You have access to TWO data sources:',
  '',
  '1. PostgreSQL (via MCP tools): Contains customer records, subscriptions,',
  '   invoices, and payment history. Use these tools for questions about',
  '   customer data, subscription status, billing history, and revenue metrics.',
  '',
  '2. Stripe API (via MCP or HTTP tools): Manages live payment operations',
  '   including creating charges, issuing refunds, managing subscriptions,',
  '   and checking account balances.',
  '',
  'Capabilities:',
  '- Look up customers by name, email, or ID and show their subscription details',
  '- Check payment history and invoice status for any customer',
  '- Create charges for one-time payments or overages',
  '- Issue full or partial refunds on existing charges',
  '- List and manage customer subscriptions',
  '- Check account balance and revenue metrics',
  '',
  'Guidelines:',
  '- Be precise with monetary amounts. Format currency as $X.XX (divide cents by 100).',
  '- Always use real data from tools — never guess amounts, dates, or statuses.',
  '- When a customer has a Stripe customer ID, use it for Stripe operations.',
  '- For billing questions, query the database first, then cross-reference with Stripe if needed.',
  '- If a question is ambiguous, ask for clarification before running queries.',
  '- Proactively flag past-due invoices or failed payments when reviewing customer accounts.',
].join('\n');

// ---------------------------------------------------------------------------
// Agent definition — combines MCP (PG + Stripe) tools or MCP (PG) + HTTP tools
// ---------------------------------------------------------------------------

const mcpServers = [mimicMcpServer];
if (stripeMcpServer) {
  mcpServers.push(stripeMcpServer);
}

const agent = new Agent({
  name: 'Billing Assistant',
  instructions: SYSTEM_PROMPT,
  model,
  mcpServers,
  // When USE_HTTP_STRIPE is true, attach HTTP-based Stripe tools directly.
  // Otherwise, Stripe tools are auto-discovered via the Stripe MCP server.
  tools: USE_HTTP_STRIPE ? httpStripeTools : [],
});

// ---------------------------------------------------------------------------
// HTTP server — POST /chat + GET /health
// ---------------------------------------------------------------------------

async function handleChat(message: string): Promise<{
  text: string;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
}> {
  const result = await run(agent, message);

  // Extract tool calls from the run result's new items
  const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  for (const item of result.newItems) {
    if (item.type === 'tool_call_item') {
      toolCalls.push({
        name: item.rawItem.name ?? '',
        arguments:
          typeof item.rawItem.arguments === 'string'
            ? JSON.parse(item.rawItem.arguments)
            : (item.rawItem.arguments as Record<string, unknown>) ?? {},
      });
    }
  }

  return {
    text: result.finalOutput ?? '',
    toolCalls,
  };
}

const server = createServer(async (req, res) => {
  // CORS headers for local development
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        datasources: {
          postgres: 'connected (via MCP)',
          stripe: USE_HTTP_STRIPE ? 'connected (HTTP)' : 'connected (via MCP)',
        },
      }),
    );
    return;
  }

  // Chat endpoint
  if (req.method === 'POST' && req.url === '/chat') {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    try {
      const { message } = JSON.parse(body);
      if (!message || typeof message !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing "message" field' }));
        return;
      }

      const result = await handleChat(message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ---------------------------------------------------------------------------
// Startup & shutdown
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  console.log('=== Billing Agent ===\n');

  // Connect Mimic MCP (PostgreSQL)
  console.log('Connecting to Mimic MCP server (PostgreSQL)...');
  await mimicMcpServer.connect();
  console.log('Mimic MCP server connected.');

  // Connect Stripe MCP (if not using HTTP mode)
  if (stripeMcpServer) {
    console.log('Connecting to Stripe MCP server...');
    await stripeMcpServer.connect();
    console.log('Stripe MCP server connected.');
  }

  console.log('');

  server.listen(PORT, () => {
    console.log(`Billing agent running on http://localhost:${PORT}`);
    console.log(`Model: ${MODEL}`);
    console.log('');
    console.log('Data sources:');
    console.log(`  PostgreSQL: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')} (via MCP tools)`);
    if (USE_HTTP_STRIPE) {
      console.log(`  Stripe:     ${STRIPE_API_URL} (HTTP tools)`);
    } else {
      console.log(`  Stripe:     via MCP server (auto-discovered tools)`);
    }
    console.log('');
    console.log('Endpoints:');
    console.log(`  POST /chat   — Send { "message": "..." }`);
    console.log(`  GET  /health — Health check`);
    console.log('');
    console.log('MCP tools (PostgreSQL): auto-discovered from schema');
    if (USE_HTTP_STRIPE) {
      console.log(
        'Stripe tools (HTTP): stripe_create_charge, stripe_create_refund, ' +
        'stripe_get_customer, stripe_list_subscriptions, stripe_get_balance, ' +
        'stripe_list_invoices',
      );
    } else {
      console.log('Stripe tools (MCP): auto-discovered from Stripe MCP server');
    }
    console.log('');
    console.log('Toggle Stripe mode: USE_HTTP_STRIPE=true for HTTP tools, unset for MCP');
    console.log('');
  });
}

async function shutdown(): Promise<void> {
  console.log('\nShutting down...');
  server.close();
  await mimicMcpServer.close();
  if (stripeMcpServer) {
    await stripeMcpServer.close();
  }
  console.log('All connections closed.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start().catch((err) => {
  console.error('Failed to start agent:', err);
  process.exit(1);
});
