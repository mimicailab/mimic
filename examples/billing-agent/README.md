# Billing Agent Example

A streaming AI agent for SaaS billing and subscription management, powered by [Mimic](https://github.com/mimicailab/mimic) synthetic data and the [Vercel AI SDK](https://sdk.vercel.ai).

All tools are provided through a single MCP connection to `mimic host`, which auto-discovers:
- **PostgreSQL** query tools from the database schema
- **Stripe** API tools from the mock adapter (when `mcp: true` in config)

The agent has zero hardcoded tools — everything is driven by `mimic.json`.

## Prerequisites

- Node.js >= 22
- Docker (for PostgreSQL)
- An [Anthropic API key](https://console.anthropic.com)

## Quick Start

### 1. Start PostgreSQL

```bash
docker compose up -d
```

Starts PostgreSQL 17 on port **5433** (database: `mimic_billing`, user: `mimic`, password: `mimic`).

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

### 3. Generate and seed data

```bash
export $(cat .env | xargs)

npx @mimicai/cli run           # generate synthetic billing data
npx @mimicai/cli seed --verbose # insert into PostgreSQL
```

Two personas are generated:
- **growth-startup** — 50 customers, 3 tiers, past-due invoices, growing MRR
- **established-saas** — 75 customers, enterprise-heavy, clean billing history

### 4. Start the agent

```bash
cd agent
npm install
export $(cat ../.env | xargs)
npm start
```

The agent starts on **http://localhost:3002**. Under the hood it spawns `mimic host`, which provides all tools via a single MCP connection:

```
Mimic MCP connected. Tools: get_customers, get_customers_summary,
  get_subscriptions, get_subscriptions_summary, get_invoices,
  get_invoices_summary, get_payments, get_payments_summary,
  create_customer, list_customers, create_payment_intent, ...
```

Test with curl:

```bash
curl http://localhost:3002/health

curl -X POST http://localhost:3002/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "How many enterprise customers do we have?"}'
```

### 5. Start the chat UI

In a **new terminal** (keep the agent running):

```bash
cd ui
npm install
npm run dev
```

Open **http://localhost:3000**.

**Try these queries:**
- "Show me the revenue summary"
- "List all enterprise customers"
- "Check the Stripe balance"
- "What's the total MRR breakdown by plan?"

## Architecture

```
Browser (localhost:3000)
  └─ useChat() → /api/chat
       └─ Next.js route converts UIMessage → ModelMessage
            └─ Agent server (localhost:3002/chat)
                 └─ streamText() with auto-discovered MCP tools
                      └─ mimic host (subprocess, stdio)
                           ├─ MCP server → PostgreSQL queries
                           └─ Mock API server (localhost:4100)
                                └─ Stripe adapter (mcp: true → tools exposed via MCP)
```

**Key design**: The agent connects to `mimic host` once via MCP. The host command reads `mimic.json` and decides which tools to expose:
- Database tools are generated from the Prisma schema
- API adapter tools are registered when `mcp: true` is set in the adapter config

The agent code itself has **no tool definitions** — it just calls `mimicMcp.tools()` and passes them to `streamText()`.

## Configuration

### mimic.json

The `mimic.json` config drives everything:

```jsonc
{
  "databases": {
    "primary": {
      "type": "postgres",
      "url": "$DATABASE_URL",
      "schema": { "source": "prisma", "path": "./prisma/schema.prisma" }
    }
  },
  "apis": {
    "stripe": {
      "enabled": true,
      "mcp": true          // ← exposes Stripe tools via MCP
    }
  }
}
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | (required) | Your Anthropic API key |
| `DATABASE_URL` | `postgresql://mimic:mimic@localhost:5433/mimic_billing` | PostgreSQL connection string |
| `PORT` | `3002` | Agent HTTP server port |
| `MODEL` | `claude-haiku-4-5` | Anthropic model for chat |

UI (set in `ui/.env.local` if needed):

| Variable | Default | Description |
|---|---|---|
| `AGENT_URL` | `http://localhost:3002` | Agent server URL |

## Available Tools

All tools are auto-discovered — no hardcoding needed. With the default config:

### PostgreSQL (8 tools)

| Tool | Description |
|---|---|
| `get_customers` | Query customers with filters (plan, status, etc.) |
| `get_customers_summary` | Aggregate stats (count, MRR totals, averages) |
| `get_subscriptions` | Query subscriptions with filters |
| `get_subscriptions_summary` | Subscription aggregate stats |
| `get_invoices` | Query invoices with filters |
| `get_invoices_summary` | Invoice aggregate stats |
| `get_payments` | Query payments with filters |
| `get_payments_summary` | Payment aggregate stats |

### Stripe (17 tools, via `mcp: true`)

| Tool | Description |
|---|---|
| `create_customer` | Create a new Stripe customer |
| `list_customers` | List customers with filters |
| `create_payment_intent` | Create a payment intent |
| `list_payment_intents` | List payment intents |
| `confirm_payment_intent` | Confirm a payment intent |
| `capture_payment_intent` | Capture a payment intent |
| `cancel_payment_intent` | Cancel a payment intent |
| `create_refund` | Create a full or partial refund |
| `list_subscriptions` | List subscriptions |
| `cancel_subscription` | Cancel a subscription |
| `create_invoice` | Create an invoice |
| `list_invoices` | List invoices |
| `create_product` | Create a product |
| `list_products` | List products |
| `create_price` | Create a price |
| `list_prices` | List prices |
| `retrieve_balance` | Check account balance |

## Database Schema

| Table | Key Columns |
|---|---|
| `customers` | name, email, company, plan, status, mrr_cents, stripe_customer_id |
| `subscriptions` | customer_id, plan, interval, amount_cents, status, period dates |
| `invoices` | customer_id, amount_cents, status, due_date, paid_at |
| `payments` | customer_id, amount_cents, currency, status, payment_method |

**Plans:** starter ($29/mo) | pro ($99/mo) | enterprise ($499/mo)

## Cleanup

```bash
docker compose down -v          # stop PostgreSQL and remove data
npx @mimicai/cli clean --yes    # remove generated blueprints
```
