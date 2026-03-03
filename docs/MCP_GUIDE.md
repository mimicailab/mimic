# MCP Server Guide

Every Mimic API mock adapter has a corresponding MCP (Model Context Protocol) server. This guide covers how to use them, configure them, and build new ones.

## What Are Mimic MCP Servers?

MCP servers let AI agents connect to Mimic mocks through the standard Model Context Protocol. Instead of your agent making HTTP calls to `localhost:4000/jira/rest/api/3/issue`, it calls MCP tools like `create_issue` and `search_jql`. The MCP server translates these tool calls into HTTP requests against the Mimic mock.

```
AI Agent  ──MCP──▶  Mimic MCP Server  ──HTTP──▶  Mimic Mock Adapter
(Claude)           (mcp-jira)                    (adapter-jira)
```

This matters because many agent frameworks (Claude, Cursor, Copilot, custom agents) use MCP as their primary tool interface. Mimic MCP servers give agents realistic mock data through the same protocol they'll use in production.

## Using MCP Servers

### With Claude Code

```bash
# Add Mimic Jira MCP server
claude mcp add mimic-jira -- npx -y @mimicai/mcp-jira

# With custom Mimic server URL
claude mcp add --env MIMIC_BASE_URL=http://localhost:4000 mimic-jira -- npx -y @mimicai/mcp-jira
```

### With Cursor / VS Code

Add to your MCP configuration file:

```json
{
  "mcpServers": {
    "mimic-jira": {
      "command": "npx",
      "args": ["-y", "@mimicai/mcp-jira"],
      "env": {
        "MIMIC_BASE_URL": "http://localhost:4000"
      }
    },
    "mimic-slack": {
      "command": "npx",
      "args": ["-y", "@mimicai/mcp-slack"],
      "env": {
        "MIMIC_BASE_URL": "http://localhost:4000"
      }
    }
  }
}
```

### With Mimic CLI

The simplest way — `mimic host` can start MCP servers alongside API mocks:

```yaml
# .mimic/config.yaml
surfaces:
  mcp:
    - adapter: jira
      transport: stdio
    - adapter: slack
      transport: stdio
    - adapter: notion
      transport: stdio
```

```bash
mimic host
# ✓ Jira MCP     → stdio: npx @mimicai/mcp-jira
# ✓ Slack MCP    → stdio: npx @mimicai/mcp-slack
# ✓ Notion MCP   → stdio: npx @mimicai/mcp-notion
```

## Available MCP Servers

Every adapter with a full implementation has a corresponding MCP server. Here's the full list with tool counts:

### Fintech / Payments

| Package | Tools | Primary Tools |
|---------|-------|--------------|
| `@mimicai/mcp-stripe` | 12 | create_payment_intent, list_charges, create_customer, list_subscriptions |
| `@mimicai/mcp-plaid` | 10 | create_link_token, get_accounts, get_transactions, get_balance |
| `@mimicai/mcp-square` | 8 | create_payment, list_orders, create_customer |

### Communication

| Package | Tools | Primary Tools |
|---------|-------|--------------|
| `@mimicai/mcp-slack` | 10 | post_message, list_channels, search_messages, list_users |
| `@mimicai/mcp-twilio` | 8 | send_sms, make_call, list_messages |
| `@mimicai/mcp-sendgrid` | 6 | send_email, list_contacts, get_stats |

### CRM

| Package | Tools | Primary Tools |
|---------|-------|--------------|
| `@mimicai/mcp-salesforce` | 10 | query_soql, create_record, update_record, describe_object |
| `@mimicai/mcp-hubspot` | 10 | search_contacts, create_deal, list_companies, update_contact |
| `@mimicai/mcp-pipedrive` | 8 | list_deals, create_person, search |

### Ticketing

| Package | Tools | Primary Tools |
|---------|-------|--------------|
| `@mimicai/mcp-jira` | 10 | create_issue, search_jql, transition_issue, add_comment |
| `@mimicai/mcp-zendesk` | 8 | create_ticket, update_ticket, search_tickets, add_comment |
| `@mimicai/mcp-linear` | 8 | create_issue, update_issue, list_issues, list_cycles |
| `@mimicai/mcp-pagerduty` | 8 | create_incident, acknowledge_incident, resolve_incident |

### Project Management

| Package | Tools | Primary Tools |
|---------|-------|--------------|
| `@mimicai/mcp-notion` | 10 | query_database, create_page, update_page, search, append_blocks |
| `@mimicai/mcp-asana` | 8 | list_tasks, create_task, update_task, search_tasks |
| `@mimicai/mcp-trello` | 8 | list_cards, create_card, move_card, add_comment |
| `@mimicai/mcp-airtable` | 6 | list_records, create_records, update_records |

## Official MCP Parity

For platforms that ship their own official MCP servers, Mimic MCP servers match the exact same tool names and parameter schemas. This means you can develop against Mimic mocks, then swap to the real MCP server for production — zero code changes.

| Platform | Official MCP | Mimic MCP | Tool Parity |
|----------|-------------|-----------|-------------|
| Jira | Atlassian MCP | `@mimicai/mcp-jira` | ✅ Matched |
| Slack | Claude.ai connector | `@mimicai/mcp-slack` | ✅ Matched |
| Asana | `mcp.asana.com/sse` | `@mimicai/mcp-asana` | ✅ Matched |
| HubSpot | `mcp.hubspot.com` | `@mimicai/mcp-hubspot` | ✅ Matched |
| GitHub | `@modelcontextprotocol/server-github` | `@mimicai/mcp-github` | ✅ Matched |
| GitLab | Official GitLab MCP | `@mimicai/mcp-gitlab` | ✅ Matched |

## Building a New MCP Server

If you've built an adapter and want to add the MCP wrapper, or if you want to improve an existing MCP server:

### Auto-Generation

Most MCP servers are auto-generated from the adapter's `getEndpoints()` definitions:

```bash
pnpm mimic:generate-mcp my-platform
```

This creates a baseline MCP server with a tool for each endpoint. You then refine tool descriptions, parameter schemas, and response formatting.

### Manual Implementation

For high-quality MCP servers, hand-tune the generated output:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'mimic-my-platform',
  version: '1.0.0',
});

// Tool descriptions should help LLMs decide when to use them
server.tool(
  'create_item',
  'Create a new item in My Platform. Requires a title. Optionally set priority (low/medium/high/urgent), assignee, and labels. Returns the created item with its ID.',
  {
    title: z.string().describe('Item title'),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    assignee: z.string().optional().describe('User ID to assign to'),
  },
  async (params) => {
    const data = await mimicFetch('POST', '/my-platform/items', params);
    return {
      content: [{
        type: 'text',
        text: `Created item #${data.id}: "${data.title}" (${data.priority || 'normal'})`
      }]
    };
  }
);
```

### Tool Design Guidelines

**Name tools to match the platform's vocabulary.** Jira has "issues", not "tickets". Notion has "pages", not "documents". Asana has "tasks", not "items".

**Write descriptions for LLMs, not humans.** Include what the tool does, what's required, what's optional, and what it returns.

**Return human-readable summaries for write operations.** When an agent creates a ticket, return `"Created ticket MIM-42: Fix login bug (High)"` not a JSON dump. Reserve raw JSON for read operations where the agent needs full details.

**Keep parameter schemas tight.** Use enums where possible. Add `.describe()` to every parameter. The schema is the agent's only guide for how to call the tool.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MIMIC_BASE_URL` | URL of the running Mimic mock server | `http://localhost:4000` |
| `MIMIC_AUTH_TOKEN` | Auth token to include in requests to the mock | `mimic_test` |
| `MIMIC_LOG_LEVEL` | MCP server log level | `error` |

## Troubleshooting

**"Connection refused" errors** — Make sure `mimic host` is running before starting MCP servers. The MCP server needs the mock adapter to be available at `MIMIC_BASE_URL`.

**Tools not appearing** — Restart your MCP client (Claude Code, Cursor) after adding a new MCP server. Some clients cache the tool list.

**Wrong data** — MCP servers call the mock adapter over HTTP. If the mock adapter hasn't been seeded yet, the first MCP tool call triggers lazy seeding automatically.
