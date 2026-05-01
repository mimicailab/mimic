---
name: conversation-history
description: Pulls the last 2-3 call transcripts/notes for a contact or account, prioritising Granola (structured) and falling back to Gong for older calls. Returns 3-5 most relevant quotes — objections, commitments, blockers. Sub-step inside briefing-prep.
---

# Conversation history

The goal is **what was last said that the AE needs to remember**, not a full transcript dump.

## Step 1: Granola first

Use `granola_list_meetings` filtered by attendee email or company. Take the 2–3 most recent meetings. For each, fetch:

- Date and title
- The structured "key moments" / highlights / action items if Granola exposes them
- Otherwise the summary section

Granola tends to surface objections, commitments, and follow-ups as discrete items — prefer those over the full transcript.

## Step 2: Gong fallback

If Granola has fewer than 2 calls, also pull from Gong. Gong is older calls (pre-Granola adoption). Use the calls API filtered by email/account, then fetch each call's transcript or highlights.

## Step 3: Extract what matters

For each call, pull out **3–5 quotes or paraphrases** that fit one of these categories:

- **Objection** — concern raised, especially security/legal/procurement
- **Commitment** — something the prospect said they would do, with a date
- **Blocker** — something gating progression
- **Stakeholder reveal** — names of new people on their side
- **Pricing or contract reference** — anything specific about value or terms

Skip pleasantries, restating of context, and generic discovery questions.

## Output shape

```
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
- If both Granola and Gong have nothing for this contact, return an empty result — the briefing skill will omit the LAST CALL section.
- Always include the date so the briefing can render "(Granola, Tue)" or similar.
