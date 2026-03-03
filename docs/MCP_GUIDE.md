# MCP Server Guide

Every Mimic API mock adapter includes a built-in MCP (Model Context Protocol) server. This guide covers how to use them, configure them, and build new ones.

## What Are Mimic MCP Servers?

MCP servers let AI agents connect to Mimic mocks through the standard Model Context Protocol. Instead of your agent making HTTP calls to `localhost:4000/stripe/v1/customers`, it calls MCP tools like `list_customers`. The MCP server translates these tool calls into HTTP requests against the Mimic mock.

```
AI Agent  --MCP-->  Mimic MCP Server  --HTTP-->  Mimic Mock Adapter
(Claude)           (adapter-stripe)              (/stripe/v1)
```

This matters because many agent frameworks (Claude, Cursor, Copilot, custom agents) use MCP as their primary tool interface. Mimic MCP servers give agents realistic mock data through the same protocol they'll use in production.

## Using MCP Servers

### With Claude Code

```bash
# Add Mimic Stripe MCP server
claude mcp add mimic-stripe -- npx -y @mimicai/adapter-stripe mcp

# With custom Mimic server URL
claude mcp add --env MIMIC_BASE_URL=http://localhost:4000 mimic-stripe -- npx -y @mimicai/adapter-stripe mcp
```

### With Cursor / VS Code

Add to your MCP configuration file:

```json
{
  "mcpServers": {
    "mimic-stripe": {
      "command": "npx",
      "args": ["-y", "@mimicai/adapter-stripe", "mcp"],
      "env": {
        "MIMIC_BASE_URL": "http://localhost:4000"
      }
    },
    "mimic-plaid": {
      "command": "npx",
      "args": ["-y", "@mimicai/adapter-plaid", "mcp"],
      "env": {
        "MIMIC_BASE_URL": "http://localhost:4000"
      }
    },
    "mimic-slack": {
      "command": "npx",
      "args": ["-y", "@mimicai/adapter-slack", "mcp"],
      "env": {
        "MIMIC_BASE_URL": "http://localhost:4000"
      }
    }
  }
}
```

### With Mimic CLI

The simplest way — `mimic host` starts both mock API endpoints and MCP servers:

```json
{
  "apis": [
    { "adapter": "stripe" },
    { "adapter": "plaid" },
    { "adapter": "slack" }
  ]
}
```

```bash
mimic host
# Stripe API  -> http://localhost:4000/stripe/v1
# Plaid API   -> http://localhost:4000/plaid
# Slack API   -> http://localhost:4000/slack
# MCP Server  -> stdio
```

## Available MCP Servers

Each API mock adapter includes a built-in MCP server:

| Adapter | Package | MCP Command |
|---------|---------|-------------|
| Stripe | `@mimicai/adapter-stripe` | `npx @mimicai/adapter-stripe mcp` |
| Plaid | `@mimicai/adapter-plaid` | `npx @mimicai/adapter-plaid mcp` |
| Slack | `@mimicai/adapter-slack` | `npx @mimicai/adapter-slack mcp` |

### Stripe MCP Tools

Tools derived from the adapter's `getEndpoints()`: list customers, create customer, create payment intent, list charges, list subscriptions, create subscription, list invoices, list products, create product, list prices, list payment methods, create refund, get balance, and more.

### Plaid MCP Tools

Create link token, exchange public token, get accounts, get transactions, get balance, get identity, get institutions, get auth, and more.

### Slack MCP Tools

List channels, post message, list messages, list users, get user info, add reaction, list reactions, upload file, get channel info, search messages, and more.

## Building an MCP Server for a New Adapter

Each adapter includes an MCP entry point at `src/bin/mcp.ts`. When building a new adapter, create this file:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = process.env.MIMIC_BASE_URL ?? 'http://localhost:4000';

const server = new McpServer({
  name: 'mimic-my-platform',
  version: '0.3.0',
});

server.tool(
  'list_items',
  'List all items in My Platform. Returns an array of items with id, title, status, and priority.',
  {},
  async () => {
    const res = await fetch(`${BASE_URL}/my-platform/items`);
    const data = await res.json();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(data, null, 2),
      }],
    };
  },
);

server.tool(
  'create_item',
  'Create a new item in My Platform. Requires a title. Optionally set priority and status.',
  {
    title: z.string().describe('Item title'),
    priority: z.enum(['low', 'medium', 'high']).optional(),
  },
  async (params) => {
    const res = await fetch(`${BASE_URL}/my-platform/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    return {
      content: [{
        type: 'text',
        text: `Created item ${data.data.id}: "${data.data.title}"`,
      }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

### Tool Design Guidelines

**Name tools to match the platform's vocabulary.** Stripe has "customers", not "users". Slack has "channels", not "rooms".

**Write descriptions for LLMs, not humans.** Include what the tool does, what's required, what's optional, and what it returns.

**Return human-readable summaries for write operations.** When an agent creates a customer, return `"Created customer cus_abc123: John Doe"` not a raw JSON dump.

**Keep parameter schemas tight.** Use enums where possible. Add `.describe()` to every parameter.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MIMIC_BASE_URL` | URL of the running Mimic mock server | `http://localhost:4000` |

## Troubleshooting

**"Connection refused" errors** — Make sure `mimic host` is running before starting MCP servers. The MCP server needs the mock adapter to be available at `MIMIC_BASE_URL`.

**Tools not appearing** — Restart your MCP client (Claude Code, Cursor) after adding a new MCP server. Some clients cache the tool list.

**Wrong data** — MCP servers call the mock adapter over HTTP. If the mock adapter hasn't been seeded yet, the first request triggers lazy seeding automatically.
