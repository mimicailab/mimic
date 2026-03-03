# Tasks SQLite Example

A working example of Mimic with a SQLite-backed project and task management schema. No Docker or external database server required -- SQLite is file-based.

## Prerequisites

- Node.js >= 22
- `sqlite3` CLI (pre-installed on macOS; `apt install sqlite3` on Debian/Ubuntu)
- Anthropic API key (`ANTHROPIC_API_KEY`)

## Quick Start

```bash
# 1. Create the SQLite database
./init-db.sh

# 2. Set your Anthropic API key
export ANTHROPIC_API_KEY="sk-ant-..."

# 3. Generate synthetic data blueprints
mimic run

# 4. Seed the database
mimic seed --verbose

# 5. Inspect the generated data
mimic inspect schema
mimic inspect data

# 6. Start the agent
cd agent && npm install && npm start

# 7. Ask a question
curl -s -X POST http://localhost:3002/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What projects are currently active?"}' | jq .

# 8. Try more queries
curl -s -X POST http://localhost:3002/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Show me all blocked tasks"}' | jq .

curl -s -X POST http://localhost:3002/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Search for tasks related to authentication"}' | jq .
```

## What You Get

For the **busy-developer** persona (29yo full-stack dev, 3 active projects):

```
projects:    3 rows    (active projects with descriptions)
tasks:       ~40-60    (3 months of task creation across projects)
labels:      ~8-12     (bug, feature, docs, frontend, backend, etc.)
task_labels: ~60-90    (heavy label usage)
comments:    ~30-50    (progress updates, questions, code snippets)
```

For the **project-manager** persona (35yo PM, team of 8):

```
projects:    ~2-4 rows (milestone-driven projects)
tasks:       ~50-80    (delegation across 8 team members)
labels:      ~6-10     (milestone, blocker, sprint-1, sprint-2, etc.)
task_labels: ~40-60    (labels for tracking and filtering)
comments:    ~40-70    (status updates, blocker notes, deadline reminders)
```

## Schema Overview

| Table | Description |
|---|---|
| `projects` | Top-level containers with name, description, and status |
| `tasks` | Work items with status, priority, assignee, dates, and hour tracking |
| `labels` | Reusable tags with color codes |
| `task_labels` | Many-to-many join between tasks and labels |
| `comments` | Chronological discussion threads on tasks |

### Task Statuses

`todo` -> `in_progress` -> `review` -> `done` (or `blocked` at any stage)

### Task Priorities

`low` | `medium` | `high` | `urgent`

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

## Configuration

Environment variables for the agent:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3002` | HTTP server port |
| `MODEL` | `claude-haiku-4-5` | Anthropic model to use |
| `DB_PATH` | `../tasks.db` | Path to the SQLite database |
| `ANTHROPIC_API_KEY` | (required) | Your Anthropic API key |

## Cleanup

```bash
# Remove the database file -- that's it!
rm tasks.db

# Or use mimic clean to remove generated blueprints as well
mimic clean --yes
rm tasks.db
```
