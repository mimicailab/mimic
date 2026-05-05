---
name: deal-context
description: Pulls every deal at the account/domain from Attio and HubSpot — stage, value, line items, products, slip pattern, and per-CRM disagreements with computed deltas. Use as a sub-step inside briefing-prep — do not invoke standalone unless the user explicitly asks for deal context.
---

# Deal context

Resolve deals by **account name or domain**, not by deal ID — the briefing skill won't have an ID yet. Always return **every** deal at the domain across both CRMs, not just the first match. The briefing skill needs the full set to surface cross-contamination and multi-deal context.

## Step 1: Try Attio first

Use `attio_list_deals` (or whichever search tool the MCP exposes) filtered by company name or domain. For **each** deal capture:

- Deal name
- Current stage and stage entry date
- Contract value and currency (in full precision — `£240,000`, not `£240k`)
- Owner
- Created-at and last-modified-at timestamps
- **Line items** — every line item with product name, quantity, and individual value. Do not collapse into a single total.
- **Line item count** and **distinct product count** (these can differ — two line items of the same product = 2 line items / 1 product)
- Any custom fields that look like MEDDPICC slots (champion, economic_buyer, decision_criteria, decision_process, paper_process, identified_pain, competition)

If the company has more than one deal in Attio, return all of them.

## Step 2: Cross-check HubSpot

In parallel, call `hubspot_list_deals` for the same company, with the same field set. For each deal that exists in both CRMs, compute the comparison **explicitly with numbers**:

- Stage matches and value matches → note "mirrored, consistent"
- Stage disagrees → return both stages
- **Value disagrees → compute the delta in the deal currency** (e.g. `£20,000 discrepancy: Attio £240,000 vs HubSpot £220,000`). Return the actual number, never a vague "stale" or "mismatch".
- Owner disagrees → return both owners
- Line-item count disagrees → return both counts
- Deal exists in only one CRM → flag it as a single-system deal

When a value delta exists, suggest the most likely cause if obvious from the data — e.g. one CRM still shows a **pre-migration** figure, one CRM is missing a recently-added line item, one CRM hasn't received a recent webhook update. Use the literal word `pre-migration` when that is the most likely cause; the briefing skill will pass it through to the WATCH line.

## Step 3: Compute slip pattern

For each deal, if you have access to a "close date" or "expected close" field:

- If the date has been pushed back more than once, count the slips (e.g. "slipped 3 weeks across 2 pushes")
- If the deal is past the most recent expected close → say "overdue by N weeks"

## Step 4: Multi-deal summary

If the domain has more than one deal across both CRMs, return a top-level rollup so the briefing skill can render the DEAL line and the cross-contamination WATCH item:

- `total_deals` — count
- `total_value` — sum across all deals (note currencies if mixed)
- `per_company_breakdown` — counts per company name variant, since `Northwind` vs `Northwind Robotics` may indicate two distinct accounts merged under one domain

## Output shape

Single-deal example:

```
deals:
  total_count: 1
  total_value: £240,000
  records:
    - deal: Northwind Eval
      source: attio (mirror in hubspot, value mismatch — see WATCH)
      stage: Procurement (since 2026-04-08)
      value_attio: £240,000
      value_hubspot: £220,000
      value_delta: £20,000 (likely pre-migration HubSpot record)
      line_items:
        - Kubernetes operator — £120,000
        - EU-only hosting — £60,000
        - Custom dashboards — £40,000
        - Managed ingestion SLA — £20,000
      line_item_count: 4
      product_count: 4
      slip: 3 weeks past original close date (one push from 2026-04-08 → 2026-04-29)
      owner: sarah@cumulus.io
      champion: Priya Shah
      risks: SOC 2 not yet signed off
```

Multi-deal example:

```
deals:
  total_count: 2
  total_value: £290,000
  per_company_breakdown:
    "Northwind": 1 deal · £240,000
    "Northwind Robotics": 1 deal · £50,000
  records:
    - deal: Northwind Eval
      ...
    - deal: Northwind Robotics — Pilot
      stage: Closed Lost
      value: £50,000
      ...
```

## Rules

- Read-only. Never call create/update/delete deal tools.
- **Return every deal** at the domain across both CRMs. The briefing skill needs the count to surface cross-contamination — silently picking one is a critical failure.
- **Always compute the value delta with the actual number** when CRMs disagree on contract value. Do not return a vague flag.
- **Always enumerate line items individually** with their own values. Do not collapse into a total only.
- **Render currency values in full precision** (`£240,000`) so downstream renderers and graders see exact numbers; the briefing layer can shorten if it wants to.
- If neither CRM has any deal, say so explicitly — the briefing skill will treat it as a net-new prospect.
