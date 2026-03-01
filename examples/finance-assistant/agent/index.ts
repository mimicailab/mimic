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
// Agent definition
// ---------------------------------------------------------------------------

const agent = new Agent({
  name: 'Finance Assistant',
  instructions: [
    'You are a helpful personal finance assistant.',
    'Use the available tools to answer questions about the user\'s financial data.',
    'Be precise with numbers and dates.',
    'When asked about spending, always use real data from the tools — never guess.',
    'Format currency amounts with $ and two decimal places.',
  ].join(' '),
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
  console.log('Connecting to Mimic MCP server...');
  await mcpServer.connect();
  console.log('MCP server connected.');

  server.listen(PORT, () => {
    console.log(`Finance assistant agent running on http://localhost:${PORT}`);
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
