---
'@mimicailab/core': minor
'@mimicailab/cli': minor
'@mimicailab/blueprints': minor
'@mimicailab/adapter-sdk': minor
'@mimicailab/adapter-postgres': minor
'@mimicailab/adapter-mysql': minor
'@mimicailab/adapter-mongodb': minor
'@mimicailab/adapter-sqlite': minor
'@mimicailab/adapter-plaid': minor
'@mimicailab/adapter-slack': minor
'@mimicailab/adapter-stripe': minor
---

Initial public release of Mimic — persona-driven synthetic data generation for AI agent testing.

- Core engine with schema parsing (Prisma, SQL DDL, live PG), LLM-powered data generation, database seeding, MCP server, and test runner
- CLI with init, run, seed, serve, test, inspect, and clean commands
- Pre-built persona blueprints (young-professional, freelancer, college-student)
- Adapter SDK for building custom API mock adapters
- Database adapters: PostgreSQL, MySQL, MongoDB, SQLite
- API mock adapters: Stripe, Plaid, Slack
