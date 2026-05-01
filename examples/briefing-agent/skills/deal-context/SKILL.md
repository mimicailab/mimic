---
name: deal-context
description: Pulls the current deal record, stage history, contract value, and slip pattern from whichever CRM(s) hold the deal. Use as a sub-step inside briefing-prep — do not invoke standalone unless the user explicitly asks for deal context.
---

# Deal context

Resolve a deal by **account name or domain**, not by deal ID — the briefing skill won't have an ID yet.

## Step 1: Try Attio first

Use `attio_list_deals` (or whichever search tool the MCP exposes) filtered by company name or domain. Capture:

- Deal name
- Current stage and stage entry date
- Contract value and currency
- Owner
- Created-at and last-modified-at timestamps
- Any custom fields that look like MEDDPICC slots (champion, economic_buyer, decision_criteria, decision_process, paper_process, identified_pain, competition)

## Step 2: Cross-check HubSpot

In parallel, call `hubspot_list_deals` for the same company. If a deal exists in both CRMs:

- If stage and value match → just note "mirrored in HubSpot, consistent"
- If they disagree → return both records and flag the mismatch. The briefing skill will surface this as a WATCH item.

## Step 3: Compute slip pattern

If you have access to a "close date" or "expected close" field:

- If the date has been pushed back more than once, count the slips (e.g. "slipped 3 weeks across 2 pushes")
- If the deal is past the most recent expected close → say "overdue by N weeks"

## Output shape

Return a compact structured summary for the briefing skill to consume. Example:

```
deal: Northwind Eval
source: attio (mirror in hubspot, value mismatch — see WATCH)
stage: Procurement (since 2026-04-08)
value: £240k annual
slip: 3 weeks past original close date (one push from 2026-04-08 → 2026-04-29)
owner: sarah@cumulus.io
champion: Priya Shah
risks: SOC 2 not yet signed off (custom field flagged)
```

## Rules

- Read-only. Never call create/update/delete deal tools.
- If neither CRM has the deal, say so explicitly — the briefing skill will treat it as a net-new prospect.
