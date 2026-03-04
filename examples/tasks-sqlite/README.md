# Tasks SQLite Example

A streaming AI agent for project and task management, powered by [Mimic](https://github.com/mimicailab/mimic) synthetic data and the [Vercel AI SDK](https://sdk.vercel.ai). No Docker or external database required — SQLite is file-based.

The agent streams responses using the AI SDK UI Message Stream protocol, and a minimal Next.js chat UI is included to interact with it in the browser.

## Prerequisites

- Node.js >= 22
- `sqlite3` CLI (pre-installed on macOS; `apt install sqlite3` on Debian/Ubuntu)
- An Anthropic API key

## Quick Start

### 1. Install dependencies

```bash
# Install the Mimic CLI and SQLite driver
npm install
```

This installs `@mimicai/cli` and `better-sqlite3` from the root `package.json`.

### 2. Create the database

```bash
./init-db.sh
```

This creates `tasks.db` from `schema.sql` with tables for projects, tasks, labels, task_labels, and comments.

### 3. Set your API key

Create a `.env` file in this directory:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Then export it so the CLI can use it:

```bash
export $(cat .env | xargs)
```

### 4. Generate synthetic data

```bash
npx mimic run
```

This uses the two personas defined in `mimic.json` (a busy developer and a project manager) to generate realistic data blueprints via the Anthropic API. Blueprints are saved to `.mimic/data/`.

### 5. Seed the database

```bash
npx mimic seed --verbose
```

This inserts the generated data into `tasks.db`. You can inspect what was created:

```bash
npx mimic inspect schema   # show tables and columns
npx mimic inspect data     # show row counts per table
```

### 6. Start the agent

```bash
cd agent
npm install
npm start
```

The agent starts on **http://localhost:3002**. You can test it with curl:

```bash
curl -X POST http://localhost:3002/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "What projects are active?"}]}'
```

### 7. Start the chat UI

Open a **new terminal** (keep the agent running):

```bash
cd ui
npm install
npm run dev
```

Open **http://localhost:3000** in your browser. You should see a chat interface — type a message like "What projects are active?" and hit Send.

## How It Works

```
Browser (localhost:3000)
  └─ useChat hook sends messages to /api/chat
       └─ Next.js proxy converts UIMessage → ModelMessage format
            └─ Forwards to agent (localhost:3002/chat)
                 └─ Agent calls Anthropic API with tools
                      └─ Tools query SQLite database
                           └─ Streams response back through the chain
```

The UI uses the AI SDK `useChat` hook from `@ai-sdk/react`. The Next.js API route at `ui/src/app/api/chat/route.ts` proxies requests to the agent, converting the `UIMessage` parts format to simple `{role, content}` messages that the agent expects.

## Testing with curl

```bash
# Simple message
curl -X POST http://localhost:3002/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Show me all blocked tasks"}'

# Multi-turn conversation
curl -X POST http://localhost:3002/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [
    {"role": "user", "content": "List all projects"},
    {"role": "assistant", "content": "Here are your projects: ..."},
    {"role": "user", "content": "Show me tasks in the first project"}
  ]}'

# Health check
curl http://localhost:3002/health
```

## Configuration

### Agent environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3002` | Agent HTTP server port |
| `MODEL` | `claude-haiku-4-5` | Anthropic model to use |
| `DB_PATH` | `../tasks.db` | Path to the SQLite database |
| `ANTHROPIC_API_KEY` | (required) | Your Anthropic API key |

### UI environment variables

Set these in `ui/.env.local`:

| Variable | Default | Description |
|---|---|---|
| `AGENT_URL` | `http://localhost:3002` | Agent server URL |

## Agent Tools

The agent exposes six tools to the LLM:

| Tool | Description |
|---|---|
| `list_projects` | List all projects with task counts, filter by status |
| `search_tasks` | Keyword search across task titles and descriptions |
| `get_task_details` | Full details for a single task including labels |
| `get_project_tasks` | All tasks for a project, ordered by priority |
| `get_task_comments` | Chronological comments on a task |
| `get_blocked_tasks` | All blocked tasks, optionally filtered by project |

## Schema

| Table | Description |
|---|---|
| `projects` | Top-level containers with name, description, and status |
| `tasks` | Work items with status, priority, assignee, dates, and hour tracking |
| `labels` | Reusable tags with color codes |
| `task_labels` | Many-to-many join between tasks and labels |
| `comments` | Chronological discussion threads on tasks |

Task statuses: `todo` → `in_progress` → `review` → `done` (or `blocked` at any stage)

Task priorities: `low` | `medium` | `high` | `urgent`

## Cleanup

```bash
rm tasks.db                  # remove the database
npx mimic clean --yes        # also remove generated blueprints
```
