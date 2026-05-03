import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import meta from './adapter-meta.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCall(baseUrl: string) {
  return async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Slack mock error ${res.status}: ${errText}`);
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

// ---------------------------------------------------------------------------
// Slack MCP Tools
// ---------------------------------------------------------------------------

export function registerSlackTools(server: McpServer, baseUrl: string = 'http://localhost:4100'): void {
  const call = makeCall(baseUrl);
  const root = '/api';

  // --- Identity / team ---------------------------------------------------

  server.tool('get_slack_team_info', 'Get the current Slack workspace info (name, domain, id).', {}, async () => {
    const data = (await call('GET', `${root}/team.info`)) as { team?: { name: string; domain: string; id: string } };
    if (!data.team) return text('No team info available.');
    return text(`${data.team.name} (${data.team.domain}.slack.com — ${data.team.id})`);
  });

  // --- Users -------------------------------------------------------------

  server.tool(
    'lookup_slack_user_by_email',
    'Look up a Slack user by email address. Use this to map a meeting attendee to their workspace identity before reading their messages or channel mentions.',
    { email: z.string().describe('Email address to look up.') },
    async ({ email }) => {
      const data = (await call('GET', `${root}/users.lookupByEmail${qs({ email })}`)) as {
        ok?: boolean; user?: Record<string, unknown>; error?: string;
      };
      if (!data.ok || !data.user) return text(`No Slack user found for ${email} (${data.error ?? 'unknown'}).`);
      const u = data.user as { id: string; real_name?: string; profile?: { email?: string } };
      return text(`${u.id} — ${u.real_name ?? '(no real name)'} <${u.profile?.email ?? '?'}>`);
    },
  );

  server.tool(
    'list_slack_users',
    'List all users in the workspace (paginated).',
    { cursor: z.string().optional(), limit: z.number().min(1).max(1000).optional() },
    async ({ cursor, limit }) => {
      const data = (await call('GET', `${root}/users.list${qs({ cursor, limit: limit ?? 100 })}`)) as {
        members?: Array<Record<string, unknown>>; response_metadata?: { next_cursor?: string };
      };
      const members = data.members ?? [];
      if (members.length === 0) return text('No users found.');
      const lines = members.slice(0, 25).map((m) => `- ${m.id} ${m.real_name ?? m.name}${m.is_bot ? ' [bot]' : ''}`);
      const more = data.response_metadata?.next_cursor ? `\n(more — cursor=${data.response_metadata.next_cursor})` : '';
      return text(`${members.length} users\n${lines.join('\n')}${more}`);
    },
  );

  // --- Channels / conversations ------------------------------------------

  server.tool(
    'list_slack_channels',
    'List Slack channels (default: public_channel). Use types=`public_channel,private_channel,mpim,im` to broaden.',
    {
      types: z.string().optional().describe('Comma-separated channel types'),
      exclude_archived: z.boolean().optional(),
      limit: z.number().min(1).max(1000).optional(),
    },
    async ({ types, exclude_archived, limit }) => {
      const data = (await call(
        'GET',
        `${root}/conversations.list${qs({ types, exclude_archived: exclude_archived ? 'true' : undefined, limit: limit ?? 100 })}`,
      )) as { channels?: Array<{ id: string; name: string; is_archived?: boolean }> };
      const list = data.channels ?? [];
      if (list.length === 0) return text('No channels found.');
      const lines = list.slice(0, 30).map((c) => `- ${c.id} #${c.name}${c.is_archived ? ' (archived)' : ''}`);
      return text(`${list.length} channels\n${lines.join('\n')}`);
    },
  );

  server.tool(
    'get_slack_conversation_history',
    'Read recent top-level messages in a Slack channel (newest first). Use cursor for pagination.',
    {
      channel: z.string().describe('Channel id (e.g. C01234ABCDE)'),
      limit: z.number().min(1).max(200).optional(),
      cursor: z.string().optional(),
    },
    async ({ channel, limit, cursor }) => {
      const data = (await call('GET', `${root}/conversations.history${qs({ channel, limit: limit ?? 50, cursor })}`)) as {
        messages?: Array<{ ts: string; user: string; text: string }>; has_more?: boolean;
      };
      const msgs = data.messages ?? [];
      if (msgs.length === 0) return text(`No messages in ${channel}.`);
      const lines = msgs.slice(0, 30).map((m) => `- ${m.ts} ${m.user}: ${m.text.slice(0, 120)}`);
      return text(`${msgs.length} messages${data.has_more ? ' (more)' : ''}\n${lines.join('\n')}`);
    },
  );

  server.tool(
    'get_slack_thread_replies',
    'Read all replies in a Slack thread (parent ts + replies in chronological order).',
    {
      channel: z.string().describe('Channel id'),
      ts: z.string().describe('Parent message ts'),
      limit: z.number().min(1).max(200).optional(),
    },
    async ({ channel, ts, limit }) => {
      const data = (await call('GET', `${root}/conversations.replies${qs({ channel, ts, limit: limit ?? 50 })}`)) as {
        messages?: Array<{ ts: string; user: string; text: string }>;
      };
      const msgs = data.messages ?? [];
      return text(`${msgs.length} message(s) in thread\n${msgs.map((m) => `- ${m.ts} ${m.user}: ${m.text.slice(0, 120)}`).join('\n')}`);
    },
  );

  // --- Search ------------------------------------------------------------

  server.tool(
    'search_slack_messages',
    'Search Slack messages. Supports `from:<userId>` modifier; otherwise naive substring match on message text.',
    {
      query: z.string().describe('Search query, e.g. "northwind" or "from:U01234 procurement"'),
      count: z.number().min(1).max(100).optional(),
      page: z.number().min(1).optional(),
    },
    async ({ query, count, page }) => {
      const data = (await call('GET', `${root}/search.messages${qs({ query, count: count ?? 20, page: page ?? 1 })}`)) as {
        messages?: { total: number; matches?: Array<{ ts: string; user: string; channel: string; text: string }> };
      };
      const matches = data.messages?.matches ?? [];
      const total = data.messages?.total ?? 0;
      if (matches.length === 0) return text(`No matches for "${query}" (total ${total}).`);
      const lines = matches.slice(0, 30).map((m) => `- [${m.channel}] ${m.user}: ${m.text.slice(0, 140)}`);
      return text(`${total} matches for "${query}"\n${lines.join('\n')}`);
    },
  );

  // --- Posting -----------------------------------------------------------

  server.tool(
    'post_slack_message',
    'Post a message to a Slack channel. For thread replies, set thread_ts to the parent message ts.',
    {
      channel: z.string().describe('Channel id'),
      text: z.string().describe('Message text'),
      thread_ts: z.string().optional().describe('Reply within an existing thread'),
    },
    async ({ channel, text: msgText, thread_ts }) => {
      const data = (await call('POST', `${root}/chat.postMessage`, { channel, text: msgText, thread_ts })) as {
        channel?: string; ts?: string;
      };
      return text(`Posted to ${data.channel ?? channel} at ts=${data.ts ?? '?'}`);
    },
  );

  // --- Reactions ---------------------------------------------------------

  server.tool(
    'add_slack_reaction',
    'Add an emoji reaction to a Slack message.',
    {
      channel: z.string().describe('Channel id'),
      timestamp: z.string().describe('Message ts'),
      name: z.string().describe('Emoji name without colons (e.g. "thumbsup")'),
    },
    async (params) => {
      const data = (await call('POST', `${root}/reactions.add`, params)) as { ok?: boolean; error?: string };
      return text(data.ok ? `Reacted :${params.name}: on ${params.channel}/${params.timestamp}` : `Failed: ${data.error}`);
    },
  );

  // --- Pins --------------------------------------------------------------

  server.tool(
    'list_slack_pins',
    'List pinned messages in a Slack channel.',
    { channel: z.string().describe('Channel id') },
    async ({ channel }) => {
      const data = (await call('GET', `${root}/pins.list${qs({ channel })}`)) as {
        items?: Array<{ message?: { ts: string; user: string; text: string } }>;
      };
      const items = data.items ?? [];
      if (items.length === 0) return text(`No pins in ${channel}.`);
      const lines = items.map((it) => `- ${it.message?.ts} ${it.message?.user}: ${it.message?.text?.slice(0, 120)}`);
      return text(`${items.length} pinned\n${lines.join('\n')}`);
    },
  );
}

export function createSlackMcpServer(): McpServer {
  return new McpServer({
    name: meta.mcp.serverName,
    version: meta.mcp.serverVersion,
  });
}

export async function startSlackMcpServer(): Promise<void> {
  const server = createSlackMcpServer();
  registerSlackTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
