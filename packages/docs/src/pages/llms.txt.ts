import type { APIRoute } from 'astro';

export const GET: APIRoute = () => {
  const body = `# Mimic Documentation

> Mimic is an open-source synthetic environment engine for AI agent development.
> One persona generates coherent data across every database, API, and MCP server your agent touches.

## Docs

- [Getting Started](/docs/getting-started): Installation, quickstart, and first project setup
- [Core Concepts](/docs/concepts): Personas, blueprints, adapters, mock server, state store
- [Configuration](/docs/configuration): mimic.json reference — all fields and options
- [CLI Reference](/docs/cli): All CLI commands and their options
- [Adapters](/docs/adapters): Adapter catalog (Stripe, Plaid, Slack shipped), SDK, and how to build adapters
- [MCP Servers](/docs/mcp): MCP overview, setup, parity, catalog
- [Architecture](/docs/architecture): System overview, data flow, package graph
- [Guides](/docs/guides): Finance agent, support agent, CI/CD integration
- [Examples](/docs/examples): 9 working example walkthroughs

## Optional

- [Full docs as single file](/llms-full.txt): Complete documentation in plain text for LLM context
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
