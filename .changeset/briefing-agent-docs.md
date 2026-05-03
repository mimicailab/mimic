---
"@mimicai/docs": minor
---

docs: add briefing-agent example to the docs site

Documents the new `briefing-agent` example as the structural sibling of the
`cfo-agent` — same Mimic underneath, Claude Skills instead of LangGraph.
Adds a row to the examples summary table, a full `example-briefing-agent`
section (architecture diagram, `mimic.json`, skills table, quick-start, and
"Skills, not graphs" callout), and a sidebar entry. Reflects the actual
five-surface setup shipped in `examples/briefing-agent/`: Attio, HubSpot,
Granola, Gmail, Slack, plus a Postgres product DB.
