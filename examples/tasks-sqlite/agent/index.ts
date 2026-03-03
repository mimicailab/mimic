import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent, run } from '@openai/agents';
import { tool } from '@openai/agents';
import { anthropic } from '@ai-sdk/anthropic';
import { aisdk } from '@openai/agents-extensions/ai-sdk';
import Database from 'better-sqlite3';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? '3002', 10);
const MODEL = process.env.MODEL ?? 'claude-haiku-4-5';
const DB_PATH = process.env.DB_PATH ?? resolve(__dirname, '..', 'tasks.db');

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const db = new Database(DB_PATH, { readonly: true });
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log(`SQLite database opened: ${DB_PATH}`);

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------

const stmtListProjects = db.prepare(`
  SELECT
    p.id,
    p.name,
    p.description,
    p.status,
    p.created_at,
    p.updated_at,
    COUNT(t.id) AS task_count
  FROM projects p
  LEFT JOIN tasks t ON t.project_id = p.id
  GROUP BY p.id
  ORDER BY p.created_at DESC
`);

const stmtListProjectsByStatus = db.prepare(`
  SELECT
    p.id,
    p.name,
    p.description,
    p.status,
    p.created_at,
    p.updated_at,
    COUNT(t.id) AS task_count
  FROM projects p
  LEFT JOIN tasks t ON t.project_id = p.id
  WHERE p.status = ?
  GROUP BY p.id
  ORDER BY p.created_at DESC
`);

const stmtSearchTasks = db.prepare(`
  SELECT
    t.id,
    t.title,
    t.status,
    t.priority,
    t.assignee,
    t.due_date,
    p.name AS project_name
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  WHERE t.title LIKE ? OR t.description LIKE ?
  ORDER BY t.created_at DESC
  LIMIT ?
`);

const stmtSearchTasksByStatus = db.prepare(`
  SELECT
    t.id,
    t.title,
    t.status,
    t.priority,
    t.assignee,
    t.due_date,
    p.name AS project_name
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  WHERE (t.title LIKE ? OR t.description LIKE ?) AND t.status = ?
  ORDER BY t.created_at DESC
  LIMIT ?
`);

const stmtSearchTasksByPriority = db.prepare(`
  SELECT
    t.id,
    t.title,
    t.status,
    t.priority,
    t.assignee,
    t.due_date,
    p.name AS project_name
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  WHERE (t.title LIKE ? OR t.description LIKE ?) AND t.priority = ?
  ORDER BY t.created_at DESC
  LIMIT ?
`);

const stmtSearchTasksByStatusAndPriority = db.prepare(`
  SELECT
    t.id,
    t.title,
    t.status,
    t.priority,
    t.assignee,
    t.due_date,
    p.name AS project_name
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  WHERE (t.title LIKE ? OR t.description LIKE ?) AND t.status = ? AND t.priority = ?
  ORDER BY t.created_at DESC
  LIMIT ?
`);

const stmtGetTaskDetails = db.prepare(`
  SELECT
    t.*,
    p.name AS project_name,
    GROUP_CONCAT(l.name) AS labels
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  LEFT JOIN task_labels tl ON tl.task_id = t.id
  LEFT JOIN labels l ON l.id = tl.label_id
  WHERE t.id = ?
  GROUP BY t.id
`);

const stmtGetProjectTasks = db.prepare(`
  SELECT
    t.id,
    t.title,
    t.status,
    t.priority,
    t.assignee,
    t.due_date,
    t.estimated_hours,
    t.actual_hours
  FROM tasks t
  WHERE t.project_id = ?
  ORDER BY
    CASE t.priority
      WHEN 'urgent' THEN 0
      WHEN 'high'   THEN 1
      WHEN 'medium' THEN 2
      WHEN 'low'    THEN 3
    END,
    t.created_at DESC
`);

const stmtGetProjectTasksByStatus = db.prepare(`
  SELECT
    t.id,
    t.title,
    t.status,
    t.priority,
    t.assignee,
    t.due_date,
    t.estimated_hours,
    t.actual_hours
  FROM tasks t
  WHERE t.project_id = ? AND t.status = ?
  ORDER BY
    CASE t.priority
      WHEN 'urgent' THEN 0
      WHEN 'high'   THEN 1
      WHEN 'medium' THEN 2
      WHEN 'low'    THEN 3
    END,
    t.created_at DESC
`);

const stmtGetTaskComments = db.prepare(`
  SELECT
    c.id,
    c.author,
    c.body,
    c.created_at
  FROM comments c
  WHERE c.task_id = ?
  ORDER BY c.created_at ASC
`);

const stmtGetBlockedTasks = db.prepare(`
  SELECT
    t.id,
    t.title,
    t.assignee,
    t.due_date,
    t.estimated_hours,
    p.name AS project_name
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  WHERE t.status = 'blocked'
  ORDER BY
    CASE t.priority
      WHEN 'urgent' THEN 0
      WHEN 'high'   THEN 1
      WHEN 'medium' THEN 2
      WHEN 'low'    THEN 3
    END,
    t.due_date ASC
`);

const stmtGetBlockedTasksByProject = db.prepare(`
  SELECT
    t.id,
    t.title,
    t.assignee,
    t.due_date,
    t.estimated_hours,
    p.name AS project_name
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  WHERE t.status = 'blocked' AND t.project_id = ?
  ORDER BY
    CASE t.priority
      WHEN 'urgent' THEN 0
      WHEN 'high'   THEN 1
      WHEN 'medium' THEN 2
      WHEN 'low'    THEN 3
    END,
    t.due_date ASC
`);

// ---------------------------------------------------------------------------
// Claude model via Vercel AI SDK adapter
// ---------------------------------------------------------------------------

const model = aisdk(anthropic(MODEL));

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const listProjects = tool({
  name: 'list_projects',
  description:
    'List all projects with their task counts. Optionally filter by status (active, completed, archived).',
  parameters: z.object({
    status: z
      .enum(['active', 'completed', 'archived'])
      .optional()
      .describe('Filter projects by status'),
  }),
  execute: async ({ status }) => {
    const rows = status
      ? stmtListProjectsByStatus.all(status)
      : stmtListProjects.all();
    return JSON.stringify({ projects: rows, count: rows.length });
  },
});

const searchTasks = tool({
  name: 'search_tasks',
  description:
    'Search tasks by keyword in title or description. Optionally filter by status and/or priority.',
  parameters: z.object({
    query: z.string().describe('Search keyword to match against task title or description'),
    status: z
      .enum(['todo', 'in_progress', 'review', 'done', 'blocked'])
      .optional()
      .describe('Filter by task status'),
    priority: z
      .enum(['low', 'medium', 'high', 'urgent'])
      .optional()
      .describe('Filter by task priority'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Maximum number of results to return'),
  }),
  execute: async ({ query, status, priority, limit }) => {
    const pattern = `%${query}%`;
    let rows: unknown[];

    if (status && priority) {
      rows = stmtSearchTasksByStatusAndPriority.all(pattern, pattern, status, priority, limit);
    } else if (status) {
      rows = stmtSearchTasksByStatus.all(pattern, pattern, status, limit);
    } else if (priority) {
      rows = stmtSearchTasksByPriority.all(pattern, pattern, priority, limit);
    } else {
      rows = stmtSearchTasks.all(pattern, pattern, limit);
    }

    return JSON.stringify({ tasks: rows, count: rows.length });
  },
});

const getTaskDetails = tool({
  name: 'get_task_details',
  description:
    'Get full details for a specific task by ID, including its project name and labels.',
  parameters: z.object({
    task_id: z.number().int().positive().describe('The ID of the task to retrieve'),
  }),
  execute: async ({ task_id }) => {
    const row = stmtGetTaskDetails.get(task_id);
    if (!row) {
      return JSON.stringify({ error: `Task with ID ${task_id} not found` });
    }
    return JSON.stringify({ task: row });
  },
});

const getProjectTasks = tool({
  name: 'get_project_tasks',
  description:
    'Get all tasks for a specific project, ordered by priority (urgent first). Optionally filter by status.',
  parameters: z.object({
    project_id: z.number().int().positive().describe('The project ID'),
    status: z
      .enum(['todo', 'in_progress', 'review', 'done', 'blocked'])
      .optional()
      .describe('Filter by task status'),
  }),
  execute: async ({ project_id, status }) => {
    const rows = status
      ? stmtGetProjectTasksByStatus.all(project_id, status)
      : stmtGetProjectTasks.all(project_id);
    return JSON.stringify({ tasks: rows, count: rows.length });
  },
});

const getTaskComments = tool({
  name: 'get_task_comments',
  description: 'Get all comments for a specific task, ordered chronologically.',
  parameters: z.object({
    task_id: z.number().int().positive().describe('The task ID'),
  }),
  execute: async ({ task_id }) => {
    const rows = stmtGetTaskComments.all(task_id);
    return JSON.stringify({ comments: rows, count: rows.length });
  },
});

const getBlockedTasks = tool({
  name: 'get_blocked_tasks',
  description:
    'Get all tasks that are currently blocked. Optionally filter by project ID. Results are ordered by priority and due date.',
  parameters: z.object({
    project_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Optionally filter blocked tasks by project ID'),
  }),
  execute: async ({ project_id }) => {
    const rows = project_id
      ? stmtGetBlockedTasksByProject.all(project_id)
      : stmtGetBlockedTasks.all();
    return JSON.stringify({ blocked_tasks: rows, count: rows.length });
  },
});

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  'You are a helpful task management assistant.',
  'Use the available tools to answer questions about projects, tasks, labels, and comments.',
  'Be precise with dates, hours, and task counts.',
  'When listing tasks, always mention their status and priority.',
  'If a task is blocked, highlight that clearly.',
  'Format responses clearly with bullet points or tables where appropriate.',
].join(' ');

const agent = new Agent({
  name: 'Task Management Assistant',
  instructions: SYSTEM_PROMPT,
  model,
  tools: [listProjects, searchTasks, getTaskDetails, getProjectTasks, getTaskComments, getBlockedTasks],
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
    json(res, 200, { status: 'ok', database: DB_PATH });
    return;
  }

  // POST /chat
  if (req.method === 'POST' && req.url === '/chat') {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      const message = parsed?.message;

      if (!message || typeof message !== 'string') {
        json(res, 400, { error: 'Request body must include a "message" string field' });
        return;
      }

      const result = await handleChat(message);
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

// ---------------------------------------------------------------------------
// Startup & shutdown
// ---------------------------------------------------------------------------

function shutdown(): void {
  console.log('\nShutting down...');
  server.close();
  db.close();
  console.log('Database connection closed.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`Task management agent running on http://localhost:${PORT}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Database: ${DB_PATH}`);
  console.log('');
  console.log('Endpoints:');
  console.log('  GET  /health');
  console.log('  POST /chat   { "message": "..." }');
});
