<p align="center">
  <img src="https://raw.githubusercontent.com/mimicailab/mimic/main/.github/assets/logo.svg" alt="Mimic" width="120" />
</p>

<h1 align="center">Mimic</h1>

<p align="center">
  <strong>One command to simulate every data source your AI agent talks to.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mimicailab/cli"><img src="https://img.shields.io/npm/v/@mimicailab/cli?style=flat-square&color=blue" alt="npm" /></a>
  <a href="https://github.com/mimicailab/mimic/blob/main/LICENSE-APACHE-2.0"><img src="https://img.shields.io/badge/license-Apache%202.0-green?style=flat-square" alt="License" /></a>
  <a href="https://github.com/mimicailab/mimic/stargazers"><img src="https://img.shields.io/github/stars/mimicailab/mimic?style=flat-square" alt="Stars" /></a>
  <a href="https://discord.gg/mimic"><img src="https://img.shields.io/discord/000000000?style=flat-square&label=Discord&color=5865F2" alt="Discord" /></a>
  <a href="https://mimic.dev/docs"><img src="https://img.shields.io/badge/docs-mimic.dev-blueviolet?style=flat-square" alt="Docs" /></a>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#what-is-mimic">What is Mimic?</a> ·
  <a href="#adapters">Adapters</a> ·
  <a href="#mcp-servers">MCP Servers</a> ·
  <a href="https://mimic.dev/docs">Docs</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="https://discord.gg/mimic">Discord</a>
</p>

---

Your AI agent talks to Plaid for bank data, Stripe for payments, Jira for tickets, Slack for messages, and PostgreSQL for everything else. In production, that works. In testing, you're stitching together five different sandboxes with inconsistent data, rate limits, and surprise breaking changes.

Mimic replaces all of that with a single, consistent synthetic environment. One persona generates coherent data across every surface — the same user has the same bank accounts in Plaid, the same payment history in Stripe, the same tickets in Jira, and the same rows in PostgreSQL.

```bash
npx @mimicailab/cli init
npx @mimicailab/cli seed --persona finance-alex
npx @mimicailab/cli host
```

That's it. Your agent now has a fully populated local environment with realistic, cross-surface consistent data — databases seeded, API mocks running, MCP servers ready.

## Quickstart

### Install

```bash
npm install -g @mimicailab/cli
```

### Initialise a project

```bash
mimic init
```

This creates a `.mimic/` directory with a default config. Edit `.mimic/config.yaml` to declare which surfaces your agent uses:

```yaml
# .mimic/config.yaml
persona: finance-alex        # Pre-built persona (ships free)

surfaces:
  databases:
    - adapter: postgres
      connection: postgresql://localhost:5432/testdb

  apis:
    - adapter: plaid
    - adapter: stripe
    - adapter: jira

  mcp:
    - adapter: slack
    - adapter: notion
```

### Seed databases

```bash
mimic seed
```

Populates your PostgreSQL (or MongoDB, MySQL, etc.) with persona-consistent data — users, accounts, transactions, all matching the persona's story.

### Start mock APIs + MCP servers

```bash
mimic host
```

Starts a local Fastify server exposing all your configured API mocks and MCP servers:

```
  ✓ Plaid API        → http://localhost:4000/plaid
  ✓ Stripe API       → http://localhost:4000/stripe/v1
  ✓ Jira API         → http://localhost:4000/jira/rest/api/3
  ✓ Slack MCP        → stdio: npx @mimicailab/mcp-slack
  ✓ Notion MCP       → stdio: npx @mimicailab/mcp-notion
  ✓ Ready in 1.2s
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
| **No MCP testing** | You test MCP servers against… nothing? | Mock MCP servers with realistic tool responses |
| **Brittle tests** | Tests break when sandbox data changes | Deterministic seeding, identical every run |

### How it works

```
                    ┌──────────────────────────────────────┐
                    │           Persona Blueprint          │
                    │    "Alex, 32, fintech PM, $85K,      │
                    │     3 bank accounts, active trader,   │
                    │     Jira power user, Slack daily"     │
                    └──────────────┬───────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────┐
                    │        Blueprint Engine (Pro)         │
                    │   Generates cross-surface consistent  │
                    │   data from persona description       │
                    └──────────────┬───────────────────────┘
                                   │
              ┌────────────┬───────┴──────┬────────────┐
              ▼            ▼              ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
        │PostgreSQL│ │ Plaid    │ │ Stripe   │ │ Jira     │
        │ Adapter  │ │ Adapter  │ │ Adapter  │ │ Adapter  │
        │ (seed)   │ │ (mock)   │ │ (mock)   │ │ (mock)   │
        └──────────┘ └──────────┘ └──────────┘ └──────────┘
              │            │              │            │
              ▼            ▼              ▼            ▼
          Real DB     Mock API       Mock API     Mock API
          seeded     :4000/plaid  :4000/stripe  :4000/jira
```

Pre-built personas ship with the package — no LLM calls needed. Just `mimic seed` and go.

## Adapters

Mimic supports **65+ adapters** across 8 categories, with more added by the community every week.

### Databases

| Adapter | Status | What it does |
|---------|--------|-------------|
| PostgreSQL | ✅ Stable | Seeds tables with persona-consistent rows |
| MongoDB | ✅ Stable | Seeds collections with embedded documents |
| MySQL | ✅ Stable | Seeds tables with relational integrity |
| Pinecone | ✅ Stable | Seeds vector embeddings for RAG testing |
| Redis | ✅ Stable | Seeds key-value pairs, sorted sets, streams |

### API Mocks

<details>
<summary><strong>Fintech / Payments (24 adapters)</strong></summary>

| Adapter | Package | Routes | Key Features |
|---------|---------|--------|-------------|
| Stripe | `@mimicailab/adapter-stripe` | 29 | Payments, customers, subscriptions, invoices, webhooks |
| Plaid | `@mimicailab/adapter-plaid` | 15 | Link flow, accounts, transactions, identity, balance |
| Square | `@mimicailab/adapter-square` | 16 | Payments, orders, customers, catalog, inventory |
| Wise | `@mimicailab/adapter-wise` | 14 | Quotes, transfers, multi-currency, recipients |
| Adyen | `@mimicailab/adapter-adyen` | 12 | Payments, captures, refunds, modifications |
| Coinbase | `@mimicailab/adapter-coinbase` | 12 | Wallets, trades, prices, transfers |
| PayPal | `@mimicailab/adapter-paypal` | 13 | Orders, captures, payouts, disputes |
| Brex | `@mimicailab/adapter-brex` | 10 | Cards, transactions, expenses |
| Ramp | `@mimicailab/adapter-ramp` | 10 | Cards, transactions, receipts |
| Mercury | `@mimicailab/adapter-mercury` | 9 | Accounts, transactions, recipients |
| Moov | `@mimicailab/adapter-moov` | 8 | Wallets, transfers, payment methods |
| GoCardless | `@mimicailab/adapter-gocardless` | 11 | Mandates, payments, subscriptions |
| Dwolla | `@mimicailab/adapter-dwolla` | 10 | Transfers, customers, funding sources |
| Paystack | `@mimicailab/adapter-paystack` | 9 | Transactions, transfers, recipients |
| Flutterwave | `@mimicailab/adapter-flutterwave` | 8 | Charges, transfers, virtual accounts |
| Rapyd | `@mimicailab/adapter-rapyd` | 8 | Payments, wallets, checkouts |
| Marqeta | `@mimicailab/adapter-marqeta` | 12 | Cards, transactions, simulations |
| Lithic | `@mimicailab/adapter-lithic` | 10 | Cards, auth simulations, spend rules |
| Increase | `@mimicailab/adapter-increase` | 11 | ACH, wire, check, real-time payments |
| Column | `@mimicailab/adapter-column` | 9 | Bank accounts, transfers, loans |
| Revolut Business | `@mimicailab/adapter-revolut` | 10 | Accounts, payments, exchanges |
| Airwallex | `@mimicailab/adapter-airwallex` | 9 | Payment intents, beneficiaries, FX |
| Checkout.com | `@mimicailab/adapter-checkoutcom` | 10 | Payments, captures, refunds |
| Paddle | `@mimicailab/adapter-paddle` | 10 | Subscriptions, transactions, prices |

</details>

<details>
<summary><strong>Communication (11 adapters)</strong></summary>

| Adapter | Package | Routes | Key Features |
|---------|---------|--------|-------------|
| Slack | `@mimicailab/adapter-slack` | 19 | Channels, messages, users, reactions, files, threads |
| Twilio | `@mimicailab/adapter-twilio` | 14 | SMS, calls, recordings, conversations |
| SendGrid | `@mimicailab/adapter-sendgrid` | 11 | Emails, contacts, campaigns, stats |
| Discord | `@mimicailab/adapter-discord` | 13 | Guilds, channels, messages, members |
| MS Teams | `@mimicailab/adapter-teams` | 12 | Teams, channels, messages, memberships |
| WhatsApp Business | `@mimicailab/adapter-whatsapp` | 9 | Messages, templates, media |
| Telegram | `@mimicailab/adapter-telegram` | 11 | Messages, updates, webhooks |
| Mailgun | `@mimicailab/adapter-mailgun` | 10 | Messages, events, routes |
| Postmark | `@mimicailab/adapter-postmark` | 9 | Emails, templates, stats |
| Vonage | `@mimicailab/adapter-vonage` | 8 | SMS, voice, verify |
| MessageBird | `@mimicailab/adapter-messagebird` | 7 | Messages, contacts, conversations |

</details>

<details>
<summary><strong>Calendar / Scheduling (6 adapters)</strong></summary>

| Adapter | Package | Routes | Key Features |
|---------|---------|--------|-------------|
| Google Calendar | `@mimicailab/adapter-gcal` | 10 | Events, calendars, attendees, free/busy |
| Calendly | `@mimicailab/adapter-calendly` | 11 | Events, event types, invitees, scheduling |
| Cal.com | `@mimicailab/adapter-calcom` | 12 | Bookings, event types, availability, webhooks |
| Nylas | `@mimicailab/adapter-nylas` | 9 | Events, calendars, availability |
| Cronofy | `@mimicailab/adapter-cronofy` | 10 | Events, calendars, availability, conferencing |
| Acuity | `@mimicailab/adapter-acuity` | 9 | Appointments, calendars, availability |

</details>

<details>
<summary><strong>CRM (7 adapters)</strong></summary>

| Adapter | Package | Routes | Key Features |
|---------|---------|--------|-------------|
| Salesforce | `@mimicailab/adapter-salesforce` | 16 | SOQL, SOSL, records, describe, composite |
| HubSpot | `@mimicailab/adapter-hubspot` | 16 | Contacts, deals, companies, pipelines, search |
| Pipedrive | `@mimicailab/adapter-pipedrive` | 14 | Deals, persons, organizations, activities |
| Zoho CRM | `@mimicailab/adapter-zoho-crm` | 13 | Records, search, COQL, modules |
| Close | `@mimicailab/adapter-close` | 14 | Leads, activities, opportunities, sequences |
| Attio | `@mimicailab/adapter-attio` | 12 | Records, objects, lists, attributes |
| Dynamics 365 | `@mimicailab/adapter-dynamics365` | 11 | OData, entities, metadata, batch |

</details>

<details>
<summary><strong>Ticketing (8 adapters)</strong></summary>

| Adapter | Package | Routes | Key Features |
|---------|---------|--------|-------------|
| Zendesk | `@mimicailab/adapter-zendesk` | 24 | Tickets, comments, search, views, macros |
| Jira | `@mimicailab/adapter-jira` | 21 | Issues, JQL, sprints, boards, transitions |
| Linear | `@mimicailab/adapter-linear` | 20 | Issues, cycles, projects, workflow states |
| Intercom | `@mimicailab/adapter-intercom` | 25 | Conversations, contacts, companies, articles |
| PagerDuty | `@mimicailab/adapter-pagerduty` | 17 | Incidents, on-call, escalation, services |
| Freshdesk | `@mimicailab/adapter-freshdesk` | 18 | Tickets, conversations, contacts, search |
| ServiceNow | `@mimicailab/adapter-servicenow` | 9 | Table API, incidents, catalog items |
| Shortcut | `@mimicailab/adapter-shortcut` | 22 | Stories, epics, iterations, labels |

</details>

<details>
<summary><strong>Project Management (8 adapters)</strong></summary>

| Adapter | Package | Routes | Key Features |
|---------|---------|--------|-------------|
| Notion | `@mimicailab/adapter-notion` | 19 | Pages, databases, query/filter engine, blocks, search |
| Asana | `@mimicailab/adapter-asana` | 22 | Tasks, projects, sections, subtasks, stories |
| Trello | `@mimicailab/adapter-trello` | 23 | Boards, lists, cards, checklists, comments |
| Monday.com | `@mimicailab/adapter-monday` | 19 | Boards, items, column values, groups, updates |
| Airtable | `@mimicailab/adapter-airtable` | 11 | Records, filterByFormula, upsert, tables |
| ClickUp | `@mimicailab/adapter-clickup` | 20 | Tasks, spaces, folders, lists, time tracking |
| Todoist | `@mimicailab/adapter-todoist` | 18 | Tasks, projects, sections, labels, comments |
| Basecamp | `@mimicailab/adapter-basecamp` | 23 | Projects, to-dos, messages, campfire, comments |

</details>

> **Building an adapter?** See the [Adapter Development Guide](docs/ADAPTER_GUIDE.md) and the [@mimicailab/adapter-sdk](packages/oss/adapter-sdk/).

## MCP Servers

Every API mock adapter has a corresponding MCP server, so AI agents using the Model Context Protocol can connect directly:

```json
{
  "mcpServers": {
    "mimic-jira": {
      "command": "npx",
      "args": ["-y", "@mimicailab/mcp-jira"],
      "env": { "MIMIC_BASE_URL": "http://localhost:4000" }
    },
    "mimic-slack": {
      "command": "npx",
      "args": ["-y", "@mimicailab/mcp-slack"],
      "env": { "MIMIC_BASE_URL": "http://localhost:4000" }
    }
  }
}
```

For adapters where an official MCP server exists (Jira, Slack, Asana, HubSpot, GitHub, GitLab), our MCP servers match the exact same tool names and parameter schemas — swap `MIMIC_BASE_URL` for real credentials and your agent code doesn't change.

See the [MCP Server Guide](docs/MCP_GUIDE.md) for the full list and configuration.

## Project Structure

```
mimic/
├── packages/
│   ├── oss/                          # Apache 2.0
│   │   ├── cli/                      # @mimicailab/cli
│   │   ├── adapter-sdk/              # @mimicailab/adapter-sdk
│   │   ├── adapter-postgres/         # Database adapters
│   │   ├── adapter-stripe/           # API mock adapters (65+)
│   │   ├── adapter-jira/
│   │   ├── ...
│   │   ├── mcp-servers/              # MCP server wrappers (65+)
│   │   │   ├── shared/
│   │   │   ├── stripe/
│   │   │   ├── jira/
│   │   │   └── ...
│   │   ├── mock-server/              # Fastify host
│   │   └── blueprints/               # Pre-built persona files
│   └── commercial/                   # Elastic License v2
│       ├── blueprint-engine/         # LLM generation + expander
│       ├── consistency/              # Cross-surface consistency
│       ├── test-advanced/            # LLM-as-judge, CI/CD
│       ├── dashboard/                # Web UI
│       └── enterprise/               # SSO, RBAC, audit
├── examples/
│   ├── finance-agent/
│   ├── support-agent/
│   └── devops-agent/
├── docs/
├── LICENSE-APACHE-2.0
├── LICENSE-ELv2
└── turbo.json
```

## Configuration

### `.mimic/config.yaml`

```yaml
# Persona — use a pre-built or generate custom (Pro)
persona: finance-alex

# Port for the mock server
port: 4000

# Database surfaces
surfaces:
  databases:
    - adapter: postgres
      connection: postgresql://localhost:5432/testdb
      tables:
        - users
        - accounts
        - transactions

  # API mock surfaces
  apis:
    - adapter: plaid
    - adapter: stripe
      config:
        webhookSecret: whsec_test
    - adapter: jira
      config:
        projectKey: MIM

  # MCP server surfaces
  mcp:
    - adapter: slack
      transport: stdio
    - adapter: notion
      transport: stdio
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MIMIC_PORT` | Mock server port | `4000` |
| `MIMIC_PERSONA` | Persona blueprint to use | `finance-alex` |
| `MIMIC_API_KEY` | API key for Pro features | — |
| `MIMIC_LOG_LEVEL` | Logging verbosity | `info` |

## CLI Reference

```
mimic init                    Create a new .mimic/ project
mimic seed                    Seed databases from persona blueprint
mimic host                    Start mock API + MCP servers
mimic test                    Run test scenarios
mimic inspect                 View seeded data across surfaces
mimic clean                   Remove all seeded data
mimic login                   Authenticate for Pro features
mimic generate                Generate custom persona (Pro)
```

## Examples

### Testing a finance agent

```bash
mimic init
mimic seed --persona finance-alex
mimic host &

# Your agent connects to:
#   Plaid    → http://localhost:4000/plaid
#   Stripe   → http://localhost:4000/stripe/v1
#   Postgres → postgresql://localhost:5432/testdb (seeded)

python my_finance_agent.py --test
mimic clean
```

### Testing an MCP-based support agent

```bash
mimic host --adapters jira,slack,zendesk &

# In your Claude/Cursor MCP config:
# {
#   "mcpServers": {
#     "jira":    { "command": "npx", "args": ["-y", "@mimicailab/mcp-jira"] },
#     "slack":   { "command": "npx", "args": ["-y", "@mimicailab/mcp-slack"] },
#     "zendesk": { "command": "npx", "args": ["-y", "@mimicailab/mcp-zendesk"] }
#   }
# }
```

### In CI/CD (GitHub Actions)

```yaml
- name: Start Mimic
  run: |
    npx @mimicailab/cli seed --persona finance-alex
    npx @mimicailab/cli host --background

- name: Run agent tests
  run: npm test
  env:
    PLAID_BASE_URL: http://localhost:4000/plaid
    STRIPE_API_BASE: http://localhost:4000/stripe/v1

- name: Stop Mimic
  run: npx @mimicailab/cli clean
```

## Free vs Pro

Mimic is free to use. The open-source CLI, all adapters, MCP servers, and pre-built personas work without an account. Pro unlocks the Blueprint Engine for custom persona generation.

| | Community (Free) | Pro ($39/seat/mo) |
|---|---|---|
| CLI + all adapters | ✅ | ✅ |
| Pre-built personas | 3 finance | All domains |
| Custom persona generation | 3/month | Unlimited |
| MCP servers | All | All |
| Test runs | 500/month | 25,000/month |
| LLM-powered evaluation | — | ✅ |
| CI/CD integration | — | ✅ |
| Support | GitHub | Email (48hr) |

[See full pricing →](https://mimic.dev/pricing)

## Community

Mimic is built in the open. We welcome contributions of all kinds — new adapters, bug fixes, documentation, and ideas.

- **[Discord](https://discord.gg/mimic)** — Chat with the team and other contributors
- **[GitHub Discussions](https://github.com/mimicailab/mimic/discussions)** — Feature requests and RFCs
- **[Contributing Guide](CONTRIBUTING.md)** — How to contribute
- **[Adapter Guide](docs/ADAPTER_GUIDE.md)** — Build a new adapter
- **[Code of Conduct](CODE_OF_CONDUCT.md)** — Community standards
- **[@mimicailab](https://twitter.com/mimic_data)** — Product updates

## License

Mimic uses a dual-license model:

- **Open-source components** (CLI, adapters, adapter SDK, MCP servers, pre-built personas) are licensed under [Apache 2.0](LICENSE-APACHE-2.0).
- **Commercial components** (Blueprint Engine, advanced test runner, dashboard, enterprise features) are licensed under [Elastic License v2](LICENSE-ELv2).

See [LICENSING.md](LICENSING.md) for the full breakdown and our [Open Source Charter](OPEN_SOURCE_CHARTER.md) for our commitments to the community.

---

<p align="center">
  <sub>Built by <a href="https://github.com/mimicailab">@mimicailab</a>. Star the repo if Mimic helps your team ship better agents. ⭐</sub>
</p>
