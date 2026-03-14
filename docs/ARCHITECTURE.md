# Architecture

This document describes Mimic's internal architecture. It's aimed at contributors and anyone who wants to understand how the pieces fit together.

## System Overview

```
+-------------------------------------------------------------+
|                         CLI Layer                             |
|   mimic init | mimic run | mimic seed | mimic host | test    |
+-----------------------------+-------------------------------+
                              |
             +----------------+----------------+
             |                |                |
             v                v                v
+------------------+ +------------------+ +------------------+
|  Blueprint Layer | |   Mock Server    | |   Test Runner    |
|                  | |                  | |                  |
| Persona loading  | | Fastify instance | | Scenario engine  |
| LLM generation   | | Adapter registry | | LLM-as-judge    |
| Expander         | | Request routing  | | Evaluation       |
|                  | | State store      | |                  |
+--------+---------+ +--------+---------+ +------------------+
         |                    |
         |           +-------+-------+
         |           |               |
         v           v               v
+--------------+ +----------+ +----------+
|   Database   | | API Mock | |   MCP    |
|  Adapters    | | Adapters | | Servers  |
|              | |          | |          |
| PostgreSQL   | | Stripe   | | Built-in |
| MongoDB      | | Plaid    | | per      |
| MySQL        | | Paddle   | | adapter  |
| SQLite       | | + 6 more | |          |
+--------------+ +----------+ +----------+
```

## Core Concepts

### Personas and Blueprints

A **persona** is a fictional identity with a coherent life story. A **blueprint** is the concrete data that persona generates across all surfaces — database rows, API responses, MCP tool outputs.

Pre-built personas ship as JSON files in `packages/blueprints/`. They contain pre-generated data for common domains (finance, support).

Custom personas are generated using an LLM (via Vercel AI SDK), then a deterministic expander generates consistent data across all configured surfaces.

### Adapters

Adapters are Mimic's plugin system. There are two types:

**Database adapters** connect to real databases and seed them with persona data. They implement `DatabaseAdapter` with `seed()` and `clean()` methods. Available: PostgreSQL, MySQL, MongoDB, SQLite.

**API mock adapters** register Fastify routes that simulate real API endpoints. They extend `OpenApiMockAdapter` with `registerRoutes()` and `getEndpoints()` methods. Each adapter includes seeded data in an in-memory state store. Available: Stripe, Plaid, Paddle, Chargebee, GoCardless, Lemon Squeezy, Recurly, RevenueCat, Zuora.

### State Store

The state store is a per-adapter in-memory key-value store that holds seeded data during a mock server session. It provides:

- `set(collection, id, data)` — store a record
- `get(collection, id)` — retrieve by ID
- `list(collection)` — list all records in a collection
- `filter(collection, predicate)` — query records
- `update(collection, id, partial)` — partial update
- `delete(collection, id)` — remove a record

The state store resets when the server restarts.

### Mock Server

The mock server is a Fastify instance that:

1. Loads all configured adapters from `mimic.json`
2. Calls each adapter's `registerRoutes()` to mount route handlers
3. Serves HTTP requests, routing by path prefix to the correct adapter
4. Provides CORS headers for browser-based agent testing

### MCP Servers

Each API mock adapter includes a built-in MCP server entry point (`src/bin/mcp.ts`). These use the `@modelcontextprotocol/sdk` and expose tools derived from each adapter's `getEndpoints()` definitions. They can be run directly via `npx @mimicai/adapter-{id} mcp`.

## Data Flow

### Seeding Flow

```
mimic run + mimic seed
  |
  +- Load persona blueprint (pre-built or LLM-generated)
  |
  +- For each configured database adapter:
  |   +- Connect to database
  |   +- Map blueprint data to table schemas
  |   +- INSERT/COPY rows (with FK-aware ordering)
  |   +- Report: "Seeded 42 rows across 5 tables"
  |
  +- Done (API mocks seed lazily when host starts)
```

### Request Flow (API Mock)

```
Agent sends: GET /stripe/v1/customers

Mock Server
  |
  +- Route matched: /stripe/* -> StripeAdapter
  |
  +- StripeAdapter handler
  |   +- seedFromApiResponses() — populate state store if empty
  |   +- Query state store
  |   +- Format response matching Stripe's real shape
  |   +- reply.send({ object: 'list', data: [...] })
  |
  +- Response returned to agent
```

### MCP Flow

```
Agent calls MCP tool: list_customers()

MCP Server (@mimicai/adapter-stripe mcp)
  |
  +- Validate params with zod schema
  +- Translate to HTTP: GET http://localhost:4000/stripe/v1/customers
  +- Parse response
  +- Format for agent consumption
  +- Return MCP response
```

## Cross-Surface Consistency

The core differentiator is **cross-surface consistency**. When data is generated for persona "Alex", the same Alex appears across all surfaces:

- PostgreSQL `users` table has Alex with matching IDs
- Plaid API returns bank accounts owned by Alex
- Stripe API returns payment history for Alex's card

This is achieved through the `apiEntities` system in `@mimicai/core`, which maintains shared identifiers and correlated values across all configured adapters.

## Package Dependency Graph

```
@mimicai/cli
  +-- @mimicai/core
  +-- @mimicai/blueprints
  +-- @mimicai/adapter-postgres
  +-- @mimicai/adapter-mysql
  +-- @mimicai/adapter-mongodb
  +-- @mimicai/adapter-sqlite
  +-- @mimicai/adapter-stripe (optional)
  +-- @mimicai/adapter-plaid (optional)
  +-- @mimicai/adapter-paddle (optional)
  +-- ... (6 more API mock adapters)

@mimicai/adapter-sdk
  +-- @mimicai/core

@mimicai/adapter-{stripe,plaid,paddle,...}
  +-- @mimicai/adapter-sdk
  +-- @mimicai/core
```

The CLI orchestrates everything. The adapter SDK and individual adapters are independently usable.
