# Adapter Development Guide

This guide walks you through building a new API mock adapter for Mimic. By the end, you'll have a fully functional adapter that mocks a real platform's API with realistic seeded data.

## Overview

An adapter does three things:

1. **Declares routes** that mirror the real platform's API endpoints
2. **Seeds realistic data** into an in-memory state store
3. **Handles requests** with response shapes matching the real API

Every adapter runs inside Mimic's Fastify mock server at a unique base path (e.g., `/stripe/v1`, `/plaid`).

## Getting Started

Copy an existing adapter as a starting point — `adapter-stripe` and `adapter-plaid` are the best reference implementations. See `private/building-adapters.md` for the comprehensive guide covering codegen, overrides, and the full `OpenApiMockAdapter` pipeline.

```bash
cp -r packages/adapters/adapter-stripe packages/adapters/adapter-my-platform
```

Then update the package name, class name, and routes.

## Adapter Structure

```
packages/adapters/adapter-my-platform/
├── src/
│   ├── my-platform-adapter.ts    # Adapter class (routes, seed, config)
│   ├── config.ts                 # Zod config schema
│   ├── index.ts                  # Exports & manifest
│   ├── bin/
│   │   └── mcp.ts                # MCP server entry point
│   └── __tests__/
│       └── my-platform-adapter.test.ts
├── package.json                  # @mimicai/adapter-my-platform
├── tsconfig.json
├── tsup.config.ts
└── README.md
```

## The Base Class

Every adapter extends `BaseApiMockAdapter` from the adapter SDK:

```typescript
import {
  BaseApiMockAdapter,
  type EndpointDefinition,
  type ExpandedData,
  type StateStore,
  generateId,
  resolvePersonaFromBearer,
} from '@mimicai/adapter-sdk';
import type { FastifyInstance, FastifyRequest } from 'fastify';

export interface MyPlatformConfig {
  // Platform-specific configuration (validated with Zod)
}

export class MyPlatformAdapter extends BaseApiMockAdapter<MyPlatformConfig> {
  readonly id = 'my-platform';
  readonly name = 'My Platform API';
  readonly basePath = '/my-platform';

  resolvePersona(req: FastifyRequest): string | null {
    return resolvePersonaFromBearer(req);
  }

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    this.seedFromApiResponses(data, store);

    server.get('/my-platform/items', async (req, reply) => {
      const items = store.list('mp_items');
      return reply.send({ data: items });
    });

    server.post('/my-platform/items', async (req, reply) => {
      const id = generateId('item');
      const item = { id, ...(req.body as object), created_at: new Date().toISOString() };
      store.set('mp_items', id, item);
      return reply.status(201).send({ data: item });
    });
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      { method: 'GET', path: '/my-platform/items', description: 'List items' },
      { method: 'POST', path: '/my-platform/items', description: 'Create item' },
    ];
  }

  private seedFromApiResponses(data: Map<string, ExpandedData>, store: StateStore): void {
    if (store.list('mp_items').length > 0) return;
    // Hydrate store from pre-generated data or create default seed data
  }
}
```

### Key methods

| Method | Purpose |
|--------|---------|
| `resolvePersona(req)` | Extract persona ID from the request (auth header, body, etc.) |
| `registerRoutes(server, data, store)` | Mount all Fastify route handlers |
| `getEndpoints()` | Declare all routes for docs and MCP generation |

### Inherited lifecycle methods

| Method | Purpose |
|--------|---------|
| `init(config, context)` | Called once on startup — stores config and context |
| `apply(data, context)` | No-op for API mocks (data is served via HTTP) |
| `clean(context)` | Clean up adapter state |
| `healthcheck(context)` | Verify adapter is operational |
| `dispose()` | Release resources on shutdown |

## Implementing Routes

### Step 1: Plan Your Endpoints

Study the real platform's API documentation. Focus on the endpoints AI agents actually call:

- **List** the primary resource (with filtering and pagination)
- **Get** a single resource by ID
- **Create** a new resource
- **Update** an existing resource
- **Delete** or archive a resource
- **Search** if the platform has a search endpoint

Aim for 8-20 routes.

### Step 2: Seed Realistic Data

Populate the state store from pre-generated data or default values:

```typescript
private seedFromApiResponses(data: Map<string, ExpandedData>, store: StateStore): void {
  if (store.list('mp_items').length > 0) return;

  // Check for pre-generated data from persona blueprint
  const apiData = data.get('my-platform');
  if (apiData?.responses) {
    for (const [key, value] of Object.entries(apiData.responses)) {
      store.set('mp_items', key, value);
    }
    return;
  }

  // Fallback: default seed data
  const items = [
    { title: 'Fix login bug', status: 'open', priority: 'high' },
    { title: 'Write API docs', status: 'in_progress', priority: 'medium' },
    { title: 'Add dark mode', status: 'backlog', priority: 'low' },
  ];

  items.forEach((item) => {
    const id = generateId('item');
    store.set('mp_items', id, { id, ...item, created_at: new Date().toISOString() });
  });
}
```

Seed data should feel real. Use realistic names, emails, dates, and values.

### Step 3: Match Real Response Shapes

Study real API responses and match their structure exactly.

```typescript
// BAD — inventing your own response shape
return reply.send({ items: store.list('mp_items') });

// GOOD — matching the real API's response shape
return reply.send({ data: store.list('mp_items') });

// With pagination:
const { items, hasMore } = paginate(store.list('mp_items'), { offset, limit });
return reply.send({
  results: items,
  next_cursor: hasMore ? items[items.length - 1].id : null,
  has_more: hasMore,
});
```

### Step 4: Implement Authentication

Match the platform's auth pattern using helpers from the SDK:

```typescript
import { resolvePersonaFromBearer, resolvePersonaFromBody } from '@mimicai/adapter-sdk';

// Bearer token (most common — Stripe, Slack, etc.)
resolvePersona(req: FastifyRequest): string | null {
  return resolvePersonaFromBearer(req);
}

// Body-based auth (Plaid)
resolvePersona(req: FastifyRequest): string | null {
  return resolvePersonaFromBody(req);
}

// Custom auth (e.g., Stripe's sk_test_ prefix)
resolvePersona(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer sk_test_')) return null;
  const match = auth.match(/^Bearer\s+sk_test_([a-z0-9-]+)_/);
  return match ? match[1] : null;
}
```

### Step 5: Handle Errors Correctly

Match the platform's error response format:

```typescript
// Stripe-style errors
return reply.status(404).send({
  error: { type: 'invalid_request_error', message: 'No such customer: cus_xxx' }
});

// Slack-style errors
return reply.status(200).send({ ok: false, error: 'channel_not_found' });

// Generic REST errors
return reply.status(404).send({ message: 'Not found' });
```

## Adapter Manifest

Every adapter exports a manifest for the adapter registry:

```typescript
import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'my-platform',
  name: 'My Platform API',
  type: 'api-mock',
  description: 'My Platform mock adapter for testing',
};
```

## Writing Tests

Use `buildTestServer` from the adapter SDK:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import { MyPlatformAdapter } from '../my-platform-adapter.js';

describe('MyPlatformAdapter', () => {
  let ts: TestServer;
  let adapter: MyPlatformAdapter;

  beforeAll(async () => {
    adapter = new MyPlatformAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  it('has correct metadata', () => {
    expect(adapter.id).toBe('my-platform');
    expect(adapter.type).toBe('api-mock');
    expect(adapter.basePath).toBe('/my-platform');
  });

  it('lists items', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: '/my-platform/items',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('creates an item', async () => {
    const res = await ts.server.inject({
      method: 'POST',
      url: '/my-platform/items',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ title: 'New item', priority: 'high' }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.title).toBe('New item');
    expect(body.data.id).toBeDefined();
  });

  it('returns 404 for missing item', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: '/my-platform/items/nonexistent',
    });
    expect(res.statusCode).toBe(404);
  });
});
```

## SDK Utilities

The adapter SDK re-exports useful helpers from `@mimicai/core`:

| Helper | Description |
|--------|-------------|
| `generateId(prefix?)` | Generate a unique ID, optionally prefixed (e.g., `cus_abc123`) |
| `paginate(items, opts)` | Paginate a list with offset/limit |
| `filterByDate(items, field, start, end)` | Filter by date range |
| `resolvePersonaFromBearer(req)` | Extract persona from Bearer token |
| `resolvePersonaFromBody(req)` | Extract persona from request body |
| `StateStore` | In-memory key-value store class |
| `unixNow()` | Current Unix timestamp in seconds |
| `toDateStr(val)` | Normalize to ISO date string |
| `capitalize(str)` | Capitalize first letter |

## Checklist Before Submitting

- [ ] Adapter extends `BaseApiMockAdapter`
- [ ] `resolvePersona()` matches the platform's auth pattern
- [ ] 8+ routes covering core CRUD operations
- [ ] Realistic seed data (3-5 records per primary resource)
- [ ] Response shapes match the real API (test against real docs)
- [ ] Error responses match the real API's error format
- [ ] Correct ID format for the platform
- [ ] Correct pagination style for the platform
- [ ] `getEndpoints()` returns all route definitions
- [ ] Exports a `manifest` object
- [ ] Tests use `buildTestServer` from `@mimicai/adapter-sdk`
- [ ] README documents endpoints, auth, and seed data
- [ ] `package.json` named `@mimicai/adapter-{id}`

## Reference Implementations

- [`adapter-stripe`](../packages/adapters/adapter-stripe/) — Full Stripe API mock with 617 routes, OpenAPI codegen, overrides
- [`adapter-plaid`](../packages/adapters/adapter-plaid/) — Plaid API mock with 326 routes, link flow, transactions
