<p align="center">
  <img src="https://raw.githubusercontent.com/mimicailab/mimic/main/.github/assets/logo.svg" alt="Mimic" width="120" />
</p>

<h1 align="center">Mimic</h1>

<p align="center">
  <strong>One command to simulate every data source your AI agent talks to.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mimicai/cli"><img src="https://img.shields.io/npm/v/@mimicai/cli?style=flat-square&color=blue" alt="npm" /></a>
  <a href="https://github.com/mimicailab/mimic/blob/main/LICENSE-APACHE-2.0"><img src="https://img.shields.io/badge/license-Apache%202.0-green?style=flat-square" alt="License" /></a>
  <a href="https://github.com/mimicailab/mimic/stargazers"><img src="https://img.shields.io/github/stars/mimicailab/mimic?style=flat-square" alt="Stars" /></a>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#what-is-mimic">What is Mimic?</a> ·
  <a href="#adapters">Adapters</a> ·
  <a href="#mcp-servers">MCP Servers</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

Your AI agent talks to Plaid for bank data, Stripe for payments, Slack for messages, and PostgreSQL for everything else. In production, that works. In testing, you're stitching together different sandboxes with inconsistent data, rate limits, and surprise breaking changes.

Mimic replaces all of that with a single, consistent synthetic environment. One persona generates coherent data across every surface — the same user has the same bank accounts in Plaid, the same payment history in Stripe, and the same rows in PostgreSQL.

```bash
npx @mimicai/cli init
npx @mimicai/cli seed
npx @mimicai/cli host
```

That's it. Your agent now has a fully populated local environment with realistic, cross-surface consistent data — databases seeded, API mocks running, MCP servers ready.

## Quickstart

### Install

```bash
npm install -g @mimicai/cli
```

### Initialise a project

```bash
mimic init
```

This creates a `mimic.json` config file in the current directory. Edit it to declare which surfaces your agent uses:

```json
{
  "domain": "fintech agent testing",
  "personas": [
    {
      "name": "finance-alex",
      "blueprint": "young-professional"
    }
  ],
  "databases": [
    {
      "adapter": "postgres",
      "connectionString": "postgresql://localhost:5432/testdb"
    }
  ],
  "apis": [
    { "adapter": "plaid" },
    { "adapter": "stripe" },
    { "adapter": "slack" }
  ]
}
```

### Generate and seed

```bash
mimic run        # Generate persona blueprint
mimic seed       # Seed databases with persona-consistent data
```

Populates your PostgreSQL (or MongoDB, MySQL, SQLite) with persona-consistent data — users, accounts, transactions, all matching the persona's story.

### Start mock APIs + MCP servers

```bash
mimic host
```

Starts a local server exposing all your configured API mocks and MCP servers:

```
  Plaid API        -> http://localhost:4000/plaid
  Stripe API       -> http://localhost:4000/stripe/v1
  Slack API        -> http://localhost:4000/slack
  MCP Server       -> stdio
  Ready in 1.2s
```

Point your agent at `localhost:4000` instead of production APIs. Everything just works.

### Run tests

```bash
mimic test
```

Execute test scenarios against your mock environment with optional AI-powered evaluation.

## What is Mimic?

Mimic is a **synthetic environment engine** for AI agent development. It solves the core problem every agent team faces: you can't test agents reliably against production APIs, but sandbox environments are incomplete, inconsistent, and unreliable.

### The problem

| Challenge | What happens today | What Mimic does |
|-----------|-------------------|-----------------|
| **Inconsistent data** | Plaid sandbox has user "Jane", Stripe test mode has "test_customer_1", your DB has seed.sql from 2023 | One persona, coherent everywhere |
| **Rate limits & downtime** | Third-party sandboxes throttle you during CI runs | Local mock, zero latency, zero limits |
| **Missing endpoints** | Sandboxes cover 60% of the API surface | Full API coverage with seeded data |
| **No MCP testing** | You test MCP servers against nothing? | Mock MCP servers with realistic tool responses |
| **Brittle tests** | Tests break when sandbox data changes | Deterministic seeding, identical every run |

### How it works

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
        |PostgreSQL| | Plaid    | | Stripe   | | Slack    |
        | Adapter  | | Adapter  | | Adapter  | | Adapter  |
        | (seed)   | | (mock)   | | (mock)   | | (mock)   |
        +----------+ +----------+ +----------+ +----------+
              |            |           |            |
              v            v           v            v
          Real DB     Mock API    Mock API     Mock API
          seeded    :4000/plaid :4000/stripe :4000/slack
```

Pre-built personas ship with the package — no LLM calls needed for basic use. Just `mimic seed` and go.

## Adapters

### Databases

| Adapter | Package | Status |
|---------|---------|--------|
| PostgreSQL | `@mimicai/adapter-postgres` | Stable |
| MongoDB | `@mimicai/adapter-mongodb` | Stable |
| MySQL | `@mimicai/adapter-mysql` | Stable |
| SQLite | `@mimicai/adapter-sqlite` | Stable |

### API Mocks

| Adapter | Package | Key Features |
|---------|---------|-------------|
| Stripe | `@mimicai/adapter-stripe` | Payments, customers, subscriptions, invoices, webhooks |
| Plaid | `@mimicai/adapter-plaid` | Link flow, accounts, transactions, identity, balance |
| Slack | `@mimicai/adapter-slack` | Channels, messages, users, reactions, threads |

> **Building an adapter?** See the [Adapter Development Guide](docs/ADAPTER_GUIDE.md) and the [@mimicai/adapter-sdk](packages/adapter-sdk/).

## MCP Servers

Every API mock adapter includes a built-in MCP server, so AI agents using the Model Context Protocol can connect directly:

```json
{
  "mcpServers": {
    "mimic-stripe": {
      "command": "npx",
      "args": ["-y", "@mimicai/adapter-stripe", "mcp"]
    },
    "mimic-plaid": {
      "command": "npx",
      "args": ["-y", "@mimicai/adapter-plaid", "mcp"]
    }
  }
}
```

## Project Structure

```
mimic/
├── packages/
│   ├── core/                     # @mimicai/core — engine
│   ├── cli/                      # @mimicai/cli — CLI binary
│   ├── blueprints/               # @mimicai/blueprints — pre-built personas
│   ├── adapter-sdk/              # @mimicai/adapter-sdk — adapter toolkit
│   ├── adapters/
│   │   ├── adapter-postgres/     # Database adapters
│   │   ├── adapter-mysql/
│   │   ├── adapter-mongodb/
│   │   ├── adapter-sqlite/
│   │   ├── adapter-stripe/       # API mock adapters
│   │   ├── adapter-plaid/
│   │   └── adapter-slack/
│   └── docs/                     # Documentation site
├── examples/
├── docs/
├── turbo.json
└── pnpm-workspace.yaml
```

## Configuration

### `mimic.json`

```json
{
  "domain": "fintech agent testing",
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-5-20250514"
  },
  "personas": [
    {
      "name": "finance-alex",
      "blueprint": "young-professional"
    }
  ],
  "generate": {
    "volume": 50,
    "seed": 42
  },
  "databases": [
    {
      "adapter": "postgres",
      "connectionString": "postgresql://localhost:5432/testdb",
      "schema": "prisma"
    }
  ],
  "apis": [
    { "adapter": "plaid" },
    { "adapter": "stripe" },
    { "adapter": "slack" }
  ],
  "test": {
    "scenarios": "tests/"
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
mimic clean                   Remove all seeded data
mimic adapters                Manage API mock adapters
```

## Examples

### Testing a finance agent

```bash
mimic init
mimic run
mimic seed
mimic host &

# Your agent connects to:
#   Plaid    -> http://localhost:4000/plaid
#   Stripe   -> http://localhost:4000/stripe/v1
#   Postgres -> postgresql://localhost:5432/testdb (seeded)

python my_finance_agent.py --test
mimic clean
```

### In CI/CD (GitHub Actions)

```yaml
- name: Start Mimic
  run: |
    npx @mimicai/cli seed
    npx @mimicai/cli host --background

- name: Run agent tests
  run: npm test
  env:
    PLAID_BASE_URL: http://localhost:4000/plaid
    STRIPE_API_BASE: http://localhost:4000/stripe/v1

- name: Stop Mimic
  run: npx @mimicai/cli clean
```

## Packages

| Package | Description |
|---------|-------------|
| [`@mimicai/core`](packages/core/) | Engine — schema parsing, generation, seeding, MCP server, test runner |
| [`@mimicai/cli`](packages/cli/) | CLI binary with 8 commands |
| [`@mimicai/blueprints`](packages/blueprints/) | Pre-built persona blueprints |
| [`@mimicai/adapter-sdk`](packages/adapter-sdk/) | SDK for building custom adapters |
| [`@mimicai/adapter-postgres`](packages/adapters/adapter-postgres/) | PostgreSQL database seeder |
| [`@mimicai/adapter-mysql`](packages/adapters/adapter-mysql/) | MySQL database seeder |
| [`@mimicai/adapter-mongodb`](packages/adapters/adapter-mongodb/) | MongoDB database seeder |
| [`@mimicai/adapter-sqlite`](packages/adapters/adapter-sqlite/) | SQLite database seeder |
| [`@mimicai/adapter-stripe`](packages/adapters/adapter-stripe/) | Stripe API mock + MCP server |
| [`@mimicai/adapter-plaid`](packages/adapters/adapter-plaid/) | Plaid API mock + MCP server |
| [`@mimicai/adapter-slack`](packages/adapters/adapter-slack/) | Slack API mock + MCP server |

## Community

We welcome contributions — new adapters, bug fixes, documentation, and ideas.

- **[GitHub Issues](https://github.com/mimicailab/mimic/issues)** — Bug reports and feature requests
- **[Contributing Guide](CONTRIBUTING.md)** — How to contribute
- **[Adapter Guide](docs/ADAPTER_GUIDE.md)** — Build a new adapter

## License

Licensed under [Apache 2.0](LICENSE-APACHE-2.0).

---

<p align="center">
  <sub>Built by <a href="https://github.com/mimicailab">@mimicailab</a></sub>
</p>
