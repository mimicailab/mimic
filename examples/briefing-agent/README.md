# Briefing Agent Example

A pre-call AE briefing agent that reads Attio, HubSpot, Granola, Gmail, Slack, and a Postgres product DB in parallel and produces a one-screen brief 5 minutes before any external meeting. Strictly read-only.

The agent has **no orchestration code**. It is a set of Claude Skills (markdown files under `skills/`) that Claude Code reads at runtime and uses to decide which MCP tools to call.

## Architecture

```
Claude Code  ──reads──▶  skills/briefing-prep/SKILL.md
     │                        │
     │                        ├─▶ skills/deal-context/SKILL.md
     │                        ├─▶ skills/conversation-history/SKILL.md
     │                        └─▶ skills/communication-state/SKILL.md
     │
     └──connects to (MCP)──▶ mimic host
                                ├─ postgres MCP   (product DB)
                                ├─ attio    MCP
                                ├─ hubspot  MCP
                                ├─ granola  MCP
                                ├─ gmail    MCP
                                └─ slack    MCP
```

## Prerequisites

- Node.js `>=22`
- Docker (for PostgreSQL)
- `ANTHROPIC_API_KEY` — required for Mimic data generation
- Claude Code installed (the agent IS Claude Code, pointed at the MCP servers)

## Run

```bash
# 1. Postgres up
docker compose up -d

# 2. Env
cp .env.example .env
# fill in ANTHROPIC_API_KEY

# 3. Install + Prisma
npm install
export $(cat .env | xargs)
npx prisma generate
npx prisma migrate dev --name init

# 4. Generate synthetic data across all 6 platforms
npx mimic run -g
npx mimic seed --verbose

# 5. Inspect what was generated (optional)
npx mimic explore

# 6. Host the MCP servers
npx mimic host
```

`mimic host` will print the API and MCP ports for each adapter. Point Claude Code at those MCP endpoints (in your Claude Code MCP config), then in a chat:

> "I have a call with priya@northwind.com in 5 minutes"

Claude Code will pick up `skills/briefing-prep/SKILL.md`, fan out across the MCP servers, and produce the brief.

## What's in the persona

The default persona, `northwind-priya`, is a late-stage £240k deal with intentionally rich cross-surface signal:

- Same SOC 2 conversation referenced in Granola transcript, Gmail thread, and Slack #deals
- Attio is the source of truth; HubSpot is a stale mirror with a value mismatch (testing the dual-CRM edge case)
- Two trial accounts at northwind.com in the product DB, with login activity matching the Granola call
- Priya promoted from Director to VP three weeks ago — deliberately referenced in only one surface

This is the kind of multi-surface causally-consistent universe that's impossible to fake by hand and trivial to regenerate with Mimic.

## Skills

| Skill | Purpose |
|-------|---------|
| [`briefing-prep`](skills/briefing-prep/SKILL.md) | Orchestrator — fan-out across all platforms, synthesize the brief |
| [`deal-context`](skills/deal-context/SKILL.md) | Resolve the deal across Attio + HubSpot, flag mismatches |
| [`conversation-history`](skills/conversation-history/SKILL.md) | Pull last 2-3 Granola/Gong calls, extract objections + commitments |
| [`communication-state`](skills/communication-state/SKILL.md) | Last 5 emails + Slack #deals mentions, derive thread state |

To add a new platform: write another skill, add the adapter to `mimic.json`. No orchestration code to refactor.
