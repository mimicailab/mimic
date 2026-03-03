# Adapter Development Guide

This guide walks you through building a new API mock adapter for Mimic. By the end, you'll have a fully functional adapter that mocks a real platform's API with realistic seeded data.

## Overview

An adapter does three things:

1. **Declares routes** that mirror the real platform's API endpoints
2. **Seeds realistic data** into an in-memory state store on first request
3. **Handles requests** with response shapes matching the real API

Every adapter runs inside Mimic's Fastify mock server at a unique base path (e.g., `/stripe/v1`, `/jira/rest/api/3`).

## Scaffold a New Adapter

```bash
pnpm mimic:create-adapter my-platform
```

This generates the boilerplate at `packages/oss/adapter-my-platform/`. You can also copy an existing adapter as a starting point — `adapter-jira` and `adapter-stripe` are the best reference implementations.

## Adapter Structure

```
packages/oss/adapter-my-platform/
├── src/
│   └── index.ts           # Adapter class (routes, seed, config)
├── __tests__/
│   └── adapter.test.ts    # Integration tests
├── package.json           # @mimicai/adapter-my-platform
├── tsconfig.json
└── README.md
```

## The Adapter Interface

Every adapter implements the `ApiMockAdapter` interface:

```typescript
import { ApiMockAdapter, EndpointDefinition } from '@mimicai/adapter-sdk';
import { FastifyInstance, FastifyRequest } from 'fastify';

export interface MyPlatformConfig {
  // Platform-specific configuration
}

export class MyPlatformAdapter implements ApiMockAdapter<MyPlatformConfig> {
  readonly id = 'my-platform';
  readonly name = 'My Platform API';
  readonly type = 'api-mock' as const;
  readonly basePath = '/my-platform';

  private config!: MyPlatformConfig;

  // Extract persona ID from auth header
  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;
    const match = auth.replace('Bearer ', '').match(/^mp_([a-z0-9-]+)/);
    return match ? match[1] : null;
  }

  // Register all routes on the Fastify server
  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    state: StateStore
  ): Promise<void> {
    // ... route implementations
  }

  // Declare endpoints for documentation + MCP generation
  getEndpoints(): EndpointDefinition[] {
    return [
      { method: 'GET', path: '/my-platform/items', description: 'List items' },
      { method: 'POST', path: '/my-platform/items', description: 'Create item' },
      // ...
    ];
  }
}
```

## Implementing Routes

### Step 1: Plan Your Endpoints

Study the real platform's API documentation. You don't need to mock everything — focus on the endpoints AI agents actually call. A good adapter covers:

- **List** the primary resource (with filtering and pagination)
- **Get** a single resource by ID
- **Create** a new resource
- **Update** an existing resource
- **Delete** or archive a resource
- **Search** if the platform has a search endpoint
- **1-2 domain-specific actions** (e.g., Jira transitions, PagerDuty acknowledge)

Aim for 8-20 routes. More is fine; fewer than 8 usually means important operations are missing.

### Step 2: Seed Realistic Data

Use the lazy-seed pattern — populate the state store on the first request:

```typescript
const seedData = () => {
  if (state.list('mp_items').length > 0) return; // Already seeded

  const items = [
    { title: 'Fix login bug', status: 'open', priority: 'high' },
    { title: 'Write API docs', status: 'in_progress', priority: 'medium' },
    { title: 'Add dark mode', status: 'backlog', priority: 'low' },
    // ... at least 3-5 items with realistic values
  ];

  items.forEach((item, i) => {
    const id = generateId();
    state.set('mp_items', id, {
      id,
      ...item,
      created_at: isoAgo(14 - i),
      updated_at: isoAgo(Math.max(1, 7 - i)),
    });
  });
};
```

Seed data should feel real. Use realistic names, emails, dates, and values. Don't use "test", "foo", "bar", or sequential numbers where a real user wouldn't see them.

### Step 3: Match Real Response Shapes

This is critical. Study real API responses and match their structure exactly.

```typescript
// BAD — inventing your own response shape
return reply.send({ items: state.list('mp_items') });

// GOOD — matching the real API's response shape
// If the real API wraps responses in { data: [...] }:
return reply.send({ data: state.list('mp_items') });

// If the real API returns bare arrays:
return reply.send(state.list('mp_items'));

// If the real API uses pagination:
return reply.send({
  results: items.slice(offset, offset + limit),
  next_cursor: hasMore ? lastId : null,
  has_more: hasMore,
});
```

Get the wrapper objects, field names, timestamp formats, ID formats, and error shapes right. Agents are trained on real API documentation — if your mock returns a different shape, the agent breaks.

### Step 4: Implement Authentication

Match the platform's auth pattern:

```typescript
// Bearer token (most common)
resolvePersona(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.replace('Bearer ', '').slice(0, 8);
}

// Basic auth (Freshdesk, Jira)
resolvePersona(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Basic ')) return null;
  const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString();
  return decoded.split(':')[0].slice(0, 8);
}

// API key in header (Monday.com)
resolvePersona(req: FastifyRequest): string | null {
  return (req.headers['api-key'] as string)?.slice(0, 8) || null;
}

// Query parameter (Trello)
resolvePersona(req: FastifyRequest): string | null {
  return (req.query as any).token?.slice(0, 8) || null;
}
```

### Step 5: Handle Errors Correctly

Match the platform's error response format:

```typescript
// Stripe-style errors
return reply.status(404).send({
  error: { type: 'invalid_request_error', message: 'No such customer: cus_xxx' }
});

// Jira-style errors
return reply.status(400).send({
  errorMessages: ['Field "summary" is required'],
  errors: {}
});

// Notion-style errors
return reply.status(404).send({
  object: 'error', status: 404, code: 'object_not_found',
  message: 'Could not find page with ID xxx'
});
```

## Platform-Specific Patterns to Watch For

Every platform has quirks. Here are common patterns to get right:

**ID formats** — Stripe uses `cus_xxx`, Jira uses `MIM-1`, Trello uses 24-char hex, Notion uses UUIDs, Asana uses 16-digit numeric strings. Match them.

**Timestamp formats** — Most APIs use ISO 8601, but ClickUp uses millisecond timestamps, Intercom uses Unix seconds, and some APIs use date-only strings for certain fields.

**Pagination** — Cursor-based (`next_cursor`, `has_more`), offset-based (`offset`, `limit`, `total`), or page-based (`page`, `per_page`). Match the platform.

**Wrapped vs bare responses** — Stripe wraps in `{ data: [...] }`, Asana in `{ data: {...} }`, Notion in `{ object: 'list', results: [...] }`, but Trello and Freshdesk return bare arrays. Match the platform.

**Update methods** — Most APIs use PUT or PATCH, but Todoist uses `POST /tasks/:id` for updates, and Jira returns 204 No Content on updates.

## Writing Tests

```typescript
import { buildTestServer } from '@mimicai/adapter-sdk/testing';
import { MyPlatformAdapter } from '../src';

describe('MyPlatform Adapter', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildTestServer(new MyPlatformAdapter());
  });

  afterAll(() => server.close());

  it('lists items', async () => {
    const res = await server.inject({ method: 'GET', url: '/my-platform/items' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('creates an item', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/my-platform/items',
      payload: { title: 'New item', priority: 'high' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.data.title).toBe('New item');
    expect(body.data.id).toBeDefined();
  });

  it('returns 404 for missing item', async () => {
    const res = await server.inject({ method: 'GET', url: '/my-platform/items/nonexistent' });
    expect(res.statusCode).toBe(404);
  });
});
```

## Checklist Before Submitting

- [ ] Adapter implements `ApiMockAdapter` interface
- [ ] `resolvePersona()` matches the platform's auth pattern
- [ ] 8+ routes covering core CRUD operations
- [ ] Realistic seed data (3-5 records per primary resource)
- [ ] Response shapes match the real API (test against real docs)
- [ ] Error responses match the real API's error format
- [ ] Correct ID format for the platform
- [ ] Correct timestamp format for the platform
- [ ] Correct pagination style for the platform
- [ ] `getEndpoints()` returns all route definitions
- [ ] Tests cover list, create, get, update operations
- [ ] README documents endpoints, auth, and seed data
- [ ] `package.json` has correct name: `@mimicai/adapter-{id}`
- [ ] TypeScript strict mode, no `any` without comments

## What Happens After You Submit

1. A maintainer reviews your PR within 48 hours
2. We may suggest changes — usually around response shape accuracy or seed data realism
3. Once approved, we merge and publish to npm as `@mimicai/adapter-{id}`
4. A corresponding MCP server is auto-generated from your `getEndpoints()` definitions
5. You get credited in CONTRIBUTORS.md and shouted out on social media
6. Your adapter is now used by every Mimic user who tests against that platform

## Need Help?

- Look at `adapter-jira` and `adapter-stripe` as reference implementations
- Ask in [Discord #adapter-dev](https://discord.gg/mimic)
- Open a draft PR early if you want feedback on your approach
