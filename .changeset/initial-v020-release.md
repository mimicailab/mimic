---
'@mimicai/core': minor
'@mimicai/cli': minor
'@mimicai/blueprints': minor
'@mimicai/adapter-sdk': minor
'@mimicai/adapter-postgres': minor
'@mimicai/adapter-mysql': minor
'@mimicai/adapter-mongodb': minor
'@mimicai/adapter-sqlite': minor
'@mimicai/adapter-plaid': minor
'@mimicai/adapter-slack': minor
'@mimicai/adapter-stripe': minor
---

Initial public release of Mimic — persona-driven synthetic data generation for AI agent testing.

- Core engine with schema parsing (Prisma, SQL DDL, live PG), LLM-powered data generation, database seeding, MCP server, and test runner
- CLI with init, run, seed, serve, test, inspect, and clean commands
- Pre-built persona blueprints (young-professional, freelancer, college-student)
- Adapter SDK for building custom API mock adapters
- Database adapters: PostgreSQL, MySQL, MongoDB, SQLite
- API mock adapters: Stripe, Plaid, Slack
