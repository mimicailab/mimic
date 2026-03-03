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

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const MODEL = process.env.MODEL ?? 'claude-haiku-4-5';
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://mimic:mimic@localhost:5432/mimic_finance';
const PLAID_API_URL =
  process.env.PLAID_API_URL ?? 'http://localhost:4100';

// ---------------------------------------------------------------------------
// MCP Server — Mimic (Postgres via `mimic host --transport stdio`)
// ---------------------------------------------------------------------------

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
// MCP Server — Plaid (via Mimic Plaid MCP server)
// ---------------------------------------------------------------------------

const PLAID_MCP_BIN =
  process.env.PLAID_MCP_BIN ??
  resolve(__dirname, '..', '..', '..', 'packages', 'adapters', 'adapter-plaid', 'dist', 'bin', 'mcp.js');

const plaidMcpServer = new MCPServerStdio({
  name: 'plaid',
  command: 'node',
  args: [PLAID_MCP_BIN],
  env: {
    ...process.env as Record<string, string>,
    MIMIC_BASE_URL: PLAID_API_URL,
  },
  cacheToolsList: true,
});

// ---------------------------------------------------------------------------
// Claude model via Vercel AI SDK adapter
// ---------------------------------------------------------------------------

const model = aisdk(anthropic(MODEL));

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------

const agent = new Agent({
  name: 'Finance Assistant',
  instructions: [
    'You are a helpful personal finance assistant.',
    'You have access to TWO data sources:',
    '',
    '1. PostgreSQL (via MCP tools prefixed get_): Contains user records, accounts,',
    '   transactions with categories, and financial history.',
    '',
    '2. Plaid API (via MCP tools like get_accounts, get_transactions, get_balances):',
    '   Provides real-time bank account data, transaction feeds, and identity info.',
    '   Use access token format: access-{persona-name}-token for Plaid calls.',
    '',
    'Use both sources to give comprehensive answers.',
    'Be precise with numbers and dates.',
    'When asked about spending, always use real data from the tools — never guess.',
    'Format currency amounts with $ and two decimal places.',
  ].join('\n'),
  model,
  mcpServers: [mimicMcpServer, plaidMcpServer],
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
  console.log('=== Finance Assistant ===\n');

  console.log('Connecting to Mimic MCP server (PostgreSQL)...');
  await mimicMcpServer.connect();
  console.log('Mimic MCP server connected.');

  console.log('Connecting to Plaid MCP server...');
  await plaidMcpServer.connect();
  console.log('Plaid MCP server connected.\n');

  server.listen(PORT, () => {
    console.log(`Finance assistant running on http://localhost:${PORT}`);
    console.log(`Model: ${MODEL}`);
    console.log('');
    console.log('Data sources:');
    console.log(`  PostgreSQL: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')} (via MCP)`);
    console.log(`  Plaid:      ${PLAID_API_URL} (via MCP)`);
    console.log('');
    console.log('POST /chat with { "message": "..." }');
    console.log('');
  });
}

async function shutdown() {
  console.log('\nShutting down...');
  server.close();
  await mimicMcpServer.close();
  await plaidMcpServer.close();
  console.log('All connections closed.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start().catch((err) => {
  console.error('Failed to start agent:', err);
  process.exit(1);
});
