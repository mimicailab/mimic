# @mimicai/cli

CLI for [Mimic](https://github.com/mimicailab/mimic) — generate, seed, serve, and test synthetic data for AI agents.

## Install

```bash
npm install -g @mimicai/cli
```

## Commands

```
mimic init          Create a new mimic.json project config
mimic run           Generate blueprints and expand persona data
mimic seed          Seed databases from persona blueprint
mimic host          Start mock API + MCP servers
mimic test          Run test scenarios against your agent
mimic inspect       View schema, data, or blueprint information
mimic clean         Remove all seeded data
mimic adapters      Manage API mock adapters (add, remove, list)
```

## Quick start

```bash
mimic init
mimic run
mimic seed
mimic host
```

## Configuration

The CLI reads `mimic.json` from the current working directory. Run `mimic init` to generate one interactively.

```json
{
  "domain": "fintech agent testing",
  "personas": [{ "name": "finance-alex", "blueprint": "young-professional" }],
  "databases": [{ "adapter": "postgres", "connectionString": "postgresql://localhost:5432/testdb" }],
  "apis": [{ "adapter": "stripe" }, { "adapter": "plaid" }]
}
```

## Requirements

- Node.js >= 22

## License

[Apache 2.0](../../LICENSE-APACHE-2.0)
