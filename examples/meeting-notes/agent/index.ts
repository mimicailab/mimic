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

const PORT = parseInt(process.env.PORT ?? '3013', 10);
const MODEL = process.env.MODEL ?? 'claude-haiku-4-5';
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://mimic:mimic@localhost:5436/mimic_meetings';

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? '';
const SLACK_BASE_URL =
  process.env.SLACK_BASE_URL ?? 'https://slack.com/api';

// ---------------------------------------------------------------------------
// Approach toggle — set AGENT_MODE=mcp to use MCP, default is "http" (manual tools)
// ---------------------------------------------------------------------------

const AGENT_MODE = (process.env.AGENT_MODE ?? 'http') as 'mcp' | 'http';

// ---------------------------------------------------------------------------
// PostgreSQL Connection Pool (used in HTTP mode)
// ---------------------------------------------------------------------------

const pool = new pg.Pool({ connectionString: DATABASE_URL });

// ---------------------------------------------------------------------------
// MCP Server (used in MCP mode) — spawns `mimic host --transport stdio`
// ---------------------------------------------------------------------------

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
// Slack helper — makes authenticated requests to the Slack Web API
// ---------------------------------------------------------------------------

async function slackAPI(method: string, body?: Record<string, unknown>): Promise<unknown> {
  const url = `${SLACK_BASE_URL}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// HTTP Tools — Postgres queries
// ---------------------------------------------------------------------------

const getRecentMeetings = tool({
  name: 'get_recent_meetings',
  description:
    'List recent meetings with their summaries. Optionally filter by type or status. ' +
    'Returns meetings ordered by date descending.',
  parameters: z.object({
    type: z
      .enum(['standup', 'sprint-planning', 'retro', 'sync', 'all-hands', 'design-review'])
      .optional()
      .describe('Filter by meeting type'),
    status: z
      .enum(['scheduled', 'in-progress', 'completed', 'cancelled'])
      .optional()
      .describe('Filter by meeting status'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Maximum number of meetings to return'),
  }),
  execute: async ({ type, status, limit }) => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 0;

    if (type) {
      paramIdx++;
      conditions.push(`m.type = $${paramIdx}`);
      params.push(type);
    }

    if (status) {
      paramIdx++;
      conditions.push(`m.status = $${paramIdx}`);
      params.push(status);
    }

    paramIdx++;
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        m.id,
        m.title,
        m.type,
        m.date,
        m.duration_mins,
        m.status,
        m.summary,
        m.slack_channel,
        COUNT(DISTINCT mp.id) AS participant_count,
        COUNT(DISTINCT ai.id) AS action_item_count,
        COUNT(DISTINCT d.id) AS decision_count
      FROM meetings m
      LEFT JOIN meeting_participants mp ON mp.meeting_id = m.id
      LEFT JOIN action_items ai ON ai.meeting_id = m.id
      LEFT JOIN decisions d ON d.meeting_id = m.id
      ${whereClause}
      GROUP BY m.id
      ORDER BY m.date DESC
      LIMIT $${paramIdx}
    `;
    params.push(Math.min(limit ?? 20, 100));

    const { rows } = await pool.query(sql, params);
    return JSON.stringify({ meetings: rows, count: rows.length });
  },
});

const searchActionItems = tool({
  name: 'search_action_items',
  description:
    'Search action items by status or assignee. Returns action items with their ' +
    'associated meeting title and assignee name.',
  parameters: z.object({
    status: z
      .enum(['open', 'in-progress', 'done', 'cancelled'])
      .optional()
      .describe('Filter by action item status'),
    assignee_id: z
      .number()
      .int()
      .optional()
      .describe('Filter by assignee team member ID'),
    query: z
      .string()
      .optional()
      .describe('Search keyword to match against action item description'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Maximum number of results to return'),
  }),
  execute: async ({ status, assignee_id, query, limit }) => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 0;

    if (status) {
      paramIdx++;
      conditions.push(`ai.status = $${paramIdx}`);
      params.push(status);
    }

    if (assignee_id !== undefined) {
      paramIdx++;
      conditions.push(`ai.assignee_id = $${paramIdx}`);
      params.push(assignee_id);
    }

    if (query) {
      paramIdx++;
      conditions.push(`ai.description ILIKE $${paramIdx}`);
      params.push(`%${query}%`);
    }

    paramIdx++;
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        ai.id,
        ai.description,
        ai.status,
        ai.due_date,
        ai.completed_at,
        ai.created_at,
        m.title AS meeting_title,
        m.type AS meeting_type,
        m.date AS meeting_date,
        tm.name AS assignee_name,
        tm.email AS assignee_email
      FROM action_items ai
      JOIN meetings m ON m.id = ai.meeting_id
      LEFT JOIN team_members tm ON tm.id = ai.assignee_id
      ${whereClause}
      ORDER BY ai.created_at DESC
      LIMIT $${paramIdx}
    `;
    params.push(Math.min(limit ?? 20, 100));

    const { rows } = await pool.query(sql, params);
    return JSON.stringify({ action_items: rows, count: rows.length });
  },
});

const getMeetingDecisions = tool({
  name: 'get_meeting_decisions',
  description:
    'Get decisions made in a specific meeting or across all meetings. ' +
    'Returns the decision description, context, and who decided.',
  parameters: z.object({
    meeting_id: z
      .number()
      .int()
      .optional()
      .describe('Get decisions for a specific meeting ID'),
    query: z
      .string()
      .optional()
      .describe('Search keyword to match against decision description or context'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Maximum number of results to return'),
  }),
  execute: async ({ meeting_id, query, limit }) => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 0;

    if (meeting_id !== undefined) {
      paramIdx++;
      conditions.push(`d.meeting_id = $${paramIdx}`);
      params.push(meeting_id);
    }

    if (query) {
      paramIdx++;
      conditions.push(`(d.description ILIKE $${paramIdx} OR d.context ILIKE $${paramIdx})`);
      params.push(`%${query}%`);
    }

    paramIdx++;
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        d.id,
        d.description,
        d.context,
        d.decided_by,
        d.created_at,
        m.title AS meeting_title,
        m.type AS meeting_type,
        m.date AS meeting_date
      FROM decisions d
      JOIN meetings m ON m.id = d.meeting_id
      ${whereClause}
      ORDER BY d.created_at DESC
      LIMIT $${paramIdx}
    `;
    params.push(Math.min(limit ?? 20, 100));

    const { rows } = await pool.query(sql, params);
    return JSON.stringify({ decisions: rows, count: rows.length });
  },
});

const getTeamMembers = tool({
  name: 'get_team_members',
  description:
    'Get team member information. Optionally filter by role. Returns member details ' +
    'including their total meeting participation and open action item counts.',
  parameters: z.object({
    role: z
      .enum(['engineer', 'designer', 'pm', 'engineering-manager'])
      .optional()
      .describe('Filter by team member role'),
    member_id: z
      .number()
      .int()
      .optional()
      .describe('Get a specific team member by ID'),
  }),
  execute: async ({ role, member_id }) => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 0;

    if (role) {
      paramIdx++;
      conditions.push(`tm.role = $${paramIdx}`);
      params.push(role);
    }

    if (member_id !== undefined) {
      paramIdx++;
      conditions.push(`tm.id = $${paramIdx}`);
      params.push(member_id);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        tm.id,
        tm.name,
        tm.email,
        tm.role,
        tm.slack_user_id,
        tm.created_at,
        COUNT(DISTINCT mp.id) AS meetings_attended,
        COUNT(DISTINCT ai.id) FILTER (WHERE ai.status IN ('open', 'in-progress')) AS open_action_items
      FROM team_members tm
      LEFT JOIN meeting_participants mp ON mp.member_id = tm.id AND mp.attended = true
      LEFT JOIN action_items ai ON ai.assignee_id = tm.id
      ${whereClause}
      GROUP BY tm.id
      ORDER BY tm.name ASC
    `;

    const { rows } = await pool.query(sql, params);

    if (member_id !== undefined && rows.length === 0) {
      return JSON.stringify({ error: `Team member with ID ${member_id} not found` });
    }

    return JSON.stringify(
      member_id !== undefined
        ? { member: rows[0] }
        : { members: rows, count: rows.length },
    );
  },
});

// ---------------------------------------------------------------------------
// HTTP Tools — Slack API
// ---------------------------------------------------------------------------

const listSlackChannels = tool({
  name: 'list_slack_channels',
  description:
    'List available Slack channels where meeting summaries can be posted. ' +
    'Returns channel name, ID, and member count.',
  parameters: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .describe('Maximum number of channels to return'),
  }),
  execute: async ({ limit }) => {
    const result = await slackAPI('conversations.list', {
      types: 'public_channel',
      exclude_archived: true,
      limit: Math.min(limit ?? 50, 200),
    });
    return JSON.stringify(result);
  },
});

const postMeetingSummary = tool({
  name: 'post_meeting_summary',
  description:
    'Post a meeting summary to a Slack channel. Composes a formatted message with ' +
    'the meeting title, summary, action items, and decisions, then posts it to the ' +
    'specified channel.',
  parameters: z.object({
    meeting_id: z
      .number()
      .int()
      .describe('The meeting ID to generate and post a summary for'),
    channel: z
      .string()
      .describe('Slack channel ID to post the summary to (e.g. "C0123456789")'),
  }),
  execute: async ({ meeting_id, channel }) => {
    // Fetch meeting details from the database
    const meetingResult = await pool.query(
      `SELECT id, title, type, date, duration_mins, status, summary
       FROM meetings WHERE id = $1`,
      [meeting_id],
    );

    if (meetingResult.rows.length === 0) {
      return JSON.stringify({ error: `Meeting #${meeting_id} not found` });
    }

    const meeting = meetingResult.rows[0];

    // Fetch action items
    const actionResult = await pool.query(
      `SELECT ai.description, ai.status, ai.due_date, tm.name AS assignee
       FROM action_items ai
       LEFT JOIN team_members tm ON tm.id = ai.assignee_id
       WHERE ai.meeting_id = $1
       ORDER BY ai.created_at ASC`,
      [meeting_id],
    );

    // Fetch decisions
    const decisionResult = await pool.query(
      `SELECT description, decided_by FROM decisions WHERE meeting_id = $1
       ORDER BY created_at ASC`,
      [meeting_id],
    );

    // Compose Slack message blocks
    const dateStr = new Date(meeting.date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const blocks: Record<string, unknown>[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${meeting.title}`, emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Type:* ${meeting.type} | *Date:* ${dateStr} | *Duration:* ${meeting.duration_mins} min`,
        },
      },
    ];

    if (meeting.summary) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Summary:*\n${meeting.summary}` },
      });
    }

    if (actionResult.rows.length > 0) {
      const items = actionResult.rows
        .map((ai: { description: string; assignee: string | null; status: string; due_date: string | null }) => {
          const assignee = ai.assignee ? ` (@${ai.assignee})` : '';
          const due = ai.due_date ? ` — due ${new Date(ai.due_date).toLocaleDateString()}` : '';
          return `- [${ai.status}] ${ai.description}${assignee}${due}`;
        })
        .join('\n');
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Action Items:*\n${items}` },
      });
    }

    if (decisionResult.rows.length > 0) {
      const items = decisionResult.rows
        .map((d: { description: string; decided_by: string | null }) => {
          const by = d.decided_by ? ` (decided by ${d.decided_by})` : '';
          return `- ${d.description}${by}`;
        })
        .join('\n');
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Decisions:*\n${items}` },
      });
    }

    // Post to Slack
    const slackResult = await slackAPI('chat.postMessage', {
      channel,
      text: `Meeting Summary: ${meeting.title}`,
      blocks,
    });

    // Update the meeting record with Slack info
    const slackData = slackResult as { ok?: boolean; ts?: string };
    if (slackData.ok && slackData.ts) {
      await pool.query(
        `UPDATE meetings SET slack_channel = $1, slack_thread_ts = $2 WHERE id = $3`,
        [channel, slackData.ts, meeting_id],
      );
    }

    return JSON.stringify(slackResult);
  },
});

const searchSlack = tool({
  name: 'search_slack',
  description:
    'Search Slack messages for previous discussions related to a topic. ' +
    'Useful for finding context before or after meetings.',
  parameters: z.object({
    query: z
      .string()
      .describe('Search query to find relevant Slack messages'),
    count: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Maximum number of results to return'),
  }),
  execute: async ({ query, count }) => {
    const result = await slackAPI('search.messages', {
      query,
      count: Math.min(count ?? 20, 100),
      sort: 'timestamp',
      sort_dir: 'desc',
    });
    return JSON.stringify(result);
  },
});

// ---------------------------------------------------------------------------
// All HTTP tools
// ---------------------------------------------------------------------------

const httpTools = [
  getRecentMeetings,
  searchActionItems,
  getMeetingDecisions,
  getTeamMembers,
  listSlackChannels,
  postMeetingSummary,
  searchSlack,
];

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  'You are a meeting notes assistant for a team collaboration platform.',
  'You help users review meetings, track action items, find decisions, and share summaries via Slack.',
  '',
  'Capabilities:',
  '- List and search recent meetings by type (standup, sprint-planning, retro, sync, all-hands, design-review) or status.',
  '- Search action items by status (open, in-progress, done) or assignee.',
  '- Look up decisions made across meetings.',
  '- Get team member information including meeting attendance and open action items.',
  '- Post formatted meeting summaries to Slack channels.',
  '- List available Slack channels.',
  '- Search Slack for previous discussions on a topic.',
  '',
  'Guidelines:',
  '- Always use real data from the tools — never guess or fabricate meeting content.',
  '- When listing action items, always include the status and assignee.',
  '- Format dates in a human-readable way.',
  '- When posting to Slack, confirm the channel and meeting details before posting.',
  '- If a question is ambiguous, ask for clarification.',
].join('\n');

// ---------------------------------------------------------------------------
// Agent definition (mode-dependent)
// ---------------------------------------------------------------------------

async function createAgent(): Promise<Agent> {
  if (AGENT_MODE === 'mcp') {
    // MCP approach: tools are auto-generated from the Mimic MCP server + Slack MCP
    return new Agent({
      name: 'Meeting Notes Assistant',
      instructions: SYSTEM_PROMPT,
      model,
      mcpServers: [mcpServer],
    });
  }

  // HTTP approach: manual tool definitions with direct Postgres + Slack fetch
  return new Agent({
    name: 'Meeting Notes Assistant',
    instructions: SYSTEM_PROMPT,
    model,
    tools: httpTools,
  });
}

// ---------------------------------------------------------------------------
// Chat handler
// ---------------------------------------------------------------------------

async function handleChat(
  agent: Agent,
  message: string,
): Promise<{
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
// HTTP helpers
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

// ---------------------------------------------------------------------------
// HTTP Server — POST /chat
// ---------------------------------------------------------------------------

function createHttpServer(agent: Agent) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
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
        json(res, 200, { status: 'ok', database: 'connected', mode: AGENT_MODE });
      } catch {
        json(res, 503, { status: 'error', database: 'disconnected', mode: AGENT_MODE });
      }
      return;
    }

    // Chat endpoint
    if (req.method === 'POST' && req.url === '/chat') {
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body);
        const message = parsed?.message;

        if (!message || typeof message !== 'string') {
          json(res, 400, { error: 'Request body must include a "message" string field' });
          return;
        }

        const result = await handleChat(agent, message);
        json(res, 200, result);
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
}

// ---------------------------------------------------------------------------
// Startup & Shutdown
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  // Verify database connectivity
  try {
    await pool.query('SELECT 1');
    console.log('PostgreSQL connection verified.');
  } catch (err) {
    console.error('Failed to connect to PostgreSQL:', err);
    process.exit(1);
  }

  // Connect MCP server if in MCP mode
  if (AGENT_MODE === 'mcp') {
    console.log('Connecting to Mimic MCP server...');
    await mcpServer.connect();
    console.log('MCP server connected.');
  }

  const agent = await createAgent();
  const server = createHttpServer(agent);

  server.listen(PORT, () => {
    console.log(`Meeting notes agent running on http://localhost:${PORT}`);
    console.log(`Mode: ${AGENT_MODE}`);
    console.log(`Model: ${MODEL}`);
    console.log(`Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
    if (SLACK_BOT_TOKEN) {
      console.log('Slack: connected');
    } else {
      console.log('Slack: no SLACK_BOT_TOKEN set (Slack tools will fail)');
    }
    console.log('');
    console.log('Endpoints:');
    console.log('  GET  /health');
    console.log('  POST /chat   { "message": "..." }');
  });

  async function shutdown(): Promise<void> {
    console.log('\nShutting down...');
    server.close();
    await pool.end();
    console.log('PostgreSQL pool closed.');
    if (AGENT_MODE === 'mcp') {
      await mcpServer.close();
      console.log('MCP server closed.');
    }
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  console.error('Failed to start agent:', err);
  process.exit(1);
});
