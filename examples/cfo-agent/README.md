# CFO Agent Example

A conversational CFO assistant for a growth-stage SaaS company, powered by [Mimic](https://github.com/mimicailab/mimic) synthetic data, [LangChain](https://js.langchain.com) + [LangGraph](https://langchain-ai.github.io/langgraphjs/), and a lightweight Next.js chat UI.

The agent reasons across **8 billing platforms plus a PostgreSQL product database** and answers through a **supervisor + sub-agent** architecture.

## Architecture

```text
Browser (localhost:3000)
  └─ Next.js UI → POST /api/chat
       └─ UI stream translator
            └─ CFO agent server (localhost:3003)
                 └─ Supervisor agent
                      ├─ query_postgres
                      ├─ query_stripe
                      ├─ query_paddle
                      ├─ query_chargebee
                      ├─ query_gocardless
                      ├─ query_revenuecat
                      ├─ query_lemonsqueezy
                      ├─ query_zuora
                      └─ query_recurly

mimic host (started separately)
  ├─ postgres MCP      :4201
  ├─ stripe API :4101  | MCP :4202
  ├─ paddle API :4102  | MCP :4203
  ├─ chargebee API:4103| MCP :4204
  ├─ gocardless API:4104| MCP :4205
  ├─ revenuecat API:4105| MCP :4206
  ├─ lemonsqueezy API:4106| MCP :4207
  ├─ zuora API :4107   | MCP :4208
  └─ recurly API :4108 | MCP :4209

PostgreSQL
  └─ localhost:5435 / mimic_cfo
```

### Important runtime notes

- The agent **does not** spawn `mimic host` internally. Start `mimic host` yourself before starting the agent.
- With multiple servers enabled, `mimic host` uses **SSE MCP**, not stdio.
- The agent is currently **stateless across requests** except for the `messages` array the UI sends with each turn. There is no `MemorySaver` or persistent checkpointer in this example.
- The UI proxies the agent's `0:/d:` stream format into AI SDK v6 SSE for `useChat`.

For a deeper architecture walkthrough, see `ARCHITECTURE.md`.

## Prerequisites

- Node.js `>=22`
- `pnpm` for rebuilding workspace packages
- Docker for PostgreSQL
- One model provider key:
  - `OPENAI_API_KEY` for OpenAI models (default: gpt-5.4), or
  - `ANTHROPIC_API_KEY` for Claude models

## Quick Start

### 1. Start PostgreSQL

```bash
docker compose up -d
```

This starts PostgreSQL 17 on port `5435` with:

- database: `mimic_cfo`
- user: `mimic`
- password: `mimic`

### 2. Configure environment

```bash
cp .env.example .env
# Add OPENAI_API_KEY (required for data generation with gpt-5.4)
# Optionally add ANTHROPIC_API_KEY for the agent
```

### 3. Generate Prisma client and run the schema

```bash
export $(cat .env | xargs)
npx prisma generate
npx prisma migrate dev --name init
```

### 4. Generate synthetic data and seed PostgreSQL

From the `examples/cfo-agent` root:

```bash
pnpm exec mimic run -g        # generate blueprints + expand + generate facts
pnpm exec mimic seed --verbose # push DB tables into PostgreSQL
```

The `-g` flag forces fresh blueprint generation. Without it, cached blueprints under `.mimic/blueprints/` are reused and only expansion runs.

After expansion, Mimic makes an additional LLM call to **generate facts from the actual data** — these are testable assertions (counts, statuses, amounts) that are guaranteed to match the expanded dataset. Facts are written to `.mimic/fact-manifest.json`.

Generated artifacts are written under:

- `.mimic/blueprints/` — cached LLM blueprint output
- `.mimic/data/` — expanded persona data (DB rows + API responses)
- `.mimic/fact-manifest.json` — testable facts derived from actual data

`mimic seed` writes the `tables` section of the generated dataset into PostgreSQL. Adapter API data stays in `.mimic/data/*.json` and is loaded by `mimic host` at runtime.

### 5. Explore the data (optional)

```bash
pnpm exec mimic explore
```

Opens an interactive UI at `http://localhost:7879` showing all adapters, endpoint counts, persona data, and facts.

### 6. Start `mimic host`

In a new terminal, from the `examples/cfo-agent` root:

```bash
export $(cat .env | xargs)
pnpm exec mimic host
```

You should see all 9 MCP servers come up:

```text
primary      MCP :4201
stripe       API :4101 | MCP :4202
paddle       API :4102 | MCP :4203
chargebee    API :4103 | MCP :4204
gocardless   API :4104 | MCP :4205
revenuecat   API :4105 | MCP :4206
lemonsqueezy API :4106 | MCP :4207
zuora        API :4107 | MCP :4208
recurly      API :4108 | MCP :4209
```

### 7. Start the agent

In another terminal:

```bash
cd agent
npm install
export $(cat ../.env | xargs)
npm start
```

The agent listens on `http://localhost:3003` and connects to the MCP servers started by `mimic host`.

Current behavior:

- defaults to `claude-sonnet-4-6` if `ANTHROPIC_API_KEY` is present
- otherwise falls back to `gpt-4o` if `OPENAI_API_KEY` is present
- remaps `gpt-5-chat-latest` to `gpt-4o` for compatibility with this setup

### 8. Start the UI

In a third terminal:

```bash
cd ui
npm install
npm run dev
```

Open `http://localhost:3000`.

If Turbopack cache errors appear after switching branches or rebuilding packages, clear the UI cache and restart:

```bash
rm -rf ui/.next
```

## Local Development After Package Changes

If you edit code under `packages/` such as an adapter or the CLI, rebuild the affected workspace packages before restarting the example:

```bash
pnpm --filter @mimicai/adapter-revenuecat build
pnpm --filter @mimicai/cli build
```

In general, after changing adapter or CLI source:

1. rebuild the changed packages with `pnpm`
2. restart `mimic host`
3. restart the agent
4. restart the UI if needed

## Demo Questions

Click a suggestion or type your own. Useful examples:

- `What's our MRR right now?`
- `Give me the full picture for my investor meeting`
- `Why is our money down this week?`
- `Are we going to hit £150k MRR by June?`
- `Are any customers paying for a plan they're not using?`
- `Give me an honest picture before the board meeting`

## Configuration

### `mimic.json`

Controls which platforms are mocked and exposed over MCP:

```jsonc
{
  "apis": {
    "stripe":       { "enabled": true, "mcp": true },
    "paddle":       { "enabled": true, "mcp": true },
    "chargebee":    { "enabled": true, "mcp": true },
    "gocardless":   { "enabled": true, "mcp": true },
    "revenuecat":   { "enabled": true, "mcp": true },
    "lemonsqueezy": { "enabled": true, "mcp": true },
    "zuora":        { "enabled": true, "mcp": true },
    "recurly":      { "enabled": true, "mcp": true }
  }
}
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://mimic:mimic@localhost:5435/mimic_cfo` | PostgreSQL connection |
| `ANTHROPIC_API_KEY` | optional | Used when running Claude models |
| `OPENAI_API_KEY` | optional | Used when running OpenAI models |
| `MODEL` | `claude-sonnet-4-6` if Anthropic key exists, else `gpt-4o` | Agent model |
| `PORT` | `3003` | Agent server port |
| `MCP_BASE_PORT` | `4201` | First MCP port the agent expects |

UI:

| Variable | Default | Description |
|---|---|---|
| `AGENT_URL` | `http://localhost:3003` | Agent server URL used by the Next.js proxy |

## Data Model

The PostgreSQL schema includes:

| Table | Key Columns |
|---|---|
| `users` | email, plan, status, billing_platform, external_id, mrr_cents, last_login_at |
| `events` | user_id, event_type, properties, created_at |
| `usage_metrics` | user_id, period (YYYY-MM), api_calls, seats_used, storage_gb, exports |
| `feature_flags` | user_id, flag_name, enabled |

The `billing_platform` and `external_id` columns let the agent reconcile product-side records against billing platforms.

## Operational Checks

Useful local checks:

```bash
# Agent health
curl http://localhost:3003/health

# Example live adapter check
curl -H "Authorization: Bearer sk_test_growth-saas_demo" \
  "http://localhost:4101/stripe/v1/customers?limit=2"
```

## Cleanup

```bash
docker compose down -v
pnpm exec mimic clean --yes
rm -rf ui/.next
```
