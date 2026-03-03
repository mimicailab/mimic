# Blog MongoDB Example

A working example of Mimic with a MongoDB-backed technical blog platform.
Demonstrates schema-free data generation -- no Prisma files or DDL needed.

## Prerequisites

- Node.js >= 22
- Docker (for MongoDB)
- Anthropic API key (`ANTHROPIC_API_KEY`)

## Quick Start

```bash
# 1. Start MongoDB
docker compose up -d

# 2. Set environment
export MONGO_URL="mongodb://localhost:27017"
export ANTHROPIC_API_KEY="your-key-here"

# 3. Generate and seed data (no schema file required)
mimic run
mimic seed --verbose

# 4. Inspect what was generated
mimic inspect data

# 5. Start the agent
cd agent && npm install && npm start

# 6. Ask a question
curl -X POST http://localhost:3003/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What are the most popular posts about Rust?"}'
```

## No Schema Files Required

Unlike PostgreSQL or MySQL examples, MongoDB does not require a schema definition
file (no Prisma schema, no SQL DDL). Mimic auto-discovers collections from the
database and generates documents that match the domain description and personas
defined in `mimic.json`.

This makes MongoDB the fastest way to get started with Mimic -- just describe
your domain and personas, and Mimic figures out the document shapes.

## What You Get

For the **prolific-writer** persona (32yo senior engineer):

```
users:      1 document   (profile with bio, social links)
posts:      ~50-70       (2-3 posts/week over 6 months on distributed systems, Rust)
comments:   ~100-150     (active commenter on own and others' posts)
bookmarks:  ~20-30       (bookmarks interesting reads)
```

For the **casual-reader** persona (24yo junior dev):

```
users:      1 document   (profile with minimal bio)
posts:      ~5-10        (occasional tutorial or TIL post)
comments:   ~30-50       (sporadic commenting, mostly on tutorials)
bookmarks:  ~80-120      (heavy bookmarker of tutorials and guides)
```

## Agent Tools

The agent provides six tools for querying blog content:

| Tool | Description |
|---|---|
| `search_posts` | Full-text search with optional tag, author, and date range filters |
| `get_post` | Retrieve a single post by ID with full body content |
| `get_comments` | Paginated comments for a post, with author info via `$lookup` |
| `get_author_posts` | All posts by an author (by ID or username), plus their profile |
| `get_popular_posts` | Posts ranked by engagement score (views + 5x likes + 10x comments) |
| `search_by_tag` | Posts matching tags (AND/OR), with tag frequency breakdown |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MONGO_URL` | `mongodb://localhost:27017` | MongoDB connection string |
| `MONGO_DATABASE` | `mimic_blog` | Database name |
| `ANTHROPIC_API_KEY` | -- | Required for the agent LLM |
| `MODEL` | `claude-haiku-4-5` | Anthropic model to use |
| `PORT` | `3003` | Agent HTTP server port |

## Cleanup

```bash
mimic clean --yes
docker compose down -v
```
