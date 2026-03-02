import { Agent, run, MCPServerStdio } from '@openai/agents';
import { anthropic } from '@ai-sdk/anthropic';
import { aisdk } from '@openai/agents-extensions/ai-sdk';
import { MongoClient, type Db, type Collection, type Document } from 'mongodb';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tool } from '@openai/agents';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? '3004', 10);
const MODEL = process.env.MODEL ?? 'claude-haiku-4-5';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://mimic:mimic@localhost:5432/mimic_fintech';

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://localhost:27017';

const MONGO_DB = process.env.MONGO_DB ?? 'mimic_fintech';

// ---------------------------------------------------------------------------
// MCP Server — PostgreSQL via `mimic host --transport stdio`
// ---------------------------------------------------------------------------

// Resolve the local CLI binary. Falls back to MIMIC_CLI env var if set.
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
// MongoDB — direct connection for document collections
// ---------------------------------------------------------------------------

let mongoClient: MongoClient;
let mongoDB: Db;

async function connectMongo(): Promise<void> {
  mongoClient = new MongoClient(MONGO_URL);
  await mongoClient.connect();
  mongoDB = mongoClient.db(MONGO_DB);
  console.log(`Connected to MongoDB: ${MONGO_DB}`);
}

// ---------------------------------------------------------------------------
// MongoDB tool definitions
// ---------------------------------------------------------------------------

const getActivityLog = tool({
  name: 'get_activity_log',
  description:
    'Query the activity_logs collection in MongoDB. Returns user activity events ' +
    'such as logins, page views, transfers, and settings changes. Supports ' +
    'filtering by user_id, action type, and date range.',
  parameters: z.object({
    user_id: z.number().optional().describe('Filter by user ID'),
    action: z
      .string()
      .optional()
      .describe('Filter by action type (e.g. "login", "transfer", "page_view", "settings_change")'),
    start_date: z
      .string()
      .optional()
      .describe('Start date for filtering (ISO 8601, e.g. "2025-01-01")'),
    end_date: z
      .string()
      .optional()
      .describe('End date for filtering (ISO 8601, e.g. "2025-06-30")'),
    limit: z
      .number()
      .optional()
      .default(50)
      .describe('Maximum number of results to return (default 50)'),
  }),
  execute: async (params) => {
    const collection: Collection<Document> = mongoDB.collection('activity_logs');
    const filter: Record<string, unknown> = {};

    if (params.user_id !== undefined) {
      filter.user_id = params.user_id;
    }
    if (params.action) {
      filter.action = params.action;
    }
    if (params.start_date || params.end_date) {
      const dateFilter: Record<string, Date> = {};
      if (params.start_date) dateFilter.$gte = new Date(params.start_date);
      if (params.end_date) dateFilter.$lte = new Date(params.end_date);
      filter.timestamp = dateFilter;
    }

    const results = await collection
      .find(filter)
      .sort({ timestamp: -1 })
      .limit(params.limit ?? 50)
      .toArray();

    return JSON.stringify(results, null, 2);
  },
});

const getUserPreferences = tool({
  name: 'get_user_preferences',
  description:
    'Get user preferences from MongoDB. Returns the preferences document for a ' +
    'given user, including notification settings, display preferences, default ' +
    'accounts, budget goals, and feature flags.',
  parameters: z.object({
    user_id: z.number().describe('The user ID to look up preferences for'),
  }),
  execute: async (params) => {
    const collection: Collection<Document> = mongoDB.collection('user_preferences');
    const doc = await collection.findOne({ user_id: params.user_id });

    if (!doc) {
      return JSON.stringify({ error: `No preferences found for user_id=${params.user_id}` });
    }

    return JSON.stringify(doc, null, 2);
  },
});

const getNotifications = tool({
  name: 'get_notifications',
  description:
    'List notifications from MongoDB. Returns notifications for a user, with ' +
    'optional filtering by read/unread status and notification type. Sorted by ' +
    'most recent first.',
  parameters: z.object({
    user_id: z.number().describe('The user ID to get notifications for'),
    unread_only: z
      .boolean()
      .optional()
      .default(false)
      .describe('If true, only return unread notifications'),
    type: z
      .string()
      .optional()
      .describe('Filter by notification type (e.g. "alert", "info", "warning", "promotion")'),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe('Maximum number of results to return (default 20)'),
  }),
  execute: async (params) => {
    const collection: Collection<Document> = mongoDB.collection('notifications');
    const filter: Record<string, unknown> = { user_id: params.user_id };

    if (params.unread_only) {
      filter.read = false;
    }
    if (params.type) {
      filter.type = params.type;
    }

    const results = await collection
      .find(filter)
      .sort({ created_at: -1 })
      .limit(params.limit ?? 20)
      .toArray();

    return JSON.stringify(results, null, 2);
  },
});

// ---------------------------------------------------------------------------
// Claude model via Vercel AI SDK adapter
// ---------------------------------------------------------------------------

const model = aisdk(anthropic(MODEL));

// ---------------------------------------------------------------------------
// Agent definition — combines MCP (PG) tools + MongoDB tools
// ---------------------------------------------------------------------------

const agent = new Agent({
  name: 'Fintech Multi-DB Assistant',
  instructions: [
    'You are a personal finance assistant for a banking platform.',
    'You have access to TWO databases:',
    '',
    '1. PostgreSQL (via MCP tools): Contains structured financial data including',
    '   users, accounts, and transactions. Use these tools for questions about',
    '   balances, spending, transaction history, and account details.',
    '',
    '2. MongoDB (via direct tools): Contains unstructured/semi-structured data',
    '   including activity_logs, user_preferences, and notifications. Use these',
    '   tools for questions about user activity, preferences, settings, and alerts.',
    '',
    'Choose the right tools based on what the user is asking about.',
    'Be precise with numbers and dates.',
    'When asked about spending, always use real data from the tools — never guess.',
    'Format currency amounts with $ and two decimal places.',
    'When asked about notifications or preferences, use the MongoDB tools.',
    'When asked about transactions or account balances, use the MCP/PostgreSQL tools.',
  ].join('\n'),
  model,
  mcpServers: [mcpServer],
  tools: [getActivityLog, getUserPreferences, getNotifications],
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
        databases: {
          postgres: 'connected (via MCP)',
          mongodb: 'connected (direct)',
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
  console.log('=== Fintech Multi-DB Agent ===\n');

  // Connect MongoDB
  console.log('Connecting to MongoDB...');
  await connectMongo();

  // Connect MCP (PostgreSQL)
  console.log('Connecting to Mimic MCP server (PostgreSQL)...');
  await mcpServer.connect();
  console.log('MCP server connected.\n');

  server.listen(PORT, () => {
    console.log(`Agent running on http://localhost:${PORT}`);
    console.log(`Model: ${MODEL}`);
    console.log('');
    console.log('Databases:');
    console.log(`  PostgreSQL: ${DATABASE_URL} (via MCP tools)`);
    console.log(`  MongoDB:    ${MONGO_URL}/${MONGO_DB} (direct tools)`);
    console.log('');
    console.log('Endpoints:');
    console.log(`  POST /chat   — Send { "message": "..." }`);
    console.log(`  GET  /health — Health check`);
    console.log('');
    console.log('MCP tools (PostgreSQL): auto-discovered from schema');
    console.log('MongoDB tools: get_activity_log, get_user_preferences, get_notifications');
    console.log('');
  });
}

async function shutdown(): Promise<void> {
  console.log('\nShutting down...');
  server.close();
  await mcpServer.close();
  await mongoClient.close();
  console.log('All connections closed.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start().catch((err) => {
  console.error('Failed to start agent:', err);
  process.exit(1);
});
