# Finance Assistant Example

A complete working example of Mimic with a personal finance schema.

## Prerequisites

- Node.js >= 22
- Docker (for PostgreSQL)
- Anthropic API key

## Quick Start

```bash
# 1. Start PostgreSQL
docker compose up -d

# 2. Set environment
export DATABASE_URL="postgresql://mimic:mimic@localhost:5432/mimic_finance"
export ANTHROPIC_API_KEY="your-key-here"

# 3. Create tables
npx prisma db push

# 4. Generate and seed data
mimic run
mimic seed --verbose

# 5. Inspect what was generated
mimic inspect schema
mimic inspect data

# 6. Start the agent (uses OpenAI Agents SDK + Mimic MCP via stdio)
cd agent && npm install && npm start

# 7. Chat with the agent
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What did I spend on dining last month?"}'

# 8. Run automated tests
mimic test --verbose
```

## Agent Architecture

The agent uses the [OpenAI Agents JS SDK](https://github.com/openai/openai-agents-js) with:

- **Model**: Claude Haiku via `@ai-sdk/anthropic` adapter
- **Tools**: Auto-discovered from Mimic MCP server (spawned as a subprocess via stdio)
- **Endpoint**: `POST /chat` with `{ "message": "..." }` → `{ "text": "...", "toolCalls": [...] }`

The agent spawns `mimic host --transport stdio` as a child process, connects over MCP stdio protocol, and automatically discovers all tools from your database schema.

## What You Get

For the "young-professional" persona (Maya Chen, 28, product designer):

```
users:        1 row
accounts:     3 rows   (Chase checking, Amex Gold credit, Ally savings)
transactions: ~180+    (6 months of realistic activity)
```

Patterns include:
- Rent ($1,850) on the 1st of each month
- Biweekly salary ($3,645.83) on 15th and 30th
- Subscriptions: Netflix ($15.49), Spotify ($10.99)
- Dining 3-5x/week at real restaurants
- Groceries at H-E-B on weekends
- Uber spikes on Friday/Saturday nights

## MCP Tools

Auto-generated from your schema:

| Tool | Description |
|---|---|
| `get_transactions` | Query with date range, category, merchant, amount filters |
| `get_accounts` | List accounts, filter by type |
| `get_users` | Get user profiles |
| `get_transactions_summary` | Spending summary with category grouping |

## Cleanup

```bash
mimic clean --yes
docker compose down
```
