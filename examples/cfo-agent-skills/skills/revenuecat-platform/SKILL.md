---
name: revenuecat-platform
description: RevenueCat specialist — mobile (iOS + Android) app subscriptions for Verida Analytics (~£15k MRR, ~12% of total). Currently down ~23% this week due to an Apple App Store outage on Tuesday. Sub-step inside cfo-briefing. Read-only.
---

# RevenueCat platform

**What this platform owns:** Verida's mobile app subscriptions. ~618 paying mobile subscribers, ~£15k MRR, ~12% of total. Split across iOS (App Store) and Android (Play Store). **Known incident:** Apple App Store outage on Tuesday this week caused a ~23% dip in App Store new-subscription activations — surface this in the answer whenever the operator's question touches recent revenue.

Sub-step inside `cfo-briefing`. Do not invoke standalone unless the operator names mobile / RevenueCat.

## Step 1 — Pull active entitlements / subscriptions

Use RevenueCat's `list_subscribers` (or `get_subscriber` over the active set). Filter to active entitlements. Paginate until exhausted.

Capture per subscriber:

- App Store ID / Play Store ID
- `store` (`APP_STORE` / `PLAY_STORE`)
- `product_identifier` (maps to plan)
- `price` in **pence** (RevenueCat normalises to the base currency — GBP for this account)
- `period_type` (NORMAL / TRIAL / INTRO)

## Step 2 — Compute MRR + store breakdown

Sum active subscriptions' monthly-equivalent into `mrr_pence`. Break down by store:

- `app_store` (iOS)
- `play_store` (Android)

The App Store dip is the headline if the operator's question is about "this week" or "what's down".

## Step 3 — Surface findings relevant to the question

- **MRR / revenue** → `mrr_pence` + active subscriber count + store breakdown.
- **Recent dip / "what's down this week"** → compare last 7 days' new activations to the prior 7 days, broken down by store. If App Store new activations are down materially, surface as a `notes` bullet: "App Store new activations -X% (outage Tue)".
- **Churn** → trial-to-paid conversion in the last 30 days, plus expired entitlements not renewed.
- **Cross-store comparison** → relative share, MoM trend per store.

## Output shape

```
platform: revenuecat
mrr_pence: 1500000
paying_customer_count: 618
store_breakdown:
  app_store:  { customers: 354, mrr_pence: 884000 }
  play_store: { customers: 264, mrr_pence: 616000 }
weekly_activations:
  this_week: { app_store: 18, play_store: 41 }
  prior_week:{ app_store: 47, play_store: 38 }
mom_pct: -2.1          # overall — App Store drag offsets Play Store
notes:
  - App Store new activations -62% this week vs prior (outage Tuesday)
  - Play Store activations +8% — partially offsetting
```

## Rules

- **Read-only.** No write tools on this skill.
- **Paginate** before reporting totals.
- **`price` is in minor units** in RevenueCat's response — treat as pence. £6.99 = `699`. Don't multiply.
- **Annualised mobile subs** contribute monthly-equivalent (`price / 12`).
- If the App Store dip isn't visible in the data (e.g. operator asked about a window that predates Tuesday), don't fabricate it — only surface the incident note when it's actually reflected in the numbers.
