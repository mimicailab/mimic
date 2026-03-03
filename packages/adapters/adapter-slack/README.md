# @mimicai/adapter-slack

Slack API mock adapter for [Mimic](https://github.com/mimicailab/mimic) — mock Slack Web API endpoints with persona-consistent workspace data + built-in MCP server.

## Install

```bash
npm install @mimicai/adapter-slack
```

## Mocked endpoints

Channels, messages, users, reactions, files, threads, conversations, and team info.

## Usage

Add to your `mimic.json`:

```json
{
  "apis": [{ "adapter": "slack" }]
}
```

Then run `mimic host` — Slack API will be available at `http://localhost:4000/slack`.

### MCP server

```json
{
  "mcpServers": {
    "mimic-slack": {
      "command": "npx",
      "args": ["-y", "@mimicai/adapter-slack", "mcp"]
    }
  }
}
```

## License

[Apache 2.0](../../../LICENSE-APACHE-2.0)
