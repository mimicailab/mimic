---
name: conversation-history
description: Pulls per-source call/meeting counts (Granola, Gong, HubSpot calls, HubSpot meetings) plus 3-5 highlights from the most recent 2-3 calls. Surfaces split-call-history when sources disagree. Sub-step inside briefing-prep.
---

# Conversation history

Two outputs are required and **both** must be returned — do not skip either:

1. **Per-source counts** — full-history counts of meetings/calls per source. The briefing line `calls: N HubSpot calls / N HubSpot meetings / N Granola / N Gong` depends on these.
2. **Highlights** — 3–5 quotes/paraphrases from the most recent 2–3 calls.

Even if all you have is two Granola notes, the per-source counts must list `hubspot_calls: 0`, `hubspot_meetings: 0`, `gong: 0` explicitly so the briefing can detect and surface a "split call history" WATCH item.

## Step 1: Per-source enumeration (full history)

In parallel, fetch counts from every source the MCP exposes:

- `granola_list_meetings` filtered by attendee email or company → `granola_count`
- `gong_list_calls` filtered by email/account → `gong_count`
- `hubspot_list_engagements` (or `hubspot_list_calls`) filtered by company → `hubspot_call_count`
- `hubspot_list_meetings` (or HubSpot engagements of type meeting) filtered by company → `hubspot_meeting_count`

These are **independent counts** that can disagree. Report all four explicitly, even when zero. Do **not**:

- collapse Granola + Gong into a single "external recording" count
- collapse HubSpot calls + HubSpot meetings into a single "HubSpot" count
- merge HubSpot's logged-call count with Granola's note count just because both reference the same meeting

## Step 2: Detect split call history

If any two source counts disagree by more than 1 (e.g. HubSpot has 5 logged calls but Granola has 0 notes; or HubSpot meetings = 3 vs Granola meetings = 5), set `split_call_history: true` and return the per-source numbers. The briefing skill renders this as a WATCH item using your numbers verbatim.

## Step 3: Granola first for highlights

Take the 2–3 most recent Granola meetings. For each, fetch:

- Date and title
- Structured "key moments" / highlights / action items if Granola exposes them
- Otherwise the summary section

Granola surfaces objections, commitments, and follow-ups as discrete items — prefer those over the full transcript.

## Step 4: Gong fallback for highlights

If Granola has fewer than 2 calls, also pull from Gong. Gong is older calls (pre-Granola adoption). Use the calls API filtered by email/account, then fetch each call's transcript or highlights.

## Step 5: Extract what matters

For each call, pull out **3–5 quotes or paraphrases** that fit one of:

- **Objection** — concern raised, especially security/legal/procurement
- **Commitment** — something the prospect said they would do, with a date
- **Blocker** — something gating progression
- **Stakeholder reveal** — names of new people on their side
- **Pricing or contract reference** — anything specific about value or terms

Skip pleasantries, restating of context, and generic discovery questions.

## Output shape

```
counts:
  granola: 5
  gong: 0
  hubspot_calls: 5
  hubspot_meetings: 3
  split_call_history: true   # set when sources disagree by >1
last_calls:
  - source: granola
    date: 2026-04-21
    title: Northwind / Cumulus — exec alignment
    highlights:
      - OBJECTION: SOC 2 — Priya wants legal review before signing. Legal review starts Mon 2026-04-27.
      - COMMITMENT: Sarah to send SOC 2 package by EOD Wed 2026-04-22.
      - STAKEHOLDER: Raj (eng) and Aisha (platform) will trial the product this week.
  - source: granola
    date: 2026-04-08
    title: Northwind / Cumulus — technical deep-dive
    highlights:
      - OBJECTION: Concerns about Kafka throughput at peak load.
      - COMMITMENT: Cumulus to share benchmarks against Datadog and New Relic.
```

## Rules

- Read-only.
- **Always return all four per-source counts**, even when zero. The briefing skill renders them on the LAST CALL line and uses them to detect a split call history.
- **Never merge HubSpot calls and HubSpot meetings** into a single count — they are separate engagement types in HubSpot and the AE wants both numbers.
- **Set `split_call_history: true`** if any two source counts disagree by more than 1.
- If every source returns zero, set all counts to 0 and an empty `last_calls` list — the briefing skill will omit the LAST CALL section.
- Always include the date so the briefing can render "(Granola, Tue)" or similar.
