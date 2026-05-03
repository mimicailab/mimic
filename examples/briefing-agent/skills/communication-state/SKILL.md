---
name: communication-state
description: Pulls the latest Gmail thread state with the contact and any Slack #deals mentions of the account in the last 14 days. Detects unanswered questions, missed follow-ups, and sentiment shifts. Sub-step inside briefing-prep.
---

# Communication state

The goal is **what was the last word, and is the ball in our court or theirs?**

## Step 1: Gmail thread

Use `gmail_list_messages` or the search/threads endpoint to find recent messages with the contact. Pull the most recent thread that mentions the deal or company. From that thread fetch the last 5 messages.

For each message capture:

- Sender, recipient, date
- Subject
- A 1–2 sentence summary of the body (not the full body)

Then derive thread-level state:

- **Last sender** — was it us or them?
- **Open status** — did the recipient open the message? (If Gmail exposes opens.)
- **Outstanding question** — any unanswered question from the most recent message
- **Attachments** — was a security questionnaire / contract / SOC 2 package sent?

## Step 2: Slack #deals

Use `slack_search_messages` (or list channel history filtered by keyword) for the account name in `#deals`, `#sales`, and any deal-specific channels in the last 14 days. For each hit return:

- Channel, author, timestamp
- The message text (verbatim if short, paraphrased if long)

Prefer messages that contain a name from the deal team or a stage-defining keyword (procurement, legal, signed, lost, slipping).

## Output shape

```
gmail:
  thread_subject: "Cumulus + Northwind — SOC 2 docs"
  last_5:
    - 2026-04-22 09:04 | sarah@cumulus.io → priya@northwind.com
      Sent the full SOC 2 package + ISO 27001 attestation.
    - 2026-04-21 17:30 | priya@northwind.com → sarah@cumulus.io
      Asked for the SOC 2 docs ahead of legal review.
    ...
  state:
    last_sender: us
    priya_opened: false
    outstanding_question: none on our side; legal review starts Mon
    attachments_sent: SOC 2 package (2026-04-22)
slack:
  - 2026-04-24 | mike in #deals
    "Priya is the deciding vote, get her comfortable on SOC 2."
  - 2026-04-22 | sarah in #deals
    "Sent SOC 2 package, will follow up Friday if no read."
```

## Rules

- Read-only. Do not draft or send replies — the briefing is informational.
- If Gmail returns no thread, omit the gmail section entirely.
- If Slack returns no mentions in the last 14 days, omit the slack section entirely.
- Do not paraphrase Slack messages so heavily that the original sentiment is lost — the AE wants the actual quote when one is available.
