# CFO Agent — Multi-Agent Architecture

## Overview

A CFO-grade financial assistant that queries 8 billing platforms + PostgreSQL via MCP. Uses a **supervisor + sub-agent** pattern where each platform gets its own isolated MCP server and dedicated sub-agent.

## System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         UI (:3000)                              │
│                     Next.js + useChat v3                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ POST /api/chat
                           │ (AI SDK v6 SSE stream)
┌──────────────────────────▼──────────────────────────────────────┐
│                    Agent Server (:3003)                          │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                   SUPERVISOR AGENT                         │  │
│  │                                                            │  │
│  │  Tools: query_postgres, query_stripe, query_paddle,        │  │
│  │         query_chargebee, query_gocardless, query_revenuecat│  │
│  │         query_lemonsqueezy, query_zuora, query_recurly     │  │
│  │                                                            │  │
│  │  Dispatches questions → sub-agents → synthesises results   │  │
│  └─────┬────┬────┬────┬────┬────┬────┬────┬────┬─────────────┘  │
│        │    │    │    │    │    │    │    │    │                   │
│  ┌─────▼┐ ┌▼──┐ ┌▼──┐ ┌▼──┐ ┌▼──┐ ┌▼──┐ ┌▼──┐ ┌▼──┐ ┌▼──┐    │
│  │Postgres│Stripe│Paddle│Chargbee│GoCrdls│RevCat│LmnSqz│Zuora│Recurly│
│  │Agent│Agent│Agent│Agent│Agent│Agent│Agent│Agent│Agent│       │
│  └──┬──┘└──┬┘└──┬┘└──┬┘└──┬┘└──┬┘└──┬┘└──┬┘└──┬┘              │
└─────┼──────┼────┼────┼────┼────┼────┼────┼────┼────────────────┘
      │ MCP  │    │    │    │    │    │    │    │
      │ SSE  │    │    │    │    │    │    │    │
┌─────▼──────▼────▼────▼────▼────▼────▼────▼────▼────────────────┐
│                      mimic host                                  │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ postgres │ │  stripe  │ │  paddle  │ │ chargebee│           │
│  │ MCP:4201 │ │ MCP:4202 │ │ MCP:4203 │ │ MCP:4204 │           │
│  │          │ │ API:4101 │ │ API:4102 │ │ API:4103 │           │
│  │  6 tools │ │ 13 tools │ │ 45 tools │ │ 26 tools │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │gocardless│ │revenuecat│ │lemonsqzy │ │  zuora   │           │
│  │ MCP:4205 │ │ MCP:4206 │ │ MCP:4207 │ │ MCP:4208 │           │
│  │ API:4104 │ │ API:4105 │ │ API:4106 │ │ API:4107 │           │
│  │ 24 tools │ │ 20 tools │ │ 38 tools │ │ 23 tools │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│  ┌──────────┐                                                    │
│  │ recurly  │  All derived from mimic.json                      │
│  │ MCP:4209 │  Transport auto-detected (stdio/sse)              │
│  │ API:4108 │  Each adapter: isolated MockServer + MCP server   │
│  │ 19 tools │                                                    │
│  └──────────┘                                                    │
└──────────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────┐
│ Postgres │  Docker: localhost:5435
│   DB     │  users, events, usage_metrics, feature_flags
└──────────┘
```

## Key Design Decisions

### 1. One MCP Server Per Adapter
Each adapter in `mimic.json` gets its own isolated MCP server + mock API server. This mirrors production where Stripe, Paddle, etc. each have their own MCP endpoints. No tool name conflicts.

### 2. Supervisor + Sub-Agent Pattern
The supervisor has 9 lightweight dispatch tools (`query_stripe`, `query_postgres`, etc.). Each sub-agent connects to its own MCP server and has only that platform's tools. This keeps each agent well under Claude's 200k token context limit.

### 3. Read-Only Tool Filtering
Sub-agents only get read/query tools (`list_*`, `get_*`, `retrieve_*`, `search_*`, `fetch_*`). Write tools (`create_*`, `update_*`, `delete_*`) are filtered out — a CFO agent reads data, it doesn't modify billing records.

### 4. Auto-Detected Transport
`mimic host` reads `mimic.json` and automatically picks the transport:
- **1 server** → stdio (single MCP on stdin/stdout)
- **Multiple servers** → SSE (each on its own port)

No CLI flags needed for transport. Ports configurable via `--mcp-base-port` and `--api-base-port`.

## Port Allocation

| Service      | MCP Port | API Port | Tools (read-only) |
|-------------|----------|----------|--------------------|
| postgres    | 4201     | —        | 6                  |
| stripe      | 4202     | 4101     | 13                 |
| paddle      | 4203     | 4102     | 45                 |
| chargebee   | 4204     | 4103     | 26                 |
| gocardless  | 4205     | 4104     | 24                 |
| revenuecat  | 4206     | 4105     | 20                 |
| lemonsqueezy| 4207     | 4106     | 38                 |
| zuora       | 4208     | 4107     | 23                 |
| recurly     | 4209     | 4108     | 19                 |

## Running

```bash
# 1. Start postgres
docker compose up -d

# 2. Seed data (if not already done)
mimic seed

# 3. Start all MCP + mock API servers
mimic host

# 4. Start the agent
cd agent && npm run dev

# 5. Start the UI
cd ui && npm run dev
```

## Stream Format

The agent server outputs AI SDK v1 data stream format:
- `0:"text"` — text chunks
- `9:{toolCallId, toolName, args}` — tool call start
- `a:{toolCallId, result}` — tool result
- `d:{finishReason}` — stream end

The UI's `/api/chat/route.ts` translates this to AI SDK v6 SSE format for `useChat` v3.
