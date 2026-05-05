---
name: communication-state
description: Pulls Gmail thread state (last 5 messages + total count + unsent drafts) and Slack #deals mentions (exact mention count + thread count) for the contact/account. Sub-step inside briefing-prep.
---

# Communication state

The goal is **what was the last word, what's drafted but not sent, and is the ball in our court or theirs?**

Three outputs are required — Gmail thread, Gmail drafts, Slack mentions. Do not skip drafts; do not skip exact Slack counts.

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
- **Total message count** — `thread_message_count` for the thread (or, if the relevant communication is spread across multiple threads, the inbox-wide total for this contact). Return the exact number.

## Step 2: Gmail drafts (unsent)

Equally important: pull **unsent drafts** addressed to anyone at the contact's email domain. Use `gmail_list_drafts` (or the equivalent drafts endpoint).

For each draft capture:

- Recipient
- Subject (include keywords like `SOC 2`, `follow-up`, `check`, `trial` if present in the subject — these often indicate the commitment that wasn't delivered)
- Date created / last edited
- A 1–2 sentence summary of the body

Return `drafts.count` even when zero. A non-zero draft count is a load-bearing signal: a reply that was written but never sent is a commitment-not-delivered, and the AE needs to know about it before the call. The briefing skill will surface every draft on the EMAIL line and add a WATCH item if material.

## Step 3: Slack #deals

Use `slack_search_messages` (or list channel history filtered by keyword) for the account name in `#deals`, `#sales`, and any deal-specific channels in the last 14 days.

Capture and return as **exact integers**:

- `mention_count` — total messages mentioning the account
- `thread_count` — distinct Slack threads those messages live in
- `hits` — for each: channel, author, timestamp, message text (verbatim if short, paraphrased if long)

Prefer messages that contain a name from the deal team or a stage-defining keyword (procurement, legal, signed, lost, slipping). Note that Slack data is **independent** of any CRM activity — if `mention_count` happens to equal another count surfaced elsewhere in the brief (e.g. an Attio comment count), the briefing skill will flag the coincidence; you just need to return the accurate number.

## Output shape

```
gmail:
  thread_subject: "Cumulus + Northwind — SOC 2 docs"
  thread_message_count: 47
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
  drafts:
    count: 2
    items:
      - to: priya@northwind.com
        subject: "Re: SOC 2 follow-up"
        last_edited: 2026-04-30
        summary: "Drafted check-in re SOC 2 status; never sent."
      - to: raj@northwind.com
        subject: "Trial check-in"
        last_edited: 2026-05-01
        summary: "Drafted trial follow-up; never sent."
slack:
  mention_count: 18
  thread_count: 3
  hits:
    - 2026-04-24 | mike in #deals
      "Priya is the deciding vote, get her comfortable on SOC 2."
    - 2026-04-22 | sarah in #deals
      "Sent SOC 2 package, will follow up Friday if no read."
```

## Rules

- Read-only. Do not draft or send replies — the briefing is informational.
- **Always pull drafts** in step 2, even when the inbox looks current. Return `drafts.count` (zero is acceptable; omitting is not).
- **Always return exact `mention_count` and `thread_count`** for Slack — never approximate (`~7`, `a handful`). Zero is valid; absence is not.
- **Always return `thread_message_count`** for Gmail — the briefing uses it for `<N> messages on thread` and for any inbox-volume signal.
- If Gmail returns no thread, omit `last_5` and `state` but still return `drafts` (drafts can exist without a recent thread).
- If Slack returns no mentions in the last 14 days, set `mention_count: 0` and `thread_count: 0` and omit `hits` — the briefing skill will skip the INTERNAL line.
- Do not paraphrase Slack messages so heavily that the original sentiment is lost — the AE wants the actual quote when one is available.
