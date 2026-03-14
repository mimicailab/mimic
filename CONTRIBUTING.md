# Contributing to Mimic

Thanks for your interest in contributing to Mimic. Whether you're fixing a typo, building an adapter for a platform you use, or proposing a major feature — we're glad you're here.

This guide covers everything you need to get started.

## Ways to Contribute

**No contribution is too small.** Fixing a broken link in the docs is just as valuable as building a new adapter. Here's where help is most needed:

- **New adapters** — Mock a platform that Mimic doesn't support yet. This is the highest-impact contribution. See the [Adapter Development Guide](docs/ADAPTER_GUIDE.md).
- **MCP servers** — Add or improve MCP server wrappers for existing adapters. See [docs/MCP_GUIDE.md](docs/MCP_GUIDE.md).
- **Bug fixes** — Found something broken? Check [open issues](https://github.com/mimicailab/mimic/issues) or file a new one.
- **Documentation** — Improve guides, add examples, fix typos.
- **Test coverage** — Add tests for adapters, CLI commands, or the mock server.
- **Feature proposals** — Open a [Discussion](https://github.com/mimicailab/mimic/discussions) to propose new features or architectural changes.

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+ (`npm install -g pnpm`)
- Docker (optional, for database adapter testing)

### Setup

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/mimic.git
cd mimic

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

### Project Layout

```
packages/
  core/                   # Engine: types, schema, generate, seed, MCP, test, LLM, adapter, utils
  cli/                    # CLI binary with 8 commands (init, run, seed, host, test, inspect, clean, adapters)
  adapter-sdk/            # Base classes and helpers for building adapters
  blueprints/             # Pre-built persona files (JSON)
  adapters/
    adapter-postgres/     # PostgreSQL database adapter
    adapter-mysql/        # MySQL database adapter
    adapter-sqlite/       # SQLite database adapter
    adapter-mongodb/      # MongoDB database adapter
    adapter-stripe/       # Stripe API mock adapter (with MCP server)
    adapter-plaid/        # Plaid API mock adapter (with MCP server)
    adapter-paddle/       # Paddle API mock adapter (with MCP server)
    adapter-chargebee/    # Chargebee API mock adapter (with MCP server)
    adapter-gocardless/   # GoCardless API mock adapter (with MCP server)
    adapter-lemonsqueezy/ # Lemon Squeezy API mock adapter (with MCP server)
    adapter-recurly/      # Recurly API mock adapter (with MCP server)
    adapter-revenuecat/   # RevenueCat API mock adapter (with MCP server)
    adapter-zuora/        # Zuora API mock adapter (with MCP server)
  docs/                   # Astro documentation site
examples/                 # Example projects using Mimic
docs/                     # Architecture and guide documents
```

### Development Workflow

```bash
# Run a specific adapter's tests
pnpm --filter @mimicai/adapter-stripe test

# Run all tests
pnpm test

# Lint everything
pnpm lint

# Type-check
pnpm typecheck
```

## Building an Adapter

This is the most common and highest-impact contribution. Each adapter mocks a single platform's API surface.

### Quick version

Create a new adapter directory under `packages/adapters/`:

```
packages/adapters/adapter-my-platform/
├── src/
│   ├── my-platform-adapter.ts    # Adapter class extending BaseApiMockAdapter
│   ├── config.ts                 # Zod config schema
│   ├── index.ts                  # Exports & manifest
│   ├── bin/
│   │   └── mcp.ts                # MCP server entry point
│   └── __tests__/
│       └── my-platform-adapter.test.ts
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── README.md
```

Use `adapter-stripe` as a reference implementation.

### Detailed guide

See [docs/ADAPTER_GUIDE.md](docs/ADAPTER_GUIDE.md) for the full walkthrough, including:

- Choosing which endpoints to mock
- Implementing authentication patterns
- Building realistic seed data
- Matching real API response shapes
- Writing adapter tests
- Submitting for review

### Adapter quality bar

For an adapter to be merged into the main repo and published as `@mimicai/adapter-*`, it must meet these standards:

1. **Minimum 8 routes** covering core CRUD operations for the platform's primary resources
2. **Realistic seed data** — at least 3-5 seeded records per primary resource, with realistic field values
3. **Correct response shapes** — responses must match the real API's structure (wrapped objects, pagination, error formats)
4. **Authentication pattern** — implement the platform's auth style (Bearer, Basic, API key, etc.)
5. **TypeScript** — all adapters are written in TypeScript with strict mode
6. **Tests** — at least one integration test per route group (list, create, get, update), using `buildTestServer` from `@mimicai/adapter-sdk`
7. **README** — document the adapter's endpoints, auth pattern, seed data, and any quirks

Community adapters that don't meet this bar can still be published as independent npm packages using the adapter SDK.

## Pull Request Process

1. **Fork the repo** and create a branch from `main`:
   ```bash
   git checkout -b feat/adapter-hubspot
   ```

2. **Make your changes.** Follow existing patterns in the codebase. Look at `adapter-stripe` as the reference implementation.

3. **Write tests.** Run them locally:
   ```bash
   pnpm test
   ```

4. **Lint and type-check:**
   ```bash
   pnpm lint
   pnpm typecheck
   ```

5. **Commit with a clear message:**
   ```
   feat(adapter): add HubSpot CRM adapter

   - 16 routes covering contacts, deals, companies, pipelines
   - Search via POST /crm/v3/objects/search
   - Pipeline stages with deal amount aggregation
   - Seeded with 4 contacts, 3 deals, 2 companies
   ```

   We follow [Conventional Commits](https://www.conventionalcommits.org/). Prefixes: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`.

6. **Open a PR** against `main`. Fill in the PR template. Link any related issues.

7. **Review.** A maintainer will review within 48 hours. We may ask for changes — this is collaborative, not adversarial. We want your code to ship.

## Adapter Contribution Recognition

Every adapter contribution gets:

- Social media shoutout on [@mimicailab](https://twitter.com/mimic_data)
- "Mimic Adapter Author" badge on your GitHub profile (via org invitation)
- Free Pro tier for the duration you actively maintain the adapter

For premium adapters (complex, high-demand platforms), we offer a **70/30 revenue share** in your favour through the Mimic marketplace.

## Reporting Issues

When filing an issue, please include:

- **What you expected** vs **what happened**
- **Steps to reproduce** (minimal example preferred)
- **Environment** — OS, Node version, Mimic version (`mimic --version`)
- **Adapter** — which adapter(s) are involved, if applicable

Use the issue templates when possible. They help us triage faster.

## Proposing Features

For feature requests and architectural proposals, open a [GitHub Discussion](https://github.com/mimicailab/mimic/discussions) first. This lets the community weigh in before implementation work begins. For larger changes, we'll ask for an RFC (a short markdown doc in `docs/rfcs/`).

## Code Style

- TypeScript strict mode, always
- Prettier for formatting (runs on save and in CI)
- ESLint with our shared config
- No `any` unless genuinely unavoidable (and add a comment explaining why)
- Prefer explicit types over inference for function signatures
- Use `zod` for runtime validation of external inputs

## License

By contributing to Mimic, you agree that your contributions will be licensed under [Apache 2.0](LICENSE-APACHE-2.0).

We require a Contributor License Agreement (CLA) for all contributions. The CLA bot will prompt you on your first PR — it's a one-time click.

## Questions?

- **Discord** — [discord.gg/mimic](https://discord.gg/mimic) for real-time chat
- **GitHub Discussions** — for longer-form questions
- **Email** — hello@mimic.dev for anything else

Welcome to the community. We're building something meaningful here, and we're glad you're part of it.
