import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { streamText, stepCountIs, type ModelMessage } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { createMCPClient } from '@ai-sdk/mcp';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? '3002', 10);
const MODEL = process.env.MODEL ?? 'claude-haiku-4-5';
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://mimic:mimic@localhost:5433/mimic_billing';

// ---------------------------------------------------------------------------
// MCP Client — Mimic (Postgres + Stripe via unified `mimic host`)
// ---------------------------------------------------------------------------

// Resolve the local CLI binary. Falls back to MIMIC_CLI env var if set.
const MIMIC_CLI =
  process.env.MIMIC_CLI ??
  resolve(__dirname, '..', '..', '..', 'packages', 'cli', 'dist', 'bin', 'mimic.js');

// CWD for mimic host — the billing-agent root where mimic.json lives
const MIMIC_CWD = process.env.MIMIC_CWD ?? resolve(__dirname, '..');

let mimicMcp: Awaited<ReturnType<typeof createMCPClient>>;

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  'You are a SaaS billing assistant for a subscription management platform.',
  'You have access to tools provided via MCP that cover two domains:',
  '',
  '1. PostgreSQL database: Query customer records, subscriptions, invoices,',
  '   and payment history. Use get_* tools for data lookups and summaries.',
  '',
  '2. Stripe API: Create charges, issue refunds, manage subscriptions,',
  '   list invoices, and check account balances via create_*, list_*, etc.',
  '',
  'Guidelines:',
  '- Be precise with monetary amounts. Format currency as $X.XX (divide cents by 100).',
  '- Always use real data from tools — never guess amounts, dates, or statuses.',
  '- When a customer has a Stripe customer ID, use it for Stripe operations.',
  '- For billing questions, query the database first, then cross-reference with Stripe if needed.',
  '- If a question is ambiguous, ask for clarification before running queries.',
  '- Proactively flag past-due invoices or failed payments when reviewing customer accounts.',
  '- Format responses clearly with bullet points or tables where appropriate.',
].join('\n');

// ---------------------------------------------------------------------------
// HTTP server — POST /chat (streaming) + GET /health
// ---------------------------------------------------------------------------

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
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

  // GET /health
  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, {
      status: 'ok',
      datasources: { mimic: 'connected (via MCP)' },
    });
    return;
  }

  // POST /chat — streaming endpoint compatible with Vercel AI SDK useChat
  if (req.method === 'POST' && req.url === '/chat') {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body);

      // Accept either { messages } (useChat format) or { message } (simple format)
      let messages: ModelMessage[];
      if (parsed.messages && Array.isArray(parsed.messages)) {
        messages = parsed.messages;
      } else if (parsed.message && typeof parsed.message === 'string') {
        messages = [{ role: 'user', content: parsed.message }];
      } else {
        json(res, 400, { error: 'Request body must include "messages" array or "message" string' });
        return;
      }

      // All tools (PG + Stripe) come through the unified MCP server
      const tools = await mimicMcp.tools();

      const result = streamText({
        model: anthropic(MODEL),
        system: SYSTEM_PROMPT,
        messages,
        tools,
        stopWhen: stepCountIs(5),
      });

      result.pipeUIMessageStreamToResponse(res);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Chat error:', errorMessage);
      json(res, 500, { error: errorMessage });
    }
    return;
  }

  // 404
  json(res, 404, { error: 'Not found. Available endpoints: GET /health, POST /chat' });
});

// ---------------------------------------------------------------------------
// Startup & shutdown
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  console.log('=== Billing Agent ===\n');

  // Connect to Mimic via MCP (runs `mimic host` which starts PG MCP + mock APIs)
  console.log('Connecting to Mimic MCP server...');
  mimicMcp = await createMCPClient({
    transport: new StdioClientTransport({
      command: 'node',
      args: [MIMIC_CLI, 'host', '--transport', 'stdio'],
      cwd: MIMIC_CWD,
      env: {
        ...process.env as Record<string, string>,
        DATABASE_URL,
      },
    }),
  });
  const tools = await mimicMcp.tools();
  console.log(`Mimic MCP connected. Tools: ${Object.keys(tools).join(', ')}`);
  console.log('');

  server.listen(PORT, () => {
    console.log(`Billing agent running on http://localhost:${PORT}`);
    console.log(`Model: ${MODEL}`);
    console.log('');
    console.log('Data sources: all via MCP (mimic host)');
    console.log('');
    console.log('Endpoints:');
    console.log('  GET  /health');
    console.log('  POST /chat   { "messages": [...] }  (streaming, AI SDK data protocol)');
    console.log('  POST /chat   { "message": "..." }   (streaming, simple format)');
    console.log('');
  });
}

async function shutdown(): Promise<void> {
  console.log('\nShutting down...');
  server.close();
  await mimicMcp.close();
  console.log('All connections closed.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start().catch((err) => {
  console.error('Failed to start agent:', err);
  process.exit(1);
});
