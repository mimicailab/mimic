# @mimicai/adapter-plaid

Plaid API mock adapter for [Mimic](https://github.com/mimicailab/mimic) — mock Plaid endpoints with persona-consistent banking data + built-in MCP server.

## Install

```bash
npm install @mimicai/adapter-plaid
```

## Mocked endpoints

Link tokens, accounts, transactions, identity, balance, institutions, and auth.

## Usage

Add to your `mimic.json`:

```json
{
  "apis": [{ "adapter": "plaid" }]
}
```

Then run `mimic host` — Plaid API will be available at `http://localhost:4000/plaid`.

### MCP server

```json
{
  "mcpServers": {
    "mimic-plaid": {
      "command": "npx",
      "args": ["-y", "@mimicai/adapter-plaid", "mcp"]
    }
  }
}
```

## License

[Apache 2.0](../../../LICENSE-APACHE-2.0)
