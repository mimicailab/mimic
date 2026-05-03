---
name: briefing-prep
description: Use when the user has an upcoming external meeting and needs context. Pulls from CRM, meeting notes, email, internal Slack, and the product DB in parallel and produces a one-screen briefing. Strictly read-only — never writes to any system.
---

# Pre-call briefing

When the user mentions an upcoming external meeting (or pastes an email address / calendar event), produce a one-screen briefing covering:

- **WHO** — role, recent moves
- **DEAL** — stage, value, slip history
- **LAST CALL** — highlights from the most recent meeting
- **EMAIL** — thread state, unanswered questions
- **PRODUCT** — trial accounts, recent usage at the company
- **INTERNAL** — Slack mentions in #deals
- **ASK** — three specific questions to open with
- **WATCH** — two flags to keep an eye on

## Step 1: Identify the contact

Match the meeting attendee email against CRM records. Call `attio_find_contact` and `hubspot_find_contact` in parallel. If the contact is in both CRMs, prefer Attio (modern stack assumption) but flag any disagreement on stage or deal value as a WATCH item.

## Step 2: Pull deal context

Once the contact is identified, invoke the `deal-context` skill to fetch the current stage, slip history, contract value, and any MEDDPICC-style fields. Pass the account ID, not the contact ID.

## Step 3: Pull conversation history

Invoke the `conversation-history` skill. It will prefer Granola (richer, structured key moments) and fall back to Gong for older calls. You only need the most recent 2–3 calls' worth of highlights.

## Step 4: Pull communication state

Invoke the `communication-state` skill. It returns the last 5 messages in the most relevant Gmail thread plus any Slack #deals mentions of the account in the last 14 days.

## Step 5: Pull product signals

Query the Postgres MCP for users at the contact's email domain. Look for:

- Recent logins (last 7 days)
- New teammate signups (accounts created in the last 14 days at the same domain)
- Feature adoption events
- Churn signals (no logins in 30+ days for a paying account)

If the company isn't in the product DB, omit the section silently.

## Step 6: Synthesize

Produce the brief in this exact format. Keep each section to 1–2 lines. The three questions must be specific to what was last said — not generic. The total brief must fit on a mobile screen (under 200 words).

```
BRIEF FOR: <email> — call in <N> min
─────────────────────────────────────────────
WHO:      <name>, <role> at <company>
          <recent move from LinkedIn or job change>
DEAL:     <currency><value>, <stage>, slipped <N> weeks
LAST CALL (<source>, <day>): <one-line takeaway>
          <commitment or blocker>
EMAIL:    <last action>. <open/unopened/replied>
PRODUCT:  <N teammates trialing>, <N logins>
INTERNAL: <quote or paraphrase from #deals>

ASK:
1. <specific question tied to last call>
2. <specific question tied to email/SOC 2/etc.>
3. <specific question tied to product signals or stakeholders>

WATCH:
⚠ <flag #1 — concrete, time-bound>
⚠ <flag #2 — concrete, time-bound>
```

## Critical rules

- **READ ONLY.** Never call write tools (create, update, delete) even if MCP exposes them. The user trusts this skill specifically because it doesn't touch CRM data.
- If a platform returns nothing, omit that section silently. Do not say "no Slack mentions found" — just skip the line.
- If the contact doesn't exist in any CRM, treat as a net-new prospect: lean on email signal and product DB only.
- Run platform-fetching steps in parallel whenever possible. The user has 5 minutes.
- Resolve company names using the email domain (`priya@northwind.com` → Northwind). The CRM may store the company differently ("Northwind Robotics", "Northwind Inc."); match generously.
