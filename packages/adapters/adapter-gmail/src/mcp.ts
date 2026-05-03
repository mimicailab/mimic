import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import meta from './adapter-meta.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCall(baseUrl: string) {
  return async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gmail mock error ${res.status}: ${errText}`);
    }
    return res.json();
  };
}

function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    (e): e is [string, string | number] => e[1] !== undefined && e[1] !== '',
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

// Gmail addresses things by `userId`. For a mock single-tenant deployment we default to "me".
const USER = 'me';

// ---------------------------------------------------------------------------
// Gmail MCP Tools
// ---------------------------------------------------------------------------

export function registerGmailTools(server: McpServer, baseUrl: string = 'http://localhost:4100'): void {
  const call = makeCall(baseUrl);
  const root = `/gmail/v1/users/${USER}`;

  // --- Profile -------------------------------------------------------------

  server.tool(
    'get_gmail_profile',
    'Get the authenticated user\'s Gmail profile (email address, message/thread counts, historyId).',
    {},
    async () => {
      const data = (await call('GET', `${root}/profile`)) as Record<string, unknown>;
      return text(
        `${data.emailAddress} — ${data.messagesTotal ?? 0} messages, ${data.threadsTotal ?? 0} threads (historyId=${data.historyId ?? '?'})`,
      );
    },
  );

  // --- Messages ------------------------------------------------------------

  server.tool(
    'list_gmail_messages',
    'List Gmail messages. Optional: `q` (Gmail search syntax — e.g. `from:priya@northwind.com`), `labelIds`, `maxResults` (default 50, max 500).',
    {
      q: z.string().optional().describe('Gmail search query, e.g. `from:foo@bar.com is:unread`'),
      labelIds: z.array(z.string()).optional().describe('Restrict to messages with all of these labels'),
      maxResults: z.number().min(1).max(500).optional().describe('Page size (default 50)'),
    },
    async ({ q, labelIds, maxResults }) => {
      const query = qs({
        q,
        labelIds: labelIds?.join(','),
        maxResults: maxResults ?? 50,
      });
      const data = (await call('GET', `${root}/messages${query}`)) as { messages?: Array<Record<string, unknown>> };
      const list = data.messages ?? [];
      if (list.length === 0) return text('No messages match.');
      const lines = list
        .slice(0, 20)
        .map((m) => `- ${m.id} (thread ${m.threadId})${m.snippet ? ` — ${m.snippet}` : ''}`);
      return text(`${list.length} messages\n${lines.join('\n')}`);
    },
  );

  server.tool(
    'get_gmail_message',
    'Get a single Gmail message by id, including headers and body snippet.',
    {
      id: z.string().describe('Message id'),
      format: z.enum(['full', 'metadata', 'minimal', 'raw']).optional().describe('Response detail level (default `full`).'),
    },
    async ({ id, format }) => {
      const data = (await call('GET', `${root}/messages/${id}${qs({ format })}`)) as Record<string, unknown>;
      const headers = ((data.payload as { headers?: Array<{ name: string; value: string }> } | undefined)?.headers ?? []) as Array<{
        name: string;
        value: string;
      }>;
      const from = headers.find((h) => h.name.toLowerCase() === 'from')?.value ?? '?';
      const subj = headers.find((h) => h.name.toLowerCase() === 'subject')?.value ?? '(no subject)';
      return text(`Message ${data.id}\nFrom: ${from}\nSubject: ${subj}\nSnippet: ${data.snippet ?? ''}`);
    },
  );

  server.tool(
    'send_gmail_message',
    'Send a Gmail message. Provide a base64url-encoded RFC 2822 message in `raw`, or use `to`+`subject`+`body` and the adapter will assemble it.',
    {
      to: z.string().optional().describe('Recipient email (used if `raw` is omitted)'),
      subject: z.string().optional(),
      body: z.string().optional().describe('Plain-text body'),
      raw: z.string().optional().describe('Pre-encoded base64url RFC 2822 message'),
      threadId: z.string().optional().describe('Reply within an existing thread'),
    },
    async (params) => {
      const data = (await call('POST', `${root}/messages/send`, params)) as Record<string, unknown>;
      return text(`Sent message ${data.id} (thread ${data.threadId})`);
    },
  );

  server.tool(
    'modify_gmail_message_labels',
    'Add or remove labels on a Gmail message (e.g. mark read = remove `UNREAD`; archive = remove `INBOX`).',
    {
      id: z.string().describe('Message id'),
      addLabelIds: z.array(z.string()).optional(),
      removeLabelIds: z.array(z.string()).optional(),
    },
    async ({ id, addLabelIds, removeLabelIds }) => {
      const data = (await call('POST', `${root}/messages/${id}/modify`, {
        addLabelIds,
        removeLabelIds,
      })) as Record<string, unknown>;
      return text(`Updated message ${id} → labels: ${(data.labelIds as string[] | undefined)?.join(', ') ?? '(none)'}`);
    },
  );

  // --- Threads -------------------------------------------------------------

  server.tool(
    'list_gmail_threads',
    'List Gmail threads. Threads are the primary unit for reasoning about a conversation.',
    {
      q: z.string().optional(),
      labelIds: z.array(z.string()).optional(),
      maxResults: z.number().min(1).max(500).optional(),
    },
    async ({ q, labelIds, maxResults }) => {
      const query = qs({
        q,
        labelIds: labelIds?.join(','),
        maxResults: maxResults ?? 50,
      });
      const data = (await call('GET', `${root}/threads${query}`)) as { threads?: Array<Record<string, unknown>> };
      const list = data.threads ?? [];
      if (list.length === 0) return text('No threads match.');
      const lines = list.slice(0, 20).map((t) => `- ${t.id}${t.snippet ? ` — ${t.snippet}` : ''}`);
      return text(`${list.length} threads\n${lines.join('\n')}`);
    },
  );

  server.tool(
    'get_gmail_thread',
    'Get a Gmail thread (all messages in the conversation), useful for the briefing agent\'s "what was last said" step.',
    { id: z.string().describe('Thread id') },
    async ({ id }) => {
      const data = (await call('GET', `${root}/threads/${id}`)) as {
        id: string;
        messages?: Array<Record<string, unknown>>;
      };
      const count = data.messages?.length ?? 0;
      return text(`Thread ${data.id}: ${count} message(s)`);
    },
  );

  // --- Labels --------------------------------------------------------------

  server.tool(
    'list_gmail_labels',
    'List all labels (system + user) in the mailbox.',
    {},
    async () => {
      const data = (await call('GET', `${root}/labels`)) as { labels?: Array<Record<string, unknown>> };
      const list = data.labels ?? [];
      const lines = list.map((l) => `- ${l.id} [${l.type}] ${l.name}`);
      return text(`${list.length} labels\n${lines.join('\n')}`);
    },
  );

  // --- Drafts --------------------------------------------------------------

  server.tool(
    'list_gmail_drafts',
    'List Gmail drafts.',
    { maxResults: z.number().min(1).max(500).optional() },
    async ({ maxResults }) => {
      const query = qs({ maxResults: maxResults ?? 50 });
      const data = (await call('GET', `${root}/drafts${query}`)) as { drafts?: Array<Record<string, unknown>> };
      const list = data.drafts ?? [];
      const lines = list.slice(0, 20).map((d) => `- ${d.id} (message ${(d.message as any)?.id ?? '?'})`);
      return text(`${list.length} drafts\n${lines.join('\n')}`);
    },
  );

  // --- History (incremental sync) -----------------------------------------

  server.tool(
    'list_gmail_history',
    'List incremental mailbox history since `startHistoryId`. Useful for agents polling for changes.',
    {
      startHistoryId: z.string().describe('Historic id to begin listing from (from a previous response).'),
      labelId: z.string().optional(),
      maxResults: z.number().min(1).max(500).optional(),
    },
    async ({ startHistoryId, labelId, maxResults }) => {
      const query = qs({ startHistoryId, labelId, maxResults: maxResults ?? 100 });
      const data = (await call('GET', `${root}/history${query}`)) as {
        history?: Array<Record<string, unknown>>;
        historyId?: string;
      };
      return text(
        `History since ${startHistoryId} → now ${data.historyId ?? '?'}: ${(data.history ?? []).length} change record(s)`,
      );
    },
  );
}

export function createGmailMcpServer(): McpServer {
  return new McpServer({
    name: meta.mcp.serverName,
    version: meta.mcp.serverVersion,
  });
}

export async function startGmailMcpServer(): Promise<void> {
  const server = createGmailMcpServer();
  registerGmailTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
