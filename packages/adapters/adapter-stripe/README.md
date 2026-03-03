# @mimicai/adapter-stripe

Stripe API mock adapter for [Mimic](https://github.com/mimicailab/mimic) — mock Stripe endpoints with persona-consistent payment data + built-in MCP server.

## Install

```bash
npm install @mimicai/adapter-stripe
```

## Mocked endpoints

Customers, payment intents, charges, subscriptions, invoices, products, prices, payment methods, refunds, balance, and webhooks.

## Usage

Add to your `mimic.json`:

```json
{
  "apis": [{ "adapter": "stripe" }]
}
```

Then run `mimic host` — Stripe API will be available at `http://localhost:4000/stripe/v1`.

### MCP server

```json
{
  "mcpServers": {
    "mimic-stripe": {
      "command": "npx",
      "args": ["-y", "@mimicai/adapter-stripe", "mcp"]
    }
  }
}
```

## License

[Apache 2.0](../../../LICENSE-APACHE-2.0)
