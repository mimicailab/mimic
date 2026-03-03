import { Agent, run, MCPServerStdio } from '@openai/agents';
import { anthropic } from '@ai-sdk/anthropic';
import { aisdk } from '@openai/agents-extensions/ai-sdk';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? '3011', 10);
const MODEL = process.env.MODEL ?? 'claude-haiku-4-5';
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://mimic:mimic@localhost:5434/mimic_budget';

// Toggle between MCP-based Plaid tools and HTTP-based Plaid tools.
// Set PLAID_MODE=http to use the HTTP approach instead of MCP.
const PLAID_MODE = process.env.PLAID_MODE ?? 'mcp';
const PLAID_BASE_URL = process.env.PLAID_BASE_URL ?? 'http://localhost:4100';

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
// HTTP-based Plaid tools (alternative to MCP)
// ---------------------------------------------------------------------------
// These tools call the Mimic HTTP server's Plaid endpoints directly.
// Used when PLAID_MODE=http. The MCP approach is preferred because it
// auto-discovers tools, but the HTTP approach is shown here as a reference.

async function plaidFetch(path: string, params?: Record<string, string>): Promise<unknown> {
  const url = new URL(path, PLAID_BASE_URL);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Plaid HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

const httpPlaidTools = {
  get_plaid_accounts: {
    name: 'get_plaid_accounts',
    description: 'Fetch linked bank accounts and balances from Plaid',
    parameters: {},
    async execute() {
      return JSON.stringify(await plaidFetch('/plaid/accounts'));
    },
  },
  get_plaid_transactions: {
    name: 'get_plaid_transactions',
    description:
      'Fetch recent bank transactions from Plaid. Optionally filter by start_date and end_date (YYYY-MM-DD).',
    parameters: {
      start_date: { type: 'string' as const, description: 'Start date (YYYY-MM-DD)' },
      end_date: { type: 'string' as const, description: 'End date (YYYY-MM-DD)' },
    },
    async execute(args: { start_date?: string; end_date?: string }) {
      const params: Record<string, string> = {};
      if (args.start_date) params.start_date = args.start_date;
      if (args.end_date) params.end_date = args.end_date;
      return JSON.stringify(await plaidFetch('/plaid/transactions', params));
    },
  },
  get_plaid_balance: {
    name: 'get_plaid_balance',
    description: 'Get real-time balance for a specific Plaid account',
    parameters: {
      account_id: { type: 'string' as const, description: 'Plaid account ID' },
    },
    async execute(args: { account_id: string }) {
      return JSON.stringify(
        await plaidFetch(`/plaid/accounts/${args.account_id}/balance`),
      );
    },
  },
};

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------

const systemPrompt = [
  'You are a personal budgeting assistant.',
  'You help users track spending, manage budgets, and reach savings goals.',
  '',
  'Capabilities:',
  '- Fetch bank accounts and balances (via Plaid)',
  '- Fetch recent transactions from linked bank accounts (via Plaid)',
  '- Query budget status per category from the database',
  '- Analyze spending patterns from stored transaction data',
  '- Check savings goal progress',
  '',
  'Guidelines:',
  '- Always use real data from the available tools — never guess or fabricate numbers.',
  '- Format currency amounts with $ and two decimal places (e.g. $1,234.56).',
  '- When comparing spending to budgets, clearly indicate if the user is over or under budget.',
  '- Be encouraging about savings progress and tactful about overspending.',
  '- When asked about spending patterns, group by category and sort by amount descending.',
  '- Use the Plaid tools for live bank data and the database tools for budget/goal tracking.',
].join('\n');

const agent = new Agent({
  name: 'Budget Assistant',
  instructions: systemPrompt,
  model,
  mcpServers: [mcpServer],
});

// ---------------------------------------------------------------------------
// HTTP server — POST /chat
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
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
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

  res.writeHead(404);
  res.end('Not found');
});

// ---------------------------------------------------------------------------
// Startup & shutdown
// ---------------------------------------------------------------------------

async function start() {
  console.log(`Plaid mode: ${PLAID_MODE}`);
  if (PLAID_MODE === 'http') {
    console.log(`Plaid HTTP base URL: ${PLAID_BASE_URL}`);
    console.log(
      'HTTP Plaid tools registered:',
      Object.keys(httpPlaidTools).join(', '),
    );
  }

  console.log('Connecting to Mimic MCP server...');
  await mcpServer.connect();
  console.log('MCP server connected.');

  server.listen(PORT, () => {
    console.log(`Budget assistant agent running on http://localhost:${PORT}`);
    console.log(`Model: ${MODEL}`);
    console.log('POST /chat with { "message": "..." }');
  });
}

async function shutdown() {
  console.log('\nShutting down...');
  server.close();
  await mcpServer.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start().catch((err) => {
  console.error('Failed to start agent:', err);
  process.exit(1);
});
