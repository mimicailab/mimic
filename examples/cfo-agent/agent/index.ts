import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env files — cfo-agent/.env first, then root .env for OPENAI_API_KEY
import { config } from 'dotenv';
config({ path: resolve(__dirname, '..', '.env') });
config({ path: resolve(__dirname, '..', '..', '..', '.env') });

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { HumanMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? '3003', 10);
const requestedModel = process.env.MODEL?.trim();
const MODEL = requestedModel
  ?? (process.env.ANTHROPIC_API_KEY ? 'claude-sonnet-4-6' : 'gpt-4o');
const EFFECTIVE_MODEL = MODEL === 'gpt-5-chat-latest' ? 'gpt-4o' : MODEL;

// MCP server endpoints — each platform has its own MCP server started by `mimic host`
const MCP_BASE_PORT = parseInt(process.env.MCP_BASE_PORT ?? '4201', 10);

const PLATFORMS = [
  { name: 'postgres',     description: 'Internal PostgreSQL database — users, events, usage_metrics, feature_flags. The product source of truth.' },
  { name: 'stripe',       description: 'Stripe billing — core web subscriptions (~£77k MRR, 61%). Starter/Pro/Enterprise plans. 1,200 customers.' },
  { name: 'paddle',       description: 'Paddle billing — EU and international customers (~£28k MRR, 22%). Strong German localisation.' },
  { name: 'chargebee',    description: 'Chargebee — enterprise invoicing and contract management (~£6k MRR, 5%). Check for overdue invoices.' },
  { name: 'gocardless',   description: 'GoCardless — UK SMB direct debit. Bank settlement has 2-day lag.' },
  { name: 'revenuecat',   description: 'RevenueCat — mobile app subscriptions (~£15k MRR, 12%). iOS and Android.' },
  { name: 'lemonsqueezy', description: 'Lemon Squeezy — individual developer and indie licenses. 534 license holders.' },
  { name: 'zuora',        description: 'Zuora — large enterprise usage-based contracts. 3 contracts.' },
  { name: 'recurly',      description: 'Recurly — legacy subscriber management. 47 long-term subscribers migrated from old platform.' },
] as const;

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const SUPERVISOR_PROMPT = `You are a CFO-grade financial assistant for Verida Analytics, a growth-stage SaaS company.

You coordinate 9 specialist sub-agents, each connected to a different data source via MCP:

${PLATFORMS.map((p, i) => `${i + 1}. **${p.name}**: ${p.description}`).join('\n')}

WORKFLOW:
- You CANNOT query data directly. Delegate to sub-agents using the query_* tools.
- For ANY question about revenue, MRR, subscriptions, customers, or billing you MUST query ALL 8 billing platforms (query_stripe, query_paddle, query_chargebee, query_gocardless, query_revenuecat, query_lemonsqueezy, query_zuora, query_recurly) in parallel. Also query query_postgres for product-side data.
- ALWAYS call all 9 query tools in parallel. Never call just one or two.
- Each query tool takes a "question" parameter — be specific about what data you need.
- Sub-agents return raw data. YOU synthesise, aggregate, and present the final answer.

CURRENCY — CRITICAL:
- All billing platform APIs return monetary amounts in PENCE (minor currency units).
- An "amount" of 7900 means £79.00. An "amount" of 2900 means £29.00.
- You MUST divide all API monetary values by 100 to convert to pounds.
- The PostgreSQL database stores mrr_cents — also divide by 100.

RESPONSE RULES:
- NEVER say "Let me check" or "Sure!" or any preamble. Go straight to the answer.
- NEVER narrate what you are about to do. Just do it silently, then present the result.
- NEVER ask follow-up questions or say "please reconfirm". You have the data — present it.
- Lead with the key number or insight. Context and breakdown come after.
- Use a clean table or bullet list for multi-platform comparisons.
- Currency is GBP (£). Always show values in pounds (e.g. £79.00 not 7900).
- Keep responses concise. A founder wants the number, not a paragraph about it.`;

function makeSubAgentPrompt(platform: typeof PLATFORMS[number]): string {
  return `You are a data specialist for the ${platform.name} platform.

${platform.description}

You have MCP tools to query this platform's data. When asked a question:
1. Use the available tools to get the data needed to answer the question.
2. Return the raw data and a brief summary. Be factual — no speculation.
3. Include all relevant numbers, IDs, dates, and statuses.
4. IMPORTANT: All monetary "amount" fields from billing APIs are in PENCE (minor units). 7900 = £79.00. Always convert to pounds in your summary (divide by 100).
5. When asked about MRR or revenue, sum up active subscription amounts, convert to pounds, and report the total.

If the question doesn't apply to your platform, say so briefly.`;
}

// ---------------------------------------------------------------------------
// AI SDK data stream helpers
// ---------------------------------------------------------------------------

function writeText(res: ServerResponse, text: string): void {
  res.write(`0:${JSON.stringify(text)}\n`);
}

function writeFinish(res: ServerResponse): void {
  res.write(
    `d:${JSON.stringify({ finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } })}\n`,
  );
}

type GraphMessage = {
  content?: unknown;
  role?: string;
  type?: string;
  tool_calls?: unknown[];
  additional_kwargs?: { tool_calls?: unknown[] };
  getType?: () => string;
  _getType?: () => string;
};

function getMessageRole(message: GraphMessage): string | undefined {
  if (typeof message._getType === 'function') return message._getType();
  if (typeof message.getType === 'function') return message.getType();
  if (typeof message.role === 'string') return message.role;
  if (typeof message.type === 'string') return message.type;
  return undefined;
}

function hasToolCalls(message: GraphMessage): boolean {
  return (
    (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) ||
    (Array.isArray(message.additional_kwargs?.tool_calls) &&
      message.additional_kwargs.tool_calls.length > 0)
  );
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (typeof part === 'object' && part && 'type' in part && part.type === 'text' && 'text' in part) {
        return typeof part.text === 'string' ? part.text : '';
      }
      return '';
    })
    .join('');
}

function getLatestFinalAssistantText(messages: unknown): string {
  if (!Array.isArray(messages)) return '';

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as GraphMessage;
    const role = getMessageRole(message);
    if ((role === 'ai' || role === 'assistant') && !hasToolCalls(message)) {
      return extractTextContent(message.content).trim();
    }
  }

  return '';
}

type TestToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

function extractToolCalls(messages: unknown): TestToolCall[] {
  if (!Array.isArray(messages)) return [];

  const toolCalls: TestToolCall[] = [];

  for (const message of messages as GraphMessage[]) {
    const rawCalls = Array.isArray(message.tool_calls)
      ? message.tool_calls
      : Array.isArray(message.additional_kwargs?.tool_calls)
        ? message.additional_kwargs.tool_calls
        : [];

    for (const call of rawCalls) {
      if (typeof call !== 'object' || call === null) continue;
      const toolCall = call as Record<string, unknown>;
      const name = typeof toolCall.name === 'string' ? toolCall.name : null;
      if (!name) continue;

      const args =
        typeof toolCall.args === 'object' && toolCall.args !== null
          ? (toolCall.args as Record<string, unknown>)
          : typeof toolCall.arguments === 'object' && toolCall.arguments !== null
            ? (toolCall.arguments as Record<string, unknown>)
            : {};

      toolCalls.push({ name, arguments: args });
    }
  }

  return toolCalls;
}

// ---------------------------------------------------------------------------
// Sub-agent factory
// ---------------------------------------------------------------------------

type SubAgent = ReturnType<typeof createReactAgent>;

function createChatModel(streaming = false) {
  if (EFFECTIVE_MODEL.startsWith('claude')) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(`Model "${EFFECTIVE_MODEL}" requires ANTHROPIC_API_KEY`);
    }

    return new ChatAnthropic({
      model: EFFECTIVE_MODEL,
      apiKey: process.env.ANTHROPIC_API_KEY,
      streaming,
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error(`Model "${EFFECTIVE_MODEL}" requires OPENAI_API_KEY`);
  }

  return new ChatOpenAI({
    model: EFFECTIVE_MODEL,
    apiKey: process.env.OPENAI_API_KEY,
    streaming,
  });
}

/** Filter to read-only tools suitable for a CFO agent (no create/update/delete). */
function isReadOnlyTool(name: string): boolean {
  const lower = name.toLowerCase();
  const readPrefixes = ['list', 'get', 'retrieve', 'search', 'fetch', 'query', 'preview'];
  return readPrefixes.some((p) => lower.startsWith(p) || lower.startsWith(`${p}_`));
}

async function createSubAgent(
  platform: typeof PLATFORMS[number],
  mcpPort: number,
): Promise<{ agent: SubAgent; client: MultiServerMCPClient }> {
  const client = new MultiServerMCPClient({
    [platform.name]: {
      transport: 'http',
      url: `http://localhost:${mcpPort}/mcp`,
    },
  });

  const allTools = await client.getTools();
  // For database, keep all tools. For adapters, filter to read-only.
  const tools = platform.name === 'postgres'
    ? allTools
    : allTools.filter((t) => isReadOnlyTool(t.name));
  console.log(`  ${platform.name}: ${tools.length} tools (${allTools.length} total) from MCP :${mcpPort}`);

  const llm = createChatModel();

  const agent = createReactAgent({
    llm,
    tools,
    messageModifier: makeSubAgentPrompt(platform),
  });

  return { agent, client };
}

// ---------------------------------------------------------------------------
// Supervisor setup
// ---------------------------------------------------------------------------

let supervisorAgent: SubAgent | null = null;
const subAgents = new Map<string, { agent: SubAgent; client: MultiServerMCPClient }>();

async function initAgents(): Promise<void> {
  console.log('Connecting to MCP servers...\n');

  // Create sub-agents — one per platform, each connected to its own MCP server
  for (let i = 0; i < PLATFORMS.length; i++) {
    const platform = PLATFORMS[i];
    const mcpPort = MCP_BASE_PORT + i;
    try {
      const sub = await createSubAgent(platform, mcpPort);
      subAgents.set(platform.name, sub);
    } catch (err) {
      console.error(`  Failed to connect to ${platform.name} on :${mcpPort}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n${subAgents.size}/${PLATFORMS.length} sub-agents connected.\n`);

  // Build supervisor dispatch tools — one per connected sub-agent
  const dispatchTools = [...subAgents.entries()].map(([name, { agent }]) => {
    const platform = PLATFORMS.find((p) => p.name === name)!;
    return tool(
      async ({ question }: { question: string }) => {
        try {
          const result = await agent.invoke({
            messages: [new HumanMessage(question)],
          });
          // Extract the last AI message content
          const lastMsg = result.messages[result.messages.length - 1];
          const content = typeof lastMsg.content === 'string'
            ? lastMsg.content
            : JSON.stringify(lastMsg.content);
          return content;
        } catch (err) {
          return `Error querying ${name}: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
      {
        name: `query_${name}`,
        description: `Query the ${name} platform. ${platform.description}`,
        schema: z.object({
          question: z.string().describe('The specific data question to ask this platform'),
        }),
      },
    );
  });

  console.log('Supervisor dispatch tools:');
  for (const t of dispatchTools) {
    console.log(`  - ${t.name}`);
  }

  const llm = createChatModel(true);

  supervisorAgent = createReactAgent({
    llm,
    tools: dispatchTools,
    messageModifier: SUPERVISOR_PROMPT,
  });

  console.log('\nSupervisor agent ready.');
}

// ---------------------------------------------------------------------------
// Stream agent response
// ---------------------------------------------------------------------------

async function streamChatResponse(
  res: ServerResponse,
  message: string,
): Promise<void> {
  if (!supervisorAgent) throw new Error('Agent not initialised');

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Vercel-AI-Data-Stream': 'v1',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  try {
    // Per the LangGraph JS docs, stream the compiled graph with
    // `streamMode: "values"` and read the assistant message from the
    // graph state snapshots rather than low-level model/token events.
    const stream = await supervisorAgent.stream(
      { messages: [new HumanMessage(message)] },
      { streamMode: 'values' },
    );

    let emittedText = '';

    for await (const state of stream) {
      const latestText = getLatestFinalAssistantText((state as { messages?: unknown }).messages);
      if (!latestText || latestText === emittedText) continue;

      const delta = latestText.startsWith(emittedText)
        ? latestText.slice(emittedText.length)
        : latestText;

      if (delta) {
        writeText(res, delta);
        emittedText = latestText;
      }
    }

    writeFinish(res);
    res.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Stream error:', msg);
    writeText(res, `\n\nError: ${msg}`);
    writeFinish(res);
    res.end();
  }
}

async function runChat(message: string): Promise<{ text: string; toolCalls: TestToolCall[] }> {
  if (!supervisorAgent) throw new Error('Agent not initialised');

  const stream = await supervisorAgent.stream(
    { messages: [new HumanMessage(message)] },
    { streamMode: 'values' },
  );

  let latestMessages: unknown = [];
  for await (const state of stream) {
    latestMessages = (state as { messages?: unknown }).messages ?? latestMessages;
  }

  return {
    text: getLatestFinalAssistantText(latestMessages),
    toolCalls: extractToolCalls(latestMessages),
  };
}

// ---------------------------------------------------------------------------
// HTTP server
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, {
      status: 'ok',
      model: EFFECTIVE_MODEL,
      platforms: subAgents.size,
      agents: [...subAgents.keys()],
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/chat') {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body);

      let message: string;
      if (typeof parsed.message === 'string') {
        message = parsed.message;
      } else if (Array.isArray(parsed.messages)) {
        const last = parsed.messages.findLast(
          (m: { role: string; content: string }) => m.role === 'user',
        );
        message = typeof last?.content === 'string' ? last.content : '';
      } else {
        json(res, 400, { error: 'Request body must include "message" string or "messages" array' });
        return;
      }

      if (!message) {
        json(res, 400, { error: 'No user message found' });
        return;
      }

      await streamChatResponse(res, message);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Chat error:', msg);
      json(res, 500, { error: msg });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/test') {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      const message = typeof parsed.message === 'string' ? parsed.message : '';

      if (!message) {
        json(res, 400, { error: 'Request body must include "message" string' });
        return;
      }

      const response = await runChat(message);
      json(res, 200, response);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Test error:', msg);
      json(res, 500, { error: msg });
    }
    return;
  }

  json(res, 404, { error: 'Not found. Available: GET /health, POST /chat, POST /test' });
});

// ---------------------------------------------------------------------------
// Startup & shutdown
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  console.log('=== CFO Multi-Agent System ===\n');
  if (MODEL !== EFFECTIVE_MODEL) {
    console.warn(
      `Model "${MODEL}" is not reliable for this agent setup; using "${EFFECTIVE_MODEL}" instead.`,
    );
  }
  await initAgents();

  server.listen(PORT, () => {
    console.log(`\nCFO agent running on http://localhost:${PORT}`);
    console.log(`Model: ${EFFECTIVE_MODEL}`);
    console.log('');
    console.log('Architecture: Supervisor + 9 sub-agents');
    console.log('  Supervisor → dispatches questions to platform specialists');
    console.log('  Sub-agents → each connected to its own MCP server');
    console.log('');
    console.log('Connected platforms:');
    for (const name of subAgents.keys()) {
      console.log(`  - ${name}`);
    }
    console.log('');
    console.log('Endpoints:');
    console.log('  GET  /health');
    console.log('  POST /chat   { "message": "..." }        (streaming)');
    console.log('  POST /chat   { "messages": [...] }       (streaming, useChat format)');
    console.log('  POST /test   { "message": "..." }        (json, mimic test)');
    console.log('');
    console.log('Demo questions:');
    console.log('  "What\'s our MRR right now?"');
    console.log('  "Give me the full picture for my investor meeting"');
    console.log('  "Are any customers paying for a plan they\'re not using?"');
    console.log('  "Give me an honest picture before the board meeting"');
    console.log('');
  });
}

async function shutdown(): Promise<void> {
  console.log('\nShutting down...');
  server.close();
  for (const { client } of subAgents.values()) {
    await client.close();
  }
  console.log('Done.');
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
