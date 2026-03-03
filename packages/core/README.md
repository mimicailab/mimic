# @mimicai/core

Core engine for [Mimic](https://github.com/mimicailab/mimic) — persona-driven synthetic data generation, schema parsing, database seeding, MCP server, and test runner.

## Install

```bash
npm install @mimicai/core
```

## What's inside

- **Schema parsing** — Prisma files, raw SQL DDL, or live PostgreSQL introspection
- **Blueprint generation** — LLM-powered persona data via Vercel AI SDK, or pre-built JSON blueprints
- **Database seeding** — Batch INSERT or COPY for high-volume seeding with FK-aware ordering
- **MCP server** — Auto-generates tools from your schema for Model Context Protocol agents
- **Test runner** — Keyword matching + LLM-as-judge evaluation for agent testing
- **Adapter system** — Pluggable adapter registry for databases, API mocks, file storage, and events

## Usage

```typescript
import { loadConfig, parseSchema, generateBlueprint, seedDatabase } from '@mimicai/core';

const config = await loadConfig('mimic.json');
const schema = await parseSchema(config);
const blueprint = await generateBlueprint(schema, config);
await seedDatabase(blueprint, config);
```

## Requirements

- Node.js >= 22

## License

[Apache 2.0](../../LICENSE-APACHE-2.0)
