import { Agent, run, MCPServerStdio } from '@openai/agents';
import { tool } from '@openai/agents';
import { anthropic } from '@ai-sdk/anthropic';
import { aisdk } from '@openai/agents-extensions/ai-sdk';
import pg from 'pg';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? '3012', 10);
const MODEL = process.env.MODEL ?? 'claude-haiku-4-5';
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://mimic:mimic@localhost:5435/mimic_payments';

const STRIPE_API_KEY = process.env.STRIPE_API_KEY ?? '';
const STRIPE_BASE_URL =
  process.env.STRIPE_BASE_URL ?? 'https://api.stripe.com/v1';

// ---------------------------------------------------------------------------
// PostgreSQL Connection Pool
// ---------------------------------------------------------------------------

const pool = new pg.Pool({ connectionString: DATABASE_URL });

// ---------------------------------------------------------------------------
// MCP Server (spawns `mimic host --transport stdio`)
// ---------------------------------------------------------------------------

// Resolve the local CLI binary — works whether running from the repo or after
// `npm link`. Falls back to MIMIC_CLI env var if set.
const MIMIC_CLI =
  process.env.MIMIC_CLI ??
  resolve(__dirname, '..', '..', '..', 'packages', 'cli', 'dist', 'bin', 'mimic.js');

const mcpServer = new MCPServerStdio({
  name: 'mimic',
  command: 'node',
  args: [MIMIC_CLI, 'host', '--transport', 'stdio'],
  env: {
    ...process.env as Record<string, string>,
    DATABASE_URL,
  },
  cwd: resolve(__dirname, '..'),
  cacheToolsList: true,
});

// ---------------------------------------------------------------------------
// Claude model via Vercel AI SDK adapter
// ---------------------------------------------------------------------------

const model = aisdk(anthropic(MODEL));

// ---------------------------------------------------------------------------
// Stripe HTTP helper
// ---------------------------------------------------------------------------

async function stripeRequest(
  method: string,
  path: string,
  body?: Record<string, string>,
): Promise<unknown> {
  const url = `${STRIPE_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${STRIPE_API_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  const init: RequestInit = { method, headers };
  if (body && (method === 'POST' || method === 'PUT')) {
    init.body = new URLSearchParams(body).toString();
  }

  const res = await fetch(url, init);
  return res.json();
}

// ---------------------------------------------------------------------------
// Tools — PostgreSQL direct queries for payment monitoring
// ---------------------------------------------------------------------------

const getPaymentSuccessRate = tool({
  name: 'get_payment_success_rate',
  description:
    'Get the payment success rate for a given date or date range from the daily_metrics table. ' +
    'Returns total charges, successful, failed, and the computed success rate percentage.',
  parameters: z.object({
    start_date: z
      .string()
      .describe('Start date (YYYY-MM-DD). Defaults to today if not provided.'),
    end_date: z
      .string()
      .optional()
      .describe('End date (YYYY-MM-DD). If omitted, only the start_date is queried.'),
  }),
  execute: async ({ start_date, end_date }) => {
    const query = end_date
      ? `SELECT
           SUM(total_charges) AS total_charges,
           SUM(successful) AS successful,
           SUM(failed) AS failed,
           SUM(refunded) AS refunded,
           SUM(revenue_cents) AS revenue_cents,
           ROUND(SUM(successful)::numeric / NULLIF(SUM(total_charges), 0) * 100, 2) AS success_rate
         FROM daily_metrics
         WHERE date >= $1 AND date <= $2`
      : `SELECT
           total_charges,
           successful,
           failed,
           refunded,
           revenue_cents,
           ROUND(successful::numeric / NULLIF(total_charges, 0) * 100, 2) AS success_rate
         FROM daily_metrics
         WHERE date = $1`;

    const params = end_date ? [start_date, end_date] : [start_date];
    const { rows } = await pool.query(query, params);

    if (rows.length === 0) {
      return JSON.stringify({ error: 'No metrics found for the specified date(s)' });
    }

    return JSON.stringify({ metrics: rows[0] });
  },
});

const getFailedCharges = tool({
  name: 'get_failed_charges',
  description:
    'List failed charges with failure reasons, customer info, and amounts. ' +
    'Useful for identifying patterns in payment failures and prioritising recovery.',
  parameters: z.object({
    since: z
      .string()
      .optional()
      .describe('Only return failures on or after this date (YYYY-MM-DD)'),
    failure_code: z
      .string()
      .optional()
      .describe('Filter by failure code (card_declined, expired_card, insufficient_funds)'),
    limit: z
      .number()
      .optional()
      .default(25)
      .describe('Maximum number of results to return'),
  }),
  execute: async ({ since, failure_code, limit }) => {
    const conditions: string[] = ["ch.status = 'failed'"];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (since) {
      conditions.push(`ch.created_at >= $${paramIdx}`);
      params.push(since);
      paramIdx++;
    }

    if (failure_code) {
      conditions.push(`ch.failure_code = $${paramIdx}`);
      params.push(failure_code);
      paramIdx++;
    }

    params.push(Math.min(limit ?? 25, 100));

    const sql = `
      SELECT
        ch.id,
        ch.amount_cents,
        ch.currency,
        ch.failure_code,
        ch.failure_message,
        ch.stripe_charge_id,
        ch.created_at,
        c.id AS customer_id,
        c.email,
        c.name AS customer_name,
        c.plan
      FROM charges ch
      JOIN customers c ON c.id = ch.customer_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY ch.created_at DESC
      LIMIT $${paramIdx}
    `;

    const { rows } = await pool.query(sql, params);
    return JSON.stringify({ failed_charges: rows, count: rows.length });
  },
});

const getMrrAndChurn = tool({
  name: 'get_mrr_and_churn',
  description:
    'Get current MRR (Monthly Recurring Revenue) and churn metrics. ' +
    'Computes active MRR from subscriptions, counts churned subscriptions in a period, ' +
    'and returns the churn rate.',
  parameters: z.object({
    period_start: z
      .string()
      .optional()
      .describe('Start of period for churn calculation (YYYY-MM-DD). Defaults to 30 days ago.'),
    period_end: z
      .string()
      .optional()
      .describe('End of period for churn calculation (YYYY-MM-DD). Defaults to today.'),
  }),
  execute: async ({ period_start, period_end }) => {
    // Active MRR
    const mrrResult = await pool.query(
      `SELECT
         COUNT(*) AS active_subscriptions,
         SUM(mrr_cents) AS active_mrr_cents
       FROM subscriptions
       WHERE status = 'active'`,
    );

    // Churned in period
    const churnResult = await pool.query(
      `SELECT
         COUNT(*) AS churned_subscriptions,
         SUM(mrr_cents) AS churned_mrr_cents
       FROM subscriptions
       WHERE status = 'canceled'
         AND canceled_at >= COALESCE($1::date, NOW() - INTERVAL '30 days')
         AND canceled_at <= COALESCE($2::date, NOW())`,
      [period_start ?? null, period_end ?? null],
    );

    // Total at start of period for rate calculation
    const totalResult = await pool.query(
      `SELECT COUNT(*) AS total_subscriptions
       FROM subscriptions
       WHERE created_at <= COALESCE($1::date, NOW() - INTERVAL '30 days')`,
      [period_start ?? null],
    );

    const active = mrrResult.rows[0];
    const churned = churnResult.rows[0];
    const total = parseInt(totalResult.rows[0]?.total_subscriptions ?? '0', 10);
    const churnedCount = parseInt(churned?.churned_subscriptions ?? '0', 10);
    const churnRate = total > 0 ? ((churnedCount / total) * 100).toFixed(2) : '0.00';

    return JSON.stringify({
      active_subscriptions: parseInt(active?.active_subscriptions ?? '0', 10),
      active_mrr_cents: parseInt(active?.active_mrr_cents ?? '0', 10),
      active_mrr_dollars: (parseInt(active?.active_mrr_cents ?? '0', 10) / 100).toFixed(2),
      churned_subscriptions: churnedCount,
      churned_mrr_cents: parseInt(churned?.churned_mrr_cents ?? '0', 10),
      churn_rate_percent: parseFloat(churnRate),
      period: {
        start: period_start ?? '30 days ago',
        end: period_end ?? 'today',
      },
    });
  },
});

const getAtRiskSubscriptions = tool({
  name: 'get_at_risk_subscriptions',
  description:
    'List subscriptions with past_due or unpaid status. These customers are at risk of churning ' +
    'and may need dunning or outreach.',
  parameters: z.object({
    status: z
      .enum(['past_due', 'unpaid'])
      .optional()
      .default('past_due')
      .describe('Subscription status to filter by'),
    limit: z
      .number()
      .optional()
      .default(25)
      .describe('Maximum number of results to return'),
  }),
  execute: async ({ status, limit }) => {
    const sql = `
      SELECT
        s.id AS subscription_id,
        s.plan,
        s.status,
        s.mrr_cents,
        s.interval,
        s.created_at AS subscribed_at,
        c.id AS customer_id,
        c.email,
        c.name AS customer_name,
        c.stripe_id
      FROM subscriptions s
      JOIN customers c ON c.id = s.customer_id
      WHERE s.status = $1
      ORDER BY s.mrr_cents DESC
      LIMIT $2
    `;

    const { rows } = await pool.query(sql, [status ?? 'past_due', Math.min(limit ?? 25, 100)]);
    return JSON.stringify({ at_risk: rows, count: rows.length });
  },
});

const getRevenueTimeline = tool({
  name: 'get_revenue_timeline',
  description:
    'Get daily revenue and charge metrics over a date range from the daily_metrics table. ' +
    'Useful for spotting trends, anomalies, and revenue trajectory.',
  parameters: z.object({
    start_date: z
      .string()
      .describe('Start date (YYYY-MM-DD)'),
    end_date: z
      .string()
      .describe('End date (YYYY-MM-DD)'),
  }),
  execute: async ({ start_date, end_date }) => {
    const sql = `
      SELECT
        date,
        total_charges,
        successful,
        failed,
        refunded,
        revenue_cents,
        new_subscribers,
        churned,
        active_mrr_cents
      FROM daily_metrics
      WHERE date >= $1 AND date <= $2
      ORDER BY date ASC
    `;

    const { rows } = await pool.query(sql, [start_date, end_date]);
    return JSON.stringify({ timeline: rows, days: rows.length });
  },
});

// ---------------------------------------------------------------------------
// Tools — Stripe HTTP (for live payment operations)
// ---------------------------------------------------------------------------

const retryFailedPayment = tool({
  name: 'retry_failed_payment',
  description:
    'Retry a failed payment via the Stripe API. Takes a Stripe charge ID and creates a new ' +
    'charge attempt for the same customer and amount.',
  parameters: z.object({
    stripe_charge_id: z
      .string()
      .describe('The Stripe charge ID to retry (e.g. ch_xxx)'),
  }),
  execute: async ({ stripe_charge_id }) => {
    if (!STRIPE_API_KEY) {
      return JSON.stringify({
        error: 'STRIPE_API_KEY not configured. Set the environment variable to enable Stripe operations.',
      });
    }

    // Retrieve the original charge to get customer and amount
    const charge = (await stripeRequest('GET', `/charges/${stripe_charge_id}`)) as Record<
      string,
      unknown
    >;

    if ((charge as Record<string, unknown>).error) {
      return JSON.stringify({ error: `Failed to retrieve charge: ${JSON.stringify(charge)}` });
    }

    // Create a new payment intent for the same customer/amount
    const result = await stripeRequest('POST', '/payment_intents', {
      amount: String(charge.amount),
      currency: String(charge.currency ?? 'usd'),
      customer: String(charge.customer),
      confirm: 'true',
      payment_method: String(charge.payment_method ?? ''),
    });

    return JSON.stringify({ retry_result: result });
  },
});

const issueRefund = tool({
  name: 'issue_refund',
  description:
    'Issue a full or partial refund for a Stripe charge. Returns the refund object.',
  parameters: z.object({
    stripe_charge_id: z
      .string()
      .describe('The Stripe charge ID to refund (e.g. ch_xxx)'),
    amount_cents: z
      .number()
      .optional()
      .describe('Amount to refund in cents. Omit for a full refund.'),
    reason: z
      .enum(['duplicate', 'fraudulent', 'requested_by_customer'])
      .optional()
      .describe('Reason for the refund'),
  }),
  execute: async ({ stripe_charge_id, amount_cents, reason }) => {
    if (!STRIPE_API_KEY) {
      return JSON.stringify({
        error: 'STRIPE_API_KEY not configured. Set the environment variable to enable Stripe operations.',
      });
    }

    const body: Record<string, string> = { charge: stripe_charge_id };
    if (amount_cents !== undefined) {
      body.amount = String(amount_cents);
    }
    if (reason) {
      body.reason = reason;
    }

    const result = await stripeRequest('POST', '/refunds', body);
    return JSON.stringify({ refund: result });
  },
});

const getStripeBalance = tool({
  name: 'get_stripe_balance',
  description:
    'Check the current Stripe account balance. Returns available and pending balances by currency.',
  parameters: z.object({}),
  execute: async () => {
    if (!STRIPE_API_KEY) {
      return JSON.stringify({
        error: 'STRIPE_API_KEY not configured. Set the environment variable to enable Stripe operations.',
      });
    }

    const result = await stripeRequest('GET', '/balance');
    return JSON.stringify({ balance: result });
  },
});

// ---------------------------------------------------------------------------
// Agent definition — combines MCP (database) tools + HTTP (Stripe) tools
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  'You are a payment operations monitoring agent for a SaaS platform.',
  'You have access to TWO types of tools:',
  '',
  '1. Database tools (PostgreSQL, direct + MCP): Query payment metrics, charges,',
  '   subscriptions, and daily aggregates. Use these for dashboarding, trend analysis,',
  '   failure investigation, and churn monitoring.',
  '',
  '2. Stripe API tools (HTTP): Perform live payment operations including retrying',
  '   failed charges, issuing refunds, and checking account balance.',
  '',
  'Your responsibilities:',
  '- Monitor payment health: success rates, failure patterns, revenue trends.',
  '- Detect anomalies: sudden spikes in failures, unusual churn, refund surges.',
  '- Provide actionable insights: which failure codes are most common, which',
  '  customers need outreach, what the MRR trajectory looks like.',
  '- Execute recovery actions: retry failed payments, issue refunds when requested.',
  '',
  'Be precise with numbers. Format currency amounts with $ and two decimal places.',
  'Always use real data from the tools — never guess or hallucinate metrics.',
  'When reporting rates, show both the raw numbers and the percentage.',
].join('\n');

const agent = new Agent({
  name: 'Payment Operations Monitor',
  instructions: SYSTEM_PROMPT,
  model,
  mcpServers: [mcpServer],
  tools: [
    getPaymentSuccessRate,
    getFailedCharges,
    getMrrAndChurn,
    getAtRiskSubscriptions,
    getRevenueTimeline,
    retryFailedPayment,
    issueRefund,
    getStripeBalance,
  ],
});

// ---------------------------------------------------------------------------
// Chat handler
// ---------------------------------------------------------------------------

async function handleChat(message: string): Promise<{
  text: string;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
}> {
  const result = await run(agent, message);

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

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

async function readBody(req: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }
  return body;
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
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
    try {
      await pool.query('SELECT 1');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', database: 'connected' }));
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', database: 'disconnected' }));
    }
    return;
  }

  // Chat endpoint
  if (req.method === 'POST' && req.url === '/chat') {
    try {
      const body = await readBody(req);
      const { message } = JSON.parse(body);

      if (!message || typeof message !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing "message" field (string)' }));
        return;
      }

      const result = await handleChat(message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('Chat error:', err);
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
// Startup & Shutdown
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  console.log('=== Payment Operations Monitor ===\n');

  // Verify database connectivity before starting
  try {
    await pool.query('SELECT 1');
    console.log('PostgreSQL connection verified.');
  } catch (err) {
    console.error('Failed to connect to PostgreSQL:', err);
    process.exit(1);
  }

  // Connect MCP server
  console.log('Connecting to Mimic MCP server...');
  await mcpServer.connect();
  console.log('MCP server connected.\n');

  server.listen(PORT, () => {
    console.log(`Agent running on http://localhost:${PORT}`);
    console.log(`Model: ${MODEL}`);
    console.log(`Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
    console.log(`Stripe: ${STRIPE_API_KEY ? 'configured' : 'not configured (set STRIPE_API_KEY)'}`);
    console.log('');
    console.log('Endpoints:');
    console.log(`  POST /chat   - Send { "message": "..." }`);
    console.log(`  GET  /health - Health check`);
    console.log('');
    console.log('Database tools: get_payment_success_rate, get_failed_charges,');
    console.log('  get_mrr_and_churn, get_at_risk_subscriptions, get_revenue_timeline');
    console.log('Stripe tools: retry_failed_payment, issue_refund, get_stripe_balance');
    console.log('MCP tools: auto-discovered from schema');
    console.log('');
  });
}

async function shutdown(): Promise<void> {
  console.log('\nShutting down...');
  server.close();
  await mcpServer.close();
  await pool.end();
  console.log('All connections closed.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start().catch((err) => {
  console.error('Failed to start agent:', err);
  process.exit(1);
});
