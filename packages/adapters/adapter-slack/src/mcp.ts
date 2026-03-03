import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHelpers(baseUrl: string) {
  async function callGet(method: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const qs = new URLSearchParams(params).toString();
    const url = `${baseUrl}/slack/api/${method}${qs ? '?' + qs : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Slack mock error ${res.status}`);
    const data = (await res.json()) as Record<string, unknown>;
    if (!data.ok) throw new Error(`Slack error: ${data.error}`);
    return data;
  }

  async function callPost(method: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const res = await fetch(`${baseUrl}/slack/api/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Slack mock error ${res.status}`);
    const data = (await res.json()) as Record<string, unknown>;
    if (!data.ok) throw new Error(`Slack error: ${data.error}`);
    return data;
  }

  return { callGet, callPost };
}

function text(value: string) {
  return { content: [{ type: 'text' as const, text: value }] };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSlackMcpServer(baseUrl: string = 'http://localhost:4100'): McpServer {
  const server = new McpServer({
    name: 'mimic-slack',
    version: '0.2.0',
    description: 'Mimic MCP server for Slack — channels, messages, reactions against mock data',
  });

  const { callGet, callPost } = makeHelpers(baseUrl);

  // 1. slack_list_channels
  server.tool('slack_list_channels', 'List public Slack channels in the workspace', {
    exclude_archived: z.boolean().optional().default(true).describe('Exclude archived channels'),
    limit: z.number().optional().default(100).describe('Maximum channels to return'),
  }, async ({ exclude_archived, limit }) => {
    const data = await callGet('conversations.list', { exclude_archived: String(exclude_archived), limit: String(limit) });
    const channels = data.channels as any[];
    const lines = channels.map((ch) => `#${ch.name} (${ch.num_members} members) — ${ch.topic?.value || 'No topic'}`);
    return text(`Found ${channels.length} channels:\n${lines.join('\n')}`);
  });

  // 2. slack_post_message
  server.tool('slack_post_message', 'Post a new message to a Slack channel', {
    channel: z.string().describe('Channel ID to post to'),
    text: z.string().describe('Message text'),
  }, async ({ channel, text: msg }) => {
    const data = await callPost('chat.postMessage', { channel, text: msg });
    const message = data.message as any;
    return text(`Message posted to ${channel} at ${message.ts}`);
  });

  // 3. slack_reply_to_thread
  server.tool('slack_reply_to_thread', 'Reply to a specific message thread', {
    channel: z.string().describe('Channel ID containing the thread'),
    thread_ts: z.string().describe('Timestamp of the parent message'),
    text: z.string().describe('Reply text'),
  }, async ({ channel, thread_ts, text: msg }) => {
    await callPost('chat.postMessage', { channel, thread_ts, text: msg });
    return text(`Reply posted to thread ${thread_ts}`);
  });

  // 4. slack_add_reaction
  server.tool('slack_add_reaction', 'Add an emoji reaction to a message', {
    channel: z.string().describe('Channel ID containing the message'),
    timestamp: z.string().describe('Timestamp of the message to react to'),
    name: z.string().describe('Emoji name without colons (e.g. "thumbsup")'),
  }, async ({ channel, timestamp, name }) => {
    await callPost('reactions.add', { channel, timestamp, name });
    return text(`Added :${name}: to message`);
  });

  // 5. slack_get_channel_history
  server.tool('slack_get_channel_history', 'Get recent messages from a Slack channel', {
    channel: z.string().describe('Channel ID to fetch history for'),
    limit: z.number().optional().default(20).describe('Number of messages to return'),
  }, async ({ channel, limit }) => {
    const data = await callGet('conversations.history', { channel, limit: String(limit) });
    const messages = data.messages as any[];
    const lines = messages.map((m) => `${m.user} (${m.ts}): ${m.text}`);
    return text(lines.join('\n') || 'No messages found');
  });

  // 6. slack_get_thread_replies
  server.tool('slack_get_thread_replies', 'Get all replies in a message thread', {
    channel: z.string().describe('Channel ID containing the thread'),
    thread_ts: z.string().describe('Timestamp of the parent message'),
  }, async ({ channel, thread_ts }) => {
    const data = await callGet('conversations.replies', { channel, ts: thread_ts });
    const messages = data.messages as any[];
    const lines = messages.map((m) => `${m.user} (${m.ts}): ${m.text}`);
    return text(lines.join('\n') || 'No replies found');
  });

  // 7. slack_get_users
  server.tool('slack_get_users', 'List all users in the Slack workspace', {}, async () => {
    const data = await callGet('users.list');
    const members = data.members as any[];
    const lines = members.map((u) => `${u.profile.real_name} (@${u.name}) — ${u.profile.title || 'No title'}`);
    return text(`Found ${members.length} users:\n${lines.join('\n')}`);
  });

  // 8. slack_get_user_profile
  server.tool('slack_get_user_profile', 'Get detailed profile for a specific user', {
    user: z.string().describe('User ID to look up'),
  }, async ({ user }) => {
    const data = await callGet('users.info', { user });
    const u = data.user as any;
    return text(`Name: ${u.profile.real_name}\nDisplay: ${u.profile.display_name || u.name}\nTitle: ${u.profile.title || 'N/A'}\nEmail: ${u.profile.email || 'N/A'}`);
  });

  // 9. slack_search_messages
  server.tool('slack_search_messages', 'Search for messages across the workspace', {
    query: z.string().describe('Search query string'),
  }, async ({ query }) => {
    const data = await callGet('search.messages', { query });
    const result = data.messages as any;
    const matches = result.matches as any[];
    const lines = matches.map((m: any) => `${m.text}`);
    return text(`Found ${matches.length} matches for '${query}':\n${lines.join('\n')}`);
  });

  // 10. slack_create_channel
  server.tool('slack_create_channel', 'Create a new Slack channel', {
    name: z.string().describe('Channel name (lowercase, no spaces)'),
    is_private: z.boolean().optional().default(false).describe('Create as private channel'),
  }, async ({ name, is_private }) => {
    const data = await callPost('conversations.create', { name, is_private });
    const ch = data.channel as any;
    return text(`Created channel #${ch.name} (${ch.id})`);
  });

  // 11. slack_get_channel_info
  server.tool('slack_get_channel_info', 'Get detailed information about a channel', {
    channel: z.string().describe('Channel ID to look up'),
  }, async ({ channel }) => {
    const data = await callGet('conversations.info', { channel });
    const ch = data.channel as any;
    return text(`Name: #${ch.name}\nID: ${ch.id}\nMembers: ${ch.num_members}\nTopic: ${ch.topic?.value || 'N/A'}\nArchived: ${ch.is_archived || false}`);
  });

  // 12. slack_get_team_info
  server.tool('slack_get_team_info', 'Get information about the Slack workspace', {}, async () => {
    const data = await callGet('team.info');
    const team = data.team as any;
    return text(`Name: ${team.name}\nID: ${team.id}\nDomain: ${team.domain}`);
  });

  return server;
}

export async function startSlackMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4100';
  const server = createSlackMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic Slack MCP server running on stdio');
}
