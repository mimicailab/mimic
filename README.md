<p align="center">
  <img src="https://raw.githubusercontent.com/mimicailab/mimic/main/.github/assets/logo.svg" alt="Mimic" width="120" />
</p>

<h1 align="center">Mimic</h1>

<p align="center">
  <strong>Test your AI agents against the real world.</strong>
</p>

<p align="center">
  Simulate APIs, databases, MCP servers, and user personas. Deterministic. Offline. Open source.
</p>

<p align="center">
  <a href="https://github.com/mimicailab/mimic/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/mimicailab/mimic/ci.yml?branch=main&style=flat-square&label=build" alt="Build" /></a>
  <a href="https://www.npmjs.com/package/@mimicai/cli"><img src="https://img.shields.io/npm/v/@mimicai/cli?style=flat-square&color=blue" alt="npm" /></a>
  <a href="https://github.com/mimicailab/mimic/blob/main/LICENSE-APACHE-2.0"><img src="https://img.shields.io/badge/license-Apache%202.0-green?style=flat-square" alt="License" /></a>
  <a href="https://github.com/mimicailab/mimic/stargazers"><img src="https://img.shields.io/github/stars/mimicailab/mimic?style=flat-square" alt="Stars" /></a>
  <a href="https://discord.gg/AjCpk7n2"><img src="https://img.shields.io/badge/discord-join-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord" /></a>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#the-problem">The Problem</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#adapters">Adapters</a> ·
  <a href="#mcp-servers">MCP Servers</a> ·
  <a href="#flagship-example">Flagship Example</a> ·
  <a href="#cicd">CI/CD</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

Your AI agent talks to Plaid for bank data, Stripe for payments, Slack for messages, and PostgreSQL for everything else. In production, that works. In testing, you're stitching together different sandboxes with inconsistent data, rate limits, and surprise breaking changes.

Mimic replaces all of that with a single, consistent synthetic environment. One persona generates coherent data across every surface — the same user has the same bank accounts in Plaid, the same payment history in Stripe, and the same rows in PostgreSQL.

```bash
npm install -g @mimicai/cli
```

```bash
mimic init
mimic run
mimic seed
mimic host
```

That's it. Your agent now has a fully populated local environment with realistic, cross-surface consistent data — databases seeded, API mocks running, MCP servers ready.

## The Problem

| Challenge | What Mimic does |
|-----------|-----------------|
| Three APIs, three fake users, zero consistency | One persona. Consistent across every system. |
| Third-party sandboxes throttle your CI tests | Local mocks. Zero latency. No rate limits. |
| Most sandboxes only cover part of the API | Full API coverage with realistic test data. |
| Sandbox data changes and tests start failing | Deterministic seeding. Identical every run. |
| MCP servers have no real environment to test | Mock MCP servers with realistic tool responses. |

## How It Works

```
1. Configure    Declare APIs, databases, and MCP servers. Mimic reads your real schema.
       |
       v
2. Generate     LLM generates persona blueprints and expands them into realistic rows.
       |
       v
3. Seed         Push generated data to your configured databases. Atomic, idempotent, and fast.
       |
       v
4. Host         Start API mocks and MCP servers locally. One server per adapter, auto-configured transport.
```

```
                    +--------------------------------------+
                    |           Persona Blueprint          |
                    |    "Alex, 32, fintech PM, $85K,      |
                    |     3 bank accounts, active trader"   |
                    +------------------+-------------------+
                                       |
                                       v
              +------------+-------+--------+------------+
              v            v       v        v            v
        +----------+ +----------+ +----------+ +----------+
        |PostgreSQL| | Plaid    | | Stripe   | | Paddle   |
        | Adapter  | | Adapter  | | Adapter  | | Adapter  |
        | (seed)   | | (mock)   | | (mock)   | | (mock)   |
        +----------+ +----------+ +----------+ +----------+
              |            |           |            |
              v            v           v            v
          Real DB     Mock API    Mock API     Mock API
          seeded    :4100/plaid :4100/stripe :4100/paddle
                           |
                           v
                    Unified MCP Server
                  (database + API tools)
```

Pre-built personas ship with the package — no LLM calls, no API keys, no internet needed. For custom domains, Mimic uses an LLM to generate realistic persona blueprints and API mock data.

## Quickstart

### Configure

```bash
mimic init
```

This creates a `mimic.json` config file. Edit it to declare which surfaces your agent uses:

```json
{
  "domain": "fintech agent testing",
  "personas": [
    {
      "name": "finance-alex",
      "blueprint": "young-professional"
    }
  ],
  "databases": {
    "primary": {
      "type": "postgres",
      "url": "$DATABASE_URL",
      "schema": { "source": "prisma", "path": "./prisma/schema.prisma" }
    }
  },
  "apis": {
    "stripe": { "enabled": true, "mcp": true },
    "plaid": { "enabled": true, "mcp": true }
  }
}
```

### Generate and seed

```bash
mimic run        # Generate persona blueprint + API mock data
mimic seed       # Seed databases with persona-consistent data
```

Populates your PostgreSQL (or MongoDB, MySQL, SQLite) with persona-consistent data — users, accounts, transactions, all matching the persona's story.

### Host

```bash
mimic host
```

Starts mock API servers and MCP servers for all configured adapters:

```
  Stripe API     -> http://localhost:4101/stripe/v1
  Stripe MCP     -> http://localhost:4201/mcp
  Plaid API      -> http://localhost:4102/plaid
  Plaid MCP      -> http://localhost:4202/mcp
```

When `mcp: true` is set on an API adapter, its MCP server is started alongside the mock API server. Each adapter gets its own MCP server with tools matching the real platform's MCP interface.

### Test

```bash
mimic test
```

Execute test scenarios against your mock environment with optional AI-powered evaluation.

## Features

- **Cross-surface consistency** — One persona generates consistent data across databases, APIs, and MCP servers
- **Deterministic seeding** — Same seed + same persona = identical data every run. No flaky tests.
- **High-performance seeding** — FK-aware ordering and atomic transactions
- **Offline by default** — Pre-built personas ship with the package. No LLM calls, no API keys, no internet needed.
- **Schema-first** — Reads Prisma schemas, SQL DDL, or introspects live databases
- **Open source** — CLI, adapters, MCP servers, and personas are Apache 2.0 licensed

## Adapters

### Databases

| Adapter | Package | Status |
|---------|---------|--------|
| PostgreSQL | `@mimicai/adapter-postgres` | Stable |
| MongoDB | `@mimicai/adapter-mongodb` | Stable |
| MySQL | `@mimicai/adapter-mysql` | Stable |
| SQLite | `@mimicai/adapter-sqlite` | Stable |

### API Mocks

| Adapter | Package | Status |
|---------|---------|--------|
| Stripe | `@mimicai/adapter-stripe` | Stable |
| Plaid | `@mimicai/adapter-plaid` | Stable |
| Paddle | `@mimicai/adapter-paddle` | Stable |
| Chargebee | `@mimicai/adapter-chargebee` | Stable |
| GoCardless | `@mimicai/adapter-gocardless` | Stable |
| Recurly | `@mimicai/adapter-recurly` | Stable |
| RevenueCat | `@mimicai/adapter-revenuecat` | Stable |
| Lemon Squeezy | `@mimicai/adapter-lemonsqueezy` | Stable |
| Zuora | `@mimicai/adapter-zuora` | Stable |

100+ more adapters are on the roadmap across fintech, communication, CRM, ticketing, project management, and more. See the [full roadmap on our website](https://mimicai.co/#adapters).

> **Building an adapter?** See the [Adapter Development Guide](docs/ADAPTER_GUIDE.md) and the [@mimicai/adapter-sdk](packages/adapter-sdk/).

## MCP Servers

10,000+ MCP servers exist in the wild. Almost none have standardized testing infrastructure. Until now.

`mimic host` starts a mock API server and an MCP server for each configured adapter. When multiple adapters are configured, each gets its own MCP server on sequential ports.

- **Database tools** — auto-generated from your schema (`get_customers`, `get_invoices_summary`, etc.)
- **API adapter tools** — registered when `mcp: true` is set (`create_customer`, `list_subscriptions`, `retrieve_balance`, etc.)

**Drop-in compatible** — same tool names, same schemas. Swap the URL, not the code. Your agent code stays unchanged.

**Works everywhere** — Claude Code, Cursor, VS Code Copilot, or any MCP-compatible runtime.

```
$ mimic host

✓ Stripe API    → http://localhost:4101/stripe/v1
✓ Stripe MCP    → http://localhost:4201/mcp
✓ Plaid API     → http://localhost:4102/plaid
✓ Plaid MCP     → http://localhost:4202/mcp
✓ Ready in 1.4s
```

Transport is auto-detected: **stdio** when a single server is configured, **Streamable HTTP** when multiple servers are running.

### Claude Code / Cursor / VS Code

Each API adapter can run as a standalone MCP server:

```json
{
  "mcpServers": {
    "mimic-stripe": {
      "command": "npx",
      "args": ["-y", "@mimicai/adapter-stripe", "mcp"],
      "env": { "MIMIC_BASE_URL": "http://localhost:4100" }
    },
    "mimic-plaid": {
      "command": "npx",
      "args": ["-y", "@mimicai/adapter-plaid", "mcp"],
      "env": { "MIMIC_BASE_URL": "http://localhost:4100" }
    }
  }
}
```

Or add via Claude Code CLI:

```bash
claude mcp add mimic-stripe -- npx -y @mimicai/adapter-stripe mcp
```

## Flagship Example

### CFO Agent — 8 billing platforms, one AI

A LangGraph supervisor agent that queries 8 billing platforms simultaneously alongside a PostgreSQL database through 9 live MCP servers, with a Next.js chat UI.

- **8 billing platforms** — Stripe, Paddle, Chargebee, GoCardless, RevenueCat, Lemon Squeezy, Zuora, Recurly
- **9 MCP servers** — one per adapter + database tools
- **1 persona** — 6 months of generated data
- **Next.js UI** included

```bash
cd examples/cfo-agent
docker compose up -d
mimic run && mimic seed && mimic host
```

> See [examples/cfo-agent](examples/cfo-agent/) for the full setup.

### More Examples

| Example | Description |
|---------|-------------|
| [billing-agent](examples/billing-agent/) | SaaS billing agent with PostgreSQL + Stripe mock, Next.js chat UI, 25 MCP tools |
| [cfo-agent](examples/cfo-agent/) | CFO agent with 8 billing platforms, 9 MCP servers, LangGraph supervisor |
| [budget-agent](examples/budget-agent/) | Budget management agent |
| [finance-assistant](examples/finance-assistant/) | Personal finance assistant |
| [stripe-explorer](examples/stripe-explorer/) | Stripe data exploration |
| [payments-monitor](examples/payments-monitor/) | Payments monitoring agent |
| [fintech-multi-db](examples/fintech-multi-db/) | Multi-database fintech setup |
| [blog-mongodb](examples/blog-mongodb/) | Blog with MongoDB seeding |
| [ecommerce-mysql](examples/ecommerce-mysql/) | E-commerce with MySQL seeding |
| [meeting-notes](examples/meeting-notes/) | Meeting notes agent |
| [tasks-sqlite](examples/tasks-sqlite/) | Task management agent with SQLite, streaming chat UI |

## CI/CD

Same persona + same seed = identical environment in every CI run. No external dependencies.

```yaml
# .github/workflows/agent-tests.yml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Start Mimic
        run: |
          npm install -g @mimicai/cli
          mimic run
          mimic seed
          mimic host &

      - name: Run agent tests
        run: npm test
        env:
          STRIPE_API_URL: http://localhost:4100/stripe/v1
          PLAID_API_URL: http://localhost:4100/plaid

      - name: Cleanup
        if: always()
        run: mimic clean
```

## Configuration

### `mimic.json`

```json
{
  "domain": "SaaS billing and subscription management",
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6"
  },
  "personas": [
    {
      "name": "growth-startup",
      "description": "Fast-growing startup with 50 customers across 3 tiers"
    }
  ],
  "generate": {
    "volume": "6 months",
    "seed": 42
  },
  "databases": {
    "primary": {
      "type": "postgres",
      "url": "$DATABASE_URL",
      "schema": { "source": "prisma", "path": "./prisma/schema.prisma" },
      "seedStrategy": "truncate-and-insert"
    }
  },
  "apis": {
    "stripe": { "enabled": true, "mcp": true }
  }
}
```

## CLI Reference

```
mimic init                    Create a new mimic.json project config
mimic run                     Generate blueprints and expand persona data
mimic seed                    Seed databases from persona blueprint
mimic host                    Start mock API + MCP servers
mimic test                    Run test scenarios
mimic inspect                 View schema, data, or blueprint information
mimic explore                 Interactive data explorer daemon
mimic clean                   Remove all seeded data
mimic adapters                Manage API mock adapters
mimic info                    Print environment info for bug reports
```

## Packages

| Package | Description |
|---------|-------------|
| [`@mimicai/core`](packages/core/) | Engine — schema parsing, generation, seeding, MCP server, test runner |
| [`@mimicai/cli`](packages/cli/) | CLI binary with 9 commands |
| [`@mimicai/blueprints`](packages/blueprints/) | Pre-built persona blueprints |
| [`@mimicai/adapter-sdk`](packages/adapter-sdk/) | SDK for building custom adapters |
| [`@mimicai/adapter-postgres`](packages/adapters/adapter-postgres/) | PostgreSQL database seeder |
| [`@mimicai/adapter-mysql`](packages/adapters/adapter-mysql/) | MySQL database seeder |
| [`@mimicai/adapter-mongodb`](packages/adapters/adapter-mongodb/) | MongoDB database seeder |
| [`@mimicai/adapter-sqlite`](packages/adapters/adapter-sqlite/) | SQLite database seeder |
| [`@mimicai/adapter-stripe`](packages/adapters/adapter-stripe/) | Stripe API mock + MCP server |
| [`@mimicai/adapter-plaid`](packages/adapters/adapter-plaid/) | Plaid API mock + MCP server |
| [`@mimicai/adapter-paddle`](packages/adapters/adapter-paddle/) | Paddle API mock + MCP server |
| [`@mimicai/adapter-chargebee`](packages/adapters/adapter-chargebee/) | Chargebee API mock + MCP server |
| [`@mimicai/adapter-gocardless`](packages/adapters/adapter-gocardless/) | GoCardless API mock + MCP server |
| [`@mimicai/adapter-recurly`](packages/adapters/adapter-recurly/) | Recurly API mock + MCP server |
| [`@mimicai/adapter-revenuecat`](packages/adapters/adapter-revenuecat/) | RevenueCat API mock + MCP server |
| [`@mimicai/adapter-lemonsqueezy`](packages/adapters/adapter-lemonsqueezy/) | Lemon Squeezy API mock + MCP server |
| [`@mimicai/adapter-zuora`](packages/adapters/adapter-zuora/) | Zuora API mock + MCP server |

## Community

We welcome contributions — new adapters, bug fixes, documentation, and ideas.

- **[GitHub Issues](https://github.com/mimicailab/mimic/issues)** — Bug reports and feature requests
- **[Discord](https://discord.gg/AjCpk7n2)** — Join the community
- **[Contributing Guide](CONTRIBUTING.md)** — How to contribute
- **[Adapter Guide](docs/ADAPTER_GUIDE.md)** — Build a new adapter

## License

Licensed under [Apache 2.0](LICENSE-APACHE-2.0).

---

<p align="center">
  <sub>Built by <a href="https://github.com/mimicailab">@mimicailab</a></sub>
</p>
