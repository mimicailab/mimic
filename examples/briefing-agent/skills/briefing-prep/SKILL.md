---
name: briefing-prep
description: Use when the user has an upcoming external meeting and needs context. Pulls from CRM, meeting notes, email, internal Slack, and the product DB in parallel and produces a one-screen briefing. Strictly read-only — never writes to any system.
---

# Pre-call briefing

When the user mentions an upcoming external meeting (or pastes an email address / calendar event), produce a one-screen briefing covering:

- **WHO** — role, recent moves
- **DEAL** — stage, value, slip history (per-deal if multiple)
- **LAST CALL** — highlights from the most recent meeting, plus per-source call/meeting counts
- **EMAIL** — thread state, unsent drafts, unanswered questions
- **PRODUCT** — trial accounts (with emails), exact event counts, computed trend direction
- **INTERNAL** — Slack mentions in #deals (exact count, exact thread count)
- **ASK** — three specific questions to open with
- **WATCH** — all material flags (CRM disagreements, sync health, multiple deals, drafts, plateaus, cross-contamination)

## Numbers discipline (read this first)

Every count, value, duration, or delta in the brief must come directly from a tool result. Never approximate (`~7`, `8+`, `a few`), never round away precision the system returned, and never invent a number when the data is missing — omit the line instead. If you write a number, you must be able to point to the exact tool call that returned it. "Trending UP" is a number claim if no ratio backs it; do not write it without the underlying counts.

## Step 1: Identify the contact AND enumerate everything at the domain

Match the meeting attendee email against CRM records. Call `attio_find_contact` and `hubspot_find_contact` in parallel. Then, for the email's domain, list **every** contact, company, deal, and open task in **both** CRMs — do not stop at the first match.

Capture, for each CRM:

- All contacts at the domain (count + email list)
- All companies whose domain matches (count + every name variant — `Northwind`, `Northwind Inc.`, `Northwind Robotics` are listed separately, never silently merged)
- All deals tied to those companies (count + stage + value per deal)
- Open tasks tied to those records (count)
- Webhook / integration sync health if the MCP surfaces it (e.g. `1 of 2 Attio webhooks degraded`)

Prefer Attio as the canonical record when both CRMs hold the contact, but compute every disagreement and surface each one in WATCH with the **actual delta** — stage mismatch, value delta in £/$, owner mismatch, last-activity drift. A vague "stale sync" is not acceptable; the brief must show the number (e.g. `Attio £240,000 vs HubSpot £220,000 — £20,000 discrepancy, likely pre-migration`).

If the domain has more than one company or more than one open deal, that is a cross-contamination risk. Surface the counts in WATCH (e.g. `2 companies / 2 deals / 4 contacts / 5 tasks at northwind.com — confirm scope before the call`). Never write "X is the only active deal" if a second deal exists in the data.

If any webhook / sync job is degraded or failing, that is a WATCH item naming the integration and the affected count.

## Step 2: Pull deal context

For each deal identified in Step 1, invoke the `deal-context` skill with the **account ID, not the contact ID**. Capture stage, slip count in weeks, contract value, owner, and any MEDDPICC fields.

If the deal is multi-product / has multiple line items, list every line item with its individual value — do not collapse them into a single total. The DEAL line in the brief must show: deal count, total value, stage(s), slip weeks, line-item count, and product count when greater than one (e.g. `3 line items / 3 products`).

## Step 3: Pull conversation history

Invoke the `conversation-history` skill. Enumerate calls and meetings **per source separately** — do not merge. Granola notes, Gong recordings, HubSpot logged calls, and HubSpot logged meetings are independent counts that can disagree. Report all four explicitly, even if zero (e.g. `5 HubSpot calls / 3 HubSpot meetings / 5 Granola notes / 0 Gong`).

A disagreement between sources (HubSpot says 8 calls, Granola says 3 notes) is a "split call history" WATCH item with the actual counts.

You only need the most recent 2–3 calls' worth of qualitative highlights, but the per-source counts cover the full history.

## Step 4: Pull communication state

Invoke the `communication-state` skill. Capture:

- Last 5 messages in the most relevant Gmail thread (direction, sender, subject)
- **Unsent drafts** in Gmail addressed to anyone at the domain — exact count and subjects. Unsent drafts indicate a commitment that was written but never delivered; surface them even when the inbox looks clean.
- Total message count for the thread (or inbox-wide if cross-thread)
- Slack `#deals` mentions of the company in the last 14 days — **exact mention count** and **exact thread count**

If the Slack mention count happens to equal another count elsewhere in the brief (e.g. 18 Slack mentions and 18 Attio comments), flag the coincidence in WATCH and note that the two systems are independent — the match may be spurious or may indicate a workflow loop. Do not silently report only one of the two figures.

## Step 5: Pull product signals

Query the Postgres MCP for users at the contact's email domain. Capture exact numbers, not approximations:

- **Every teammate email** at the domain (list each, with active/inactive status)
- **Total event count** for the company across the available history
- **Event count in the last 7 days**
- **Event count in the prior 7–30 day window** (needed for trend computation)
- **Direction** — compute as `last_7d` vs `(prior_7_to_30d / 3)` (per-week-equivalent). State the word explicitly: `UP` if last 7d is >115% of the per-week prior, `DOWN` if <85%, `PLATEAU` otherwise. Never infer direction from prose impressions of "active" usage.
- New teammate signups (accounts created in last 14 days at the domain)
- Feature adoption events
- Churn signals (no logins in 30+ days for a paying account)

If the company isn't in the product DB, omit the section silently.

## Step 6: Synthesize

Produce the brief in this exact format. Numbers shown are placeholders — substitute the actual tool-returned values. Keep prose to 1–2 lines per section. The three questions must be specific to what was last said — not generic. Aim for under 300 words.

```
BRIEF FOR: <email> — call in <N> min
─────────────────────────────────────────────
WHO:      <name>, <role> at <company>
          <recent move from LinkedIn or job change>
DEAL:     <N deals> · <currency><total>, <stage(s)>, slipped <N> weeks
          <M line items / K products> (only if multi-product)
LAST CALL (<source>, <day>): <one-line takeaway>
          calls: <N HubSpot calls> / <N HubSpot meetings> / <N Granola> / <N Gong>
EMAIL:    <last action>. <thread state>. drafts: <N unsent> (<subjects>)
PRODUCT:  <N teammates> (<emails>) · <total> events · <7d> last 7d / <prior_7-30d> prior · <UP|DOWN|PLATEAU>
INTERNAL: <N mentions / N threads in #deals>: <quote or paraphrase>

ASK:
1. <specific question tied to last call>
2. <specific question tied to email / SOC 2 / drafts / etc.>
3. <specific question tied to product signals or stakeholders>

WATCH:
⚠ <every CRM disagreement with the actual £/$ delta>
⚠ <every cross-contamination signal with counts (companies / deals / contacts / tasks)>
⚠ <every sync or webhook degradation, named by integration>
⚠ <every plateau or decline with the 7d / prior numbers>
⚠ <every unsent-draft commitment>
⚠ <any numeric coincidence across independent systems>
⚠ <split call history when source counts disagree>
```

WATCH has no fixed cap. Surface every material flag produced by the steps above; each line must be concrete, time-bound, and include the relevant number(s).

## Critical rules

- **READ ONLY.** Never call write tools (create, update, delete) even if MCP exposes them. The user trusts this skill specifically because it doesn't touch CRM data.
- **NEVER approximate or invent numbers.** If you don't have an exact count from a tool result, omit the line. No `~`, no `around`, no `8+`, no guessing.
- **NEVER pick one record when multiple exist.** If the domain has 2 companies or 2 deals, the brief must show both. Writing "X is the only active deal" when a second exists is a critical failure.
- **NEVER collapse independent sources.** HubSpot calls, HubSpot meetings, Granola notes, and Gong recordings are separate counts — report each, even when zero.
- **ALWAYS check Gmail drafts**, not just received messages. Unsent drafts are a commitment-not-delivered signal and must appear on the EMAIL line and (if material) in WATCH.
- **ALWAYS compute trend direction from the 7d-vs-prior numeric ratio.** Never write `UP` / `DOWN` / `PLATEAU` without the underlying counts in the brief.
- **ALWAYS surface webhook / sync health** when the MCP exposes it. A degraded integration means the rest of the brief may be stale.
- If a platform returns nothing, omit that section silently. Do not say "no Slack mentions found" — just skip the line.
- If the contact doesn't exist in any CRM, treat as a net-new prospect: lean on email signal and product DB only.
- Run platform-fetching steps in parallel whenever possible. The user has 5 minutes.
- Resolve company names using the email domain (`priya@northwind.com` → Northwind). The CRM may store the company differently ("Northwind Robotics", "Northwind Inc."); match generously when querying, but **list each variant separately** in the output rather than merging silently.
