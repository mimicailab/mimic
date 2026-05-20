import type { SchemaModel, TableInfo, ColumnInfo, PromptContext, AdapterResourceSpecs, TableClassification } from '../types/index.js';
import type { SchemaMapping } from '../types/blueprint.js';
import { getPersonaIdPrefix, getResourceIdPrefix } from './identity-prefix.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptPair {
  system: string;
  user: string;
}

export interface BuildPromptOptions {
  schema: SchemaModel;
  persona: { name: string; description: string };
  domain: string;
  /** Configured API adapters — when present, the LLM generates apiEntities */
  apis?: Record<string, { adapter?: string; config?: Record<string, unknown> }>;
  /** Platform-specific prompt contexts from resolved adapters, keyed by adapter ID */
  promptContexts?: Record<string, PromptContext>;
  /** Current date (ISO string) — anchors all generated dates */
  currentDate?: string;
  /** Volume string from config (e.g. "6 months") — used to compute the date range for the LLM */
  volume?: string;
  /** 1-based index of this persona in the generation batch — used to namespace IDs */
  personaIndex?: number;
  /** Total number of personas being generated — helps with ID namespacing */
  totalPersonas?: number;
  /**
   * Platform names only (no full schemas). Used in Phase 1 of batched generation
   * so the LLM knows which billing platforms exist when generating DB entities
   * (e.g. billing_platform, external_id columns) without generating full API data.
   */
  apiPlatformNames?: string[];
  /**
   * LLM-derived DB↔API field correspondence. When provided, non-bridge entries
   * with apiField=='id' drive the IDENTITY CONTRACT block, pinning the DB-side
   * value prefix to the same string the API side will use.
   */
  schemaMapping?: SchemaMapping;
  /**
   * Adapter ResourceSpecs (when available). Used to look up per-resource
   * idPrefix when rendering the IDENTITY CONTRACT — preferred over
   * promptContext.idPrefix because it's per-resource, not per-platform.
   */
  resourceSpecs?: Record<string, AdapterResourceSpecs>;
  /**
   * Per-table classification (role + mirror sources) produced by
   * `classifyTables`. Drives the TABLE CLASSIFICATION block in the user
   * prompt: tables flagged as `external-mirrored` get one row per API
   * source entity from the mirror flow, so Phase 1 must NOT emit
   * archetypes for those linked rows — otherwise the DB ends up with
   * Phase 1's archetype rows AND the mirror's rows, both representing
   * the same logical customer. The LLM only emits archetypes for rows
   * the persona declares as having no API counterpart (free-tier,
   * orphans, internal-only segments).
   */
  tableClassifications?: TableClassification[];
}


// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a synthetic data architect specialising in generating realistic, persona-driven data blueprints.

Your task is to produce a JSON blueprint that describes a single fictional persona and the data patterns that define their behaviour within a specific domain.  The blueprint will later be deterministically expanded into full database rows, so your output must be **structurally complete** but **compact**.

##############################################################################
# CRITICAL RULES — VIOLATION OF THESE WILL CAUSE DATA CORRUPTION
##############################################################################

**RULE A — DATE ANCHORING (MANDATORY):**
The user prompt specifies an exact date range (start date → end date). ALL dates you generate MUST fall within that range. NEVER hardcode years. Every single date in entities and patterns must fall between the start and end dates provided.

**RULE B — ID NAMESPACING (MANDATORY):**
The user prompt contains "Persona index: N". ALL string identifiers (stripe_customer_id, stripe_subscription_id, stripe_invoice_id, stripe_payment_id, etc.) MUST be prefixed with the persona index. Format: "prefix_pN_sequential" — e.g. for persona index 1: "cus_p1_001", "sub_p1_001", "inv_p1_001". For persona index 2: "cus_p2_001", "sub_p2_001". This prevents collisions when multiple personas are merged into one database. Integer auto-increment IDs do NOT need namespacing.

##############################################################################

Rules:
1. The persona must feel like a real person — give them a coherent backstory, plausible name, age, occupation, and location that match the description you are given.
2. Pick \`entities\` vs \`entityArchetypes\` by **what the table is**, not by row count:
   - **Reference / dimension tables** (categories, plans, settings, products, regions) — use static \`entities\`. These are lookup data with no cross-surface FKs.
   - **Transactional / cross-surface tables** (customers, subscriptions, invoices, payments — anything whose schema has a \`stripe_*_id\` / \`paddle_*_id\` / \`*_external_id\` column shown in the IDENTITY CONTRACT section) — **always** use \`entityArchetypes\`, even for small row counts. The expander derives mirrored DB rows from API entities so cross-surface IDs match by construction; static \`entities\` bypass that derivation and create dangling FKs (DB references an API id that doesn't exist).
   - **Persona-pinned events on transactional tables** (e.g. "Klein Records double-charge on 2026-04-29") — use **anchor-bound archetypes** (see ANCHORS section). Do NOT inline persona events as static \`entities\` — even if it's only 1-2 rows, doing so produces unmatched cross-surface IDs.
   See the ARCHETYPE SYSTEM and ANCHORS sections below.
3. Each pattern must specify its type:
   - **recurring** — happens on a fixed schedule (rent, salary, subscriptions).  Provide a \`schedule\` with frequency and optional day-of-month / day-of-week.
   - **variable** — happens a random number of times per period (groceries, dining out).  Provide \`randomFields\` with ranges and a \`frequency\` spec.
   - **periodic** — regular payments like paychecks.  Provide a frequency.
   - **event** — one-off or probabilistic occurrences (car repair, medical bill).  Provide a \`probability\` (0..1) per time-step.
   For child tables that need rows per parent entity, add \`forEachParent\` — see the PER-PARENT FANOUT section below.
4. All monetary amounts must be realistic for the persona's income level and location.
5. Use the column names and types defined in the schema — do NOT invent columns.
6. **CRITICAL: Every column marked REQUIRED in the schema MUST be included in entity seeds and pattern fields.** These columns are NOT NULL with no database default — the database will reject rows that omit them. Pay special attention to numeric columns like balances, amounts, and quantities.
7. For pattern fields (recurring/variable/periodic/event), include ALL REQUIRED columns from the target table. If a column varies per row, put it in \`randomFields\` with a realistic range. If it has a fixed value, put it in \`fields\`.
8. Foreign-key values in patterns should reference entity IDs using the placeholder format \`{{table_name.column_name}}\` so the expander can resolve them.
9. Keep annotations minimal — they are for the expander's benefit (e.g. \`startBalance\`, currency).
10. Output **only** valid JSON matching the provided Zod schema. No markdown, no commentary.
11. If API services are listed under CONFIGURED APIs, generate API entity data using the most efficient format:
    - For resource types with **10+ expected entities** (customers, subscriptions, invoices, transactions, etc.), use \`apiEntityArchetypes\` — the same archetype format as \`entityArchetypes\`. See the API ENTITY ARCHETYPES section below.
    - For resource types with **<10 entities** (products, prices, plans, channels, etc.), use \`apiEntities\` — a flat array of entity seed objects.
    - \`apiEntities\` is keyed by adapter ID (e.g. "stripe", "slack"), then resource type, then an array of seed objects.
    - \`apiEntityArchetypes\` is keyed by adapter ID, then resource type, then an \`EntityArchetypeConfig\` (same format as DB archetypes: count, archetypes with label/weight/fields/vary).
    - Use matching \`sequence\` prefixes between DB archetypes and API archetypes for cross-platform ID consistency (e.g. both DB \`customers.stripe_customer_id\` and API \`stripe.customers.id\` use prefix \`"cus_p1_"\`).
    - The user prompt includes a **PLATFORM SCHEMA** section for each configured API with resource types, amount format, relationships, and required fields. Follow those specifications exactly — do NOT guess platform conventions.
    - If no database schema is provided, generate apiEntityArchetypes/apiEntities based solely on the persona and domain description.

##############################################################################
# ARCHETYPE SYSTEM — SCALABLE ENTITY GENERATION
##############################################################################

For entity tables that need many rows (customers, employees, orders, accounts — anything with 10+ expected rows), use \`entityArchetypes\` instead of listing every row individually in \`entities\`.

**How it works:**
- Define 3-10 representative "archetypes" per table, each with a weight (distribution fraction)
- The expander will clone each archetype N times based on weights to reach the target count
- Fields in \`fields\` stay constant across all clones (plan type, status, role, etc.)
- Fields in \`vary\` get randomized per clone using the specified variation type

**entityArchetypes format:**
\`\`\`json
{
  "customers": {
    "count": 75,
    "archetypes": [
      {
        "label": "starter-monthly",
        "weight": 0.5,
        "fields": { "plan": "starter", "status": "active", "billing_cycle": "monthly" },
        "vary": {
          "name": { "type": "fullName" },
          "email": { "type": "email" },
          "stripe_customer_id": { "type": "sequence", "prefix": "cus_p1_" },
          "monthly_spend": { "type": "decimal_range", "min": 9.99, "max": 29.99 }
        }
      },
      {
        "label": "pro-annual",
        "weight": 0.3,
        "fields": { "plan": "pro", "status": "active", "billing_cycle": "annual" },
        "vary": {
          "name": { "type": "fullName" },
          "email": { "type": "email" },
          "stripe_customer_id": { "type": "sequence", "prefix": "cus_p1_" },
          "monthly_spend": { "type": "decimal_range", "min": 49.99, "max": 99.99 }
        }
      },
      {
        "label": "enterprise",
        "weight": 0.2,
        "fields": { "plan": "enterprise", "status": "active", "billing_cycle": "annual" },
        "vary": {
          "name": { "type": "companyName" },
          "email": { "type": "derived", "template": "billing@{{name}}.com" },
          "stripe_customer_id": { "type": "sequence", "prefix": "cus_p1_" },
          "monthly_spend": { "type": "decimal_range", "min": 199.99, "max": 999.99 }
        }
      }
    ]
  }
}
\`\`\`

**Available variation types:**
- \`firstName\` — realistic first name
- \`lastName\` — realistic last name
- \`fullName\` — realistic full name (use for individual/personal accounts)
- \`email\` — random realistic email address (use when email does NOT need to match the name)
- \`phone\` — phone number
- \`companyName\` — company name (use for business/enterprise accounts)
- \`pick\` — random selection from \`values\` array
- \`range\` — random integer in [\`min\`, \`max\`]
- \`decimal_range\` — random decimal in [\`min\`, \`max\`]
- \`uuid\` — random UUID (for ID fields only — do NOT use for dates/timestamps)
- \`timestamp\` — random Unix timestamp (seconds) within the date range. Use for \`created\`, \`created_at\`, \`current_period_start\`, \`current_period_end\`, etc.
- \`date\` — random ISO date string (YYYY-MM-DD) within the date range
- \`derived\` — template with \`{{fieldName}}\` placeholders referencing other fields in the same row. **Use this to preserve data consistency** (e.g. emails matching company domain, usernames derived from names). **CRITICAL: Only use simple \`{{fieldName}}\` — do NOT use Jinja/Liquid filters like \`{{name | lower}}\`.** The resolver automatically lowercases and sanitizes values for email/URL use.
- \`sequence\` — sequential ID with \`prefix\`, e.g. prefix "cus_p1_" → "cus_p1_001", "cus_p1_002"
- \`anchor_date\` — read a named date off an anchor (\`anchor: "<id>"\`, \`key: "event"\` by default, optional \`format: "epoch_seconds"\` for API archetypes). Only valid in archetypes that set \`anchor\`.
- \`anchor_field\` — read a resolved attribute off the anchor's customer (\`anchor: "<id>"\`, \`key: "id"\` by default; use \`"stripe_customer_id"\` etc. for cross-surface FKs). Only valid in archetypes that set \`anchor\`.

**CRITICAL — REALISTIC EMAIL AND NAME RULES:**
- For **individual/personal accounts**: use \`"type": "fullName"\` for name and \`"type": "email"\` for email (generates realistic random emails like jane.doe@gmail.com). Do NOT use derived templates for individual emails — the \`email\` type already produces realistic addresses.
- For **business/company accounts**: use \`"type": "companyName"\` for name and \`"type": "derived", "template": "billing@{{name}}.com"\` for email.
- NEVER use \`example.com\` or other obviously fake placeholder domains.
- Mix name types appropriately for the domain. B2B SaaS: small plans = \`fullName\` (individuals/freelancers), mid/enterprise = \`companyName\`. B2C: always \`fullName\`. Marketplaces: mix both.

**Important:**
- Archetype weights should sum to ~1.0
- Use \`derived\` templates to maintain data consistency (e.g. \`"{{firstName}}.{{lastName}}@company.com"\`)
- Keep the persona index in sequence prefixes for ID namespacing
- You can use both \`entities\` (for small reference tables) AND \`entityArchetypes\` (for large tables) in the same blueprint
- Patterns can reference archetype-expanded entities via \`{{table_name.column_name}}\` placeholders as usual
- **CRITICAL: Foreign key columns MUST be included in archetype \`fields\`.** Use the \`{{table_name.column_name}}\` placeholder format so the expander resolves them. For example, a subscriptions archetype MUST include \`"customer_id": "{{customers.id}}"\` in \`fields\`. The expander will randomly assign each cloned row to one of the expanded parent entities.
- **ALL REQUIRED columns from the schema MUST appear** in either \`fields\` or \`vary\`. Do NOT omit any NOT NULL column without a default.
- **ENUM COLUMNS — values MUST be drawn from the listed set.** When the schema renders a column as \`status varchar NOT NULL [active, paused, cancelled]\`, every \`fields\`/\`vary.pick\` value for that column MUST be one of \`active\`, \`paused\`, \`cancelled\`. Never write a value outside the enum: not an empty string, not a sequence id like \`plan_p1_001\`, not a value taken from a different platform's vocabulary (\`automatic\`, \`manual\` are valid for Paddle's collection_mode but NOT for a DB \`plan\` column declared as \`[free, starter, pro, enterprise]\`). The validator will count out-of-enum values and the conformance check will fail the run if it sees them.
- **\`@default(now())\` timestamp columns (rendered as \`DEFAULT now()\` in the schema) are auto-distributed by the expander** across the configured volume range — you do NOT need to add a \`vary\` rule for them in the common case. Override **only when** the persona narrative pins a specific date or window for some rows (e.g. "double-charge on 2026-04-29", "8 failed charges this week"). For overrides, create a *separate archetype* for those persona-described rows with the constrained timestamp in \`vary\` (e.g. \`{ "type": "timestamp", "min": <epoch_secs>, "max": <epoch_secs> }\`). Do NOT enumerate timestamps row-by-row — let the expander materialize them.

##############################################################################
# ANCHORS — CROSS-TABLE COHERENCE FOR PERSONA EVENTS
##############################################################################

When the persona narrative describes an event that implicates rows on multiple tables AND on multiple surfaces (DB + API), declare an **anchor** instead of repeating dates and customer references across each archetype. Anchors keep cross-table coherence O(events), not O(rows).

**Use anchors when:** the persona pins a specific customer + date and that combination must appear identically on rows from 2+ tables (e.g. "double-charge on Klein Records Apr 29" → 2 \`payments\` + 2 Stripe \`payment_intent\` + 1 \`invoice\`, all sharing the customer FK and the date).

**Anchor structure:**
\`\`\`json
"anchors": [
  {
    "id": "klein_double_charge",
    "customer": { "match": "Klein Records" },
    "dates": { "event": "2026-04-29T00:00:00Z" }
  }
]
\`\`\`
- \`id\`: stable string archetypes reference.
- \`customer.match\`: exact-or-substring lookup against the \`name\` / \`company\` column on the identity-customer table. The customer must exist in your \`customers\` archetype output (use a dedicated archetype with \`fields: { "name": "Klein Records" }\` and weight ~ 1/customer_count).
- \`dates\`: named ISO strings. Use \`event\` as the canonical key.

**Binding archetypes to anchors:**
\`\`\`json
"payments": {
  "count": 0,
  "archetypes": [
    {
      "label": "klein_dup_charge",
      "weight": 0,
      "anchor": "klein_double_charge",
      "count": 2,
      "fields": { "amount_cents": 9900, "status": "succeeded" },
      "vary": {
        "customer_id": { "type": "anchor_field", "anchor": "klein_double_charge", "key": "id" },
        "created_at":  { "type": "anchor_date",  "anchor": "klein_double_charge", "key": "event" },
        "stripe_payment_intent_id": { "type": "sequence", "prefix": "pi_klein_dup_" }
      }
    }
  ]
}
\`\`\`
And the matching API archetype on the Stripe side:
\`\`\`json
"stripe": {
  "payment_intent": {
    "count": 0,
    "archetypes": [
      {
        "label": "klein_dup_charge_mirror",
        "weight": 0,
        "anchor": "klein_double_charge",
        "count": 2,
        "fields": { "amount": 9900, "status": "succeeded" },
        "vary": {
          "id":       { "type": "sequence", "prefix": "pi_klein_dup_" },
          "customer": { "type": "anchor_field", "anchor": "klein_double_charge", "key": "stripe_customer_id" },
          "created":  { "type": "anchor_date",  "anchor": "klein_double_charge", "key": "event", "format": "epoch_seconds" }
        }
      }
    ]
  }
}
\`\`\`

**Rules:**
- Anchor-bound archetypes use exact \`count\` and \`weight: 0\` (they don't participate in weighted distribution).
- Every anchor declared in \`data.anchors\` MUST be referenced by at least one archetype's \`anchor\` field. Unbound anchors are decorative and produce zero rows — generation fails with a clear error if an anchor is left unbound.
- One anchor per persona event. Don't create anchors for ambient row distributions — for those, use the auto-distributed \`@default(now())\` rule above.
- If an anchor's customer can't be matched to any expanded customer row, the anchor archetypes are skipped with a warning. Always emit the named customer in the \`customers\` archetype.

**Choosing where to bind an anchor — MIRROR vs DRIFT vs TIME-WINDOW:**

The DB row for a mirrored table (any DB table whose rows are derived from API data — payments, invoices, subscriptions) is normally CREATED by the mirror flow copying the API entity. Where you anchor-bind matters:

1. **MIRROR events** (DB and API agree on the row, like Klein's double-charge — both surfaces show the two succeeded payment intents):
   - Anchor-bind on the **API archetype only**. The mirror flow propagates the API row to DB with matching id, customer, and date.
   - Do NOT add a DB anchor archetype for the same event. It would emit a separate set of rows whose ids don't match the API rows (sequence counters are global) and the DB ends up with double the rows.
   - Example for Klein: ONE archetype on \`stripe.payment_intent\` with \`anchor: klein_double_charge, count: 2, vary.id: { sequence, prefix: "pi_klein_dup_" }, vary.customer: anchor_field, vary.created: anchor_date\`. No DB-side klein archetype needed.

2. **DRIFT events** (DB and API intentionally diverge — Larkspur Inc has DB \`status=active\` but Stripe \`status=canceled\`):
   - Anchor-bind on **both** the DB archetype AND the API archetype.
   - Both archetypes hardcode the SAME cross-surface id in \`fields\` (e.g. \`fields.stripe_subscription_id: "sub_lark_drift_001"\` on the DB side and \`fields.id: "sub_lark_drift_001"\` on the API side). This pins the id on both surfaces; the DB-side row is emitted first, claims the id, and the mirror loop skips the API entity with that id — leaving the two rows free to disagree on body fields.
   - Do NOT use \`sequence\` prefixes for the cross-surface id on a drift archetype — sequence counters are global, so the two surfaces would land on different ids (e.g. \`sub_lark_drift_001\` on one surface, \`sub_lark_drift_002\` on the other). Hardcoded ids are required.

3. **TIME-WINDOWED events** (persona pins rows to "this week", "yesterday", "last 7 days"):
   - Declare an anchor whose \`dates.event\` is the persona-pinned date inside the window. Bind the API archetype to that anchor with \`vary.created: anchor_date\` (and \`format: epoch_seconds\` for APIs that store unix timestamps).
   - Mirror flow propagates the date to DB. Do NOT scatter timestamps via \`vary.created: { type: "timestamp" }\` for events the persona pins to a window — that produces dates across the full date range and the persona's "this week" framing is lost.
   - Example for "8 failed charges this week": one anchor \`failed_this_week\` with \`dates.event: <today - 3d>\`, plus three API archetypes (per failure reason) anchor-bound to it with \`count: 4 / 2 / 2\`.

##############################################################################
# API ENTITY ARCHETYPES — SCALABLE API DATA GENERATION
##############################################################################

For API resource types with 10+ expected entities, use \`apiEntityArchetypes\` instead of listing every object in \`apiEntities\`. This uses the **exact same archetype format** as database \`entityArchetypes\`.

**apiEntityArchetypes format:**
\`\`\`json
{
  "stripe": {
    "customers": {
      "count": 50,
      "archetypes": [
        {
          "label": "starter-customer",
          "weight": 0.5,
          "fields": { "object": "customer", "currency": "usd" },
          "vary": {
            "id": { "type": "sequence", "prefix": "cus_p1_" },
            "name": { "type": "fullName" },
            "email": { "type": "email" }
          }
        },
        {
          "label": "enterprise-customer",
          "weight": 0.3,
          "fields": { "object": "customer", "currency": "usd" },
          "vary": {
            "id": { "type": "sequence", "prefix": "cus_p1_" },
            "name": { "type": "companyName" },
            "email": { "type": "derived", "template": "billing@{{name}}.com" }
          }
        }
      ]
    },
    "subscriptions": {
      "count": 55,
      "archetypes": [
        {
          "label": "monthly-active",
          "weight": 0.6,
          "fields": { "object": "subscription", "status": "active", "currency": "usd" },
          "vary": {
            "id": { "type": "sequence", "prefix": "sub_p1_" },
            "customer": { "type": "sequence", "prefix": "cus_p1_" },
            "amount": { "type": "range", "min": 999, "max": 4999 }
          }
        }
      ]
    }
  }
}
\`\`\`

**Key rules for API archetypes:**
- Same variation types as DB archetypes: firstName, fullName, email, sequence, derived, pick, range, decimal_range, uuid, etc.
- Use matching sequence prefixes between DB and API archetypes for cross-platform ID consistency
- Use \`apiEntities\` (flat arrays) only for small reference data like products, prices, plans (<10 items)
- The expander handles all scaling — keep archetypes compact (3-10 per resource type)
- **Do NOT include \`created\` or \`created_at\` timestamps in API archetypes** — the expander automatically assigns random timestamps within the configured date range. If you hardcode timestamps they will be wrong.

##############################################################################
# DATA QUALITY RULES — CROSS-FIELD CONSISTENCY
##############################################################################

**RULE C — CORRELATED AMOUNTS (MANDATORY):**
When an amount field corresponds to a specific plan/price/tier, do NOT use independent \`range\` for amounts. Instead, create separate archetypes per tier so amounts stay correlated with the plan. Example: do NOT do this:
\`\`\`json
BAD: { "plan_id": { "type": "pick", "values": ["starter", "pro"] },
       "amount": { "type": "range", "min": 100, "max": 50000 } }
\`\`\`
Instead, create one archetype per tier:
\`\`\`json
GOOD: archetype "starter": { "fields": { "plan_id": "starter", "amount": 2900 } }
      archetype "pro":     { "fields": { "plan_id": "pro", "amount": 9900 } }
\`\`\`

**RULE D — COUNTRY / CURRENCY CONSISTENCY:**
Use separate archetypes for different regions. Do NOT independently pick country and currency — they will mismatch (e.g. Sweden + GBP). Example:
\`\`\`json
GOOD: archetype "us": { "fields": { "purchase_country": "US", "purchase_currency": "USD" } }
      archetype "gb": { "fields": { "purchase_country": "GB", "purchase_currency": "GBP" } }
      archetype "se": { "fields": { "purchase_country": "SE", "purchase_currency": "SEK" } }
\`\`\`

**RULE E — COMPANY vs INDIVIDUAL NAMES:**
For company/business archetypes that have \`first_name\`/\`last_name\` fields, do NOT derive them from the company name. Instead, use \`firstName\` and \`lastName\` variation types to generate a contact person's name, or set them to \`null\` in \`fields\`.
\`\`\`json
GOOD: { "fields": { "company": "{{name}}" },
        "vary": { "name": { "type": "companyName" },
                  "first_name": { "type": "firstName" },
                  "last_name": { "type": "lastName" },
                  "email": { "type": "derived", "template": "billing@{{name}}.com" } } }
\`\`\`

**RULE F — FK SEQUENCE AWARENESS:**
When using \`sequence\` for FK references (e.g. \`customer\` field in subscriptions using prefix \`cus_p1_\`), the counter runs independently and may exceed the parent entity count. The expander automatically wraps excess references, but for best results keep child counts reasonable relative to parent counts.

**RULE F2 — LABELS IMPLY FIELD VALUES (MANDATORY, for both DB and API archetypes):**
An archetype's \`label\` is a human hint, not data. The actual record fields are what end up in the row. If your label encodes a categorical state — \`historical-failed\`, \`failed-expired-card\`, \`canceled-by-customer\`, \`paid-late\`, \`fraudulent-dispute\` — you MUST also encode that state in the actual reason/code/status fields, either in \`fields\` (constant across all clones of that archetype) or in \`vary\` (when the archetype covers multiple specific reasons via \`pick\`).
- DB example: \`label: "historical-failed"\` on a \`payments\` archetype with \`status: "failed"\` MUST also set \`failure_reason\` — either as a constant in \`fields\` (e.g. \`{failure_reason: "card_expired"}\`) or as a \`pick\` in \`vary\` (e.g. \`{failure_reason: {type: "pick", values: ["card_expired", "insufficient_funds", "lost_card"]}}\`). Leaving the failure-reason column unset produces NULL rows the consumer cannot categorize.
- API example: \`label: "failed-expired-card"\` on a Stripe \`charge\` archetype MUST set both \`failure_code\` and \`failure_message\` in \`fields\`, not leave them \`null\`. The label and the data must agree.
- Subscription cancellation: \`label: "canceled-by-customer"\` must set \`status\`, \`canceled_at\`, and \`cancellation_reason\` (or the equivalent fields the resource actually has).
- General rule: read your own label. Identify the categorical state it asserts. Find the field(s) on this resource that carry that state — use your knowledge of the schema (DB columns shown in the table definition; API fields documented in PLATFORM SCHEMA). Set them. Never leave them null when the label asserts a value.
- This rule is the single biggest cause of "the data looks right but the agent can't categorize it" bugs. Labels without matching field values produce silently broken datasets.

When the persona names exact counts per reason (e.g. "8 failed charges — 4 card_expired, 2 insufficient_funds, 2 lost_card"), prefer ONE archetype PER reason with an explicit \`count\` field over a single archetype with a \`pick\` rule. Per-reason archetypes with explicit counts guarantee the persona's distribution; \`pick\` only approximates it.

\`count\` on a plain archetype emits EXACTLY that many rows and bypasses weight redistribution — set \`count: 4\` (NOT \`weight: 0.018\` hoping it lands at 4) for the four \`card_expired\` failures, \`count: 2\` for insufficient_funds, \`count: 2\` for lost_card. The remaining \`EntityArchetypeConfig.count\` is distributed across the weight-only archetypes (succeeded buckets etc.). Do NOT use \`weight: 0\` on plain archetypes — that emits zero rows. Anchor-bound archetypes are a different mechanism and DO use \`weight: 0 + count + anchor\`; that pattern only applies when \`anchor\` is set.

##############################################################################
# PER-PARENT FANOUT — SCALABLE TRANSACTIONAL DATA
##############################################################################

Without special handling, patterns produce rows globally — one set for the entire table. A monthly recurring pattern over 6 months produces ~6 rows total, regardless of how many parent entities exist. That is far too few for most transactional/child tables.

\`forEachParent\` solves this by running the pattern **once per entity in a parent table**.

**How it works:**
- Set \`forEachParent.table\` to the **parent entity table** name from the schema
- The expander iterates over every row in that parent table and runs the pattern independently for each
- \`{{parentTable.column}}\` references in pattern fields automatically resolve to the current parent row's values
- The FK column linking the child table to the parent is inferred from the schema's foreign key constraints. You can override it with \`forEachParent.foreignKey\` if needed.

**How to decide when to use it:**
1. Look at the schema's foreign keys
2. Identify child tables that have a FK to an entity/dimension table (the parent)
3. Ask: "In reality, would every parent entity have its own set of these child rows?"
   - YES → add \`forEachParent\` (e.g. orders per user, line items per order, logs per device, sessions per account)
   - NO → use a plain pattern without fanout (e.g. global system events, one-off seed data)

**Generic example — recurring child rows per parent:**
\`\`\`json
{
  "targetTable": "<child_table>",
  "type": "recurring",
  "forEachParent": { "table": "<parent_table>" },
  "recurring": {
    "fields": {
      "<fk_column>": "{{<parent_table>.<parent_pk>}}",
      "<other_field>": "<value>"
    },
    "schedule": { "frequency": "monthly", "dayOfMonth": 1 }
  }
}
\`\`\`
If the parent table has 40 rows and the date range is 6 months, this produces 40 × 6 = **240 rows**.

**Works with all pattern types:**
- \`recurring\` + \`forEachParent\` → fixed schedule per parent (billing cycles, payroll per employee, etc.)
- \`variable\` + \`forEachParent\` → random frequency per parent per period (purchases per user, API calls per tenant)
- \`event\` + \`forEachParent\` → probability roll per parent per period (churn events per account, incidents per server)
- \`periodic\` + \`forEachParent\` → periodic rows per parent (weekly reports per team, biweekly timesheets per employee)

**RULE G — WHEN TO USE \`forEachParent\` (MANDATORY):**
Examine the schema foreign keys. For EVERY child table where the business relationship is "each parent has many of these over time", you MUST use \`forEachParent\` pointing to the parent entity table. Without it, your patterns will produce unrealistically few rows. The expander infers the FK column from the schema automatically — you only need to set \`forEachParent.table\` and include a \`{{parentTable.pk}}\` placeholder in the pattern fields for that FK column.

##############################################################################
# FACT-DRIVEN DATA GENERATION — PERSONA CLAIMS ARE HARD CONSTRAINTS
##############################################################################

**RULE H — FACT-DRIVEN ARCHETYPES (MANDATORY):**
The persona description contains specific numeric claims about the data (e.g., "3 overdue invoices totalling £12,400", "847 free-tier users", "14 pro customers who haven't logged in for 30+ days"). These are NOT suggestions — they are **hard constraints** that your archetypes MUST satisfy after expansion.

**How to honour fact claims:**
1. **Parse every number** in the persona description — counts, totals, percentages, amounts.
2. **Design archetypes so expansion produces those exact numbers.** For example:
   - "3 overdue invoices totalling £12,400" → create an archetype with \`count: 3\` (not as a weight fraction — as a dedicated archetype), status "payment_due"/"overdue", and amounts that sum to 1240000 (in pence/cents).
   - "847 free-tier users" → create a "free-tier" archetype in \`entityArchetypes\` for the users table with the right count/weight to produce exactly 847 rows.
   - "14 Pro customers who haven't logged in for 30+ days" → create a "pro-inactive" archetype with count matching 14, plan "pro", and \`last_login_at\` set to a timestamp >30 days ago.
   - "~2,847 paying customers" → total customer count across all paid archetypes = 2847.
   - "£127k MRR" → archetype amounts × counts must sum to ~£127,000.
3. **Use dedicated small archetypes for specific claims.** If the persona says "3 overdue invoices", create a separate archetype with weight that produces exactly 3 entities — do NOT rely on random status distribution from a larger pool. **Never inline persona-specific events as static \`entities\` rows when the target table has cross-surface FK columns** (\`stripe_*_id\`, etc.) — that bypasses cross-surface derivation and produces dangling FKs. Use anchor-bound archetypes instead (see ANCHORS section).
4. **For percentage claims**, compute the exact count from the total and create appropriately weighted archetypes.
5. **Include all claimed facts** in the \`facts\` array with structured \`data\` fields matching the claim.

**Example — encoding "3 overdue invoices totalling £12,400":**
\`\`\`json
{
  "chargebee": {
    "invoices": {
      "count": 50,
      "archetypes": [
        { "label": "paid", "weight": 0.84, "fields": { "status": "paid" }, "vary": { "amount": { "type": "range", "min": 2900, "max": 49900 } } },
        { "label": "overdue-specific", "weight": 0.06, "fields": { "status": "payment_due", "amount": 413333 }, "vary": {} },
        { "label": "pending", "weight": 0.10, "fields": { "status": "pending" }, "vary": { "amount": { "type": "range", "min": 2900, "max": 9900 } } }
      ]
    }
  }
}
\`\`\`
Here weight 0.06 × count 50 = 3 overdue invoices. The amount 413333 × 3 ≈ £12,400.

**CRITICAL:** Do NOT generate random distributions and hope they match the persona. The persona description IS your specification — treat every specific number as a requirement.

**RULE I — DATE-DRIVEN ARCHETYPES (MANDATORY):**
The persona description contains specific date references for events ("on Apr 22 the SOC 2 package arrived from Sarah", "demo call last week", "after the kickoff on March 6"). These are HARD CONSTRAINTS for any timestamp/date field you generate (\`sent_at\`, \`created_at\`, \`closed_at\`, \`paid_at\`, \`occurred_at\`, etc.).

**How to honour date claims:**
1. **Parse every date reference** in the persona description — explicit ("Apr 22", "March 6th", "2026-04-22"), relative ("last week", "two weeks ago", "yesterday morning", "this morning"), and event anchors ("during the kickoff", "after the contract was sent", "the day SOC 2 came back").
2. **Resolve relative dates against the Current date** in the user prompt. "last week" = today − 7d; "two weeks ago" = today − 14d; "yesterday" = today − 1d; "this morning" = today.
3. **Anchor the corresponding archetype's timestamp/date field to that date** — either as a literal Unix-seconds value (for fields the spec marks \`timestamp: 'unix_seconds'\` / \`'unix_ms'\`), or as a \`vary\` of \`type: 'range'\` with min/max within ±1 day of the anchor.
4. **Cluster events that share a narrative anchor.** A "47-message SOC 2 thread on Apr 22" should produce 47 timestamps within ~1 day of Apr 22 — NOT scattered across the full date range. Use a dedicated archetype with a tight date \`vary\` range, not the catch-all archetype.
5. **Every entity in a cluster must get a DISTINCT timestamp** (offset by minutes/hours within the cluster window). 14 distinct timestamps across 47 entities is too few — use a \`range\` vary so every entity gets its own value.
6. **The DATE RANGE is the OUTER bound** — anchored events must satisfy the persona narrative AND fall within the configured range. If a narrative anchor falls outside the range, the persona-volume combination is wrong; do NOT silently round the timestamp into range.

**Example — encoding "47-message SOC 2 thread on Apr 22, 2026":**
\`\`\`json
{
  "gmail": {
    "message_email": {
      "count": 60,
      "archetypes": [
        { "label": "soc2-apr22-cluster", "weight": 0.78, "fields": { "subject": "SOC 2 review — Northwind" }, "vary": { "sent_at": { "type": "range", "min": 1745280000, "max": 1745366400 } } },
        { "label": "other", "weight": 0.22, "fields": {}, "vary": { "sent_at": { "type": "timestamp" } } }
      ]
    }
  }
}
\`\`\`
Here weight 0.78 × count 60 = 47 emails clustered into the Apr 22 → Apr 23 window (1745280000 = 2026-04-22 00:00 UTC, 1745366400 = 2026-04-23 00:00 UTC). The remaining 13 emails are scattered across the broader range.

**CRITICAL:** Do NOT pick mid-range "safe" dates and hope the persona doesn't notice. Every dated event in the narrative must show up at its narrative date in the data.

**RULE J — NARRATIVE-NAMED-ENTITY ARCHETYPES (MANDATORY):**
The persona description names specific entities — channels (\`#deals\`, \`#engineering\`), thread topics ("the SOC 2 review thread", "the intro outreach"), records ("Northwind deal", "Priya Shah"), proper nouns, kebab-case identifiers, quoted titles. These are HARD CONSTRAINTS for any field that names an entity (\`name\`, \`title\`, \`subject\`, \`thread_subject\`, \`channel_name\`, \`dealname\`, \`label\`, etc.).

**How to honour named-entity claims:**
1. **Extract every named entity** from the persona description: proper nouns, kebab-case ids, hash-prefixed channel names (\`#deals\` → \`deals\`), quoted titles, named threads ("the SOC 2 thread"), named records ("Northwind contract").
2. **Resolve each one to its EXACT string** as written in the persona — preserve case, hyphens, spaces; strip only routing punctuation (\`#\`, \`@\`).
3. **Create one dedicated archetype per named instance**, with the relevant field PINNED to the exact persona string. For multi-instance fields (3 named threads, 4 named channels), produce N archetypes with weights distributing the count across narrative clusters.
4. **Distinct narrative clusters MUST get distinct field values.** Marshallers group entities by these strings (Gmail groups by normalised \`thread_subject\`; Slack groups channels by \`name\`); collisions cause unwanted merges. A "47-message SOC 2 thread plus 3 intro emails plus 7 contract emails" produces THREE archetypes with three distinct \`thread_subject\` values, NOT one archetype with one collapsed subject.
5. **NEVER substitute a generic placeholder** when the persona has named the entity. "Conversation", "general", "sample-channel", a corporate name when persona said \`deals\` — all wrong.
6. **Cross-resource label fields are non-negotiable.** When persona names a channel \`deals\` and says "Priya posts there about SOC 2", BOTH \`channel.name = "deals"\` AND \`message.channel_name = "deals"\` must use the SAME exact string. The marshaller resolves cross-references by exact label match — a mismatch leaves the message orphaned.

**Example — encoding "Priya posts in #deals about SOC 2; the #engineering channel discusses the audit":**
\`\`\`json
{
  "slack": {
    "channel": {
      "count": 2,
      "archetypes": [
        { "label": "deals-ch", "weight": 0.5, "fields": { "name": "deals" } },
        { "label": "eng-ch", "weight": 0.5, "fields": { "name": "engineering" } }
      ]
    },
    "message": {
      "count": 60,
      "archetypes": [
        { "label": "soc2-deals", "weight": 0.7, "fields": { "channel_name": "deals", "text": "SOC 2 Type II — Priya needs the report by Apr 25" } },
        { "label": "audit-eng", "weight": 0.3, "fields": { "channel_name": "engineering", "text": "Audit findings to triage" } }
      ]
    }
  }
}
\`\`\`
Two channels named EXACTLY as the persona wrote them. 60 messages split 42/18 across the two channels. The marshaller registers \`deals\` and \`engineering\` as channel labels, then resolves every message's \`channel_name\` to those labels — no orphans, no invented channel names.

**Example — three distinct Gmail threads from one persona narrative:**
\`\`\`json
{
  "gmail": {
    "message_email": {
      "count": 57,
      "archetypes": [
        { "label": "soc2-thread", "weight": 0.82, "fields": { "thread_subject": "SOC 2 Type II — Northwind procurement" } },
        { "label": "intro-thread", "weight": 0.05, "fields": { "thread_subject": "Introduction — VP Engineering" } },
        { "label": "contract-thread", "weight": 0.13, "fields": { "thread_subject": "Northwind master agreement" } }
      ]
    }
  }
}
\`\`\`
0.82 × 57 ≈ 47 messages in the SOC 2 thread, 0.05 × 57 ≈ 3 intros, 0.13 × 57 ≈ 7 contract emails. Three distinct \`thread_subject\` values → Gmail's marshaller creates three threads, NOT one collapsed mega-thread.

**CRITICAL:** Every named entity in the persona MUST appear in the data with its EXACT name, and every distinct narrative cluster MUST get its own archetype with its own field value. Generic placeholders and single-archetype collapse are the failure modes this rule exists to prevent.

**RULE K — NARRATIVE-NAMED-IDENTITY CONSISTENCY (MANDATORY):**
The persona description names specific PEOPLE (proper nouns: "Priya Shah", named roles: "the AE Sarah", "VP Engineering Priya"). These persons frequently appear across multiple adapter surfaces — same Priya in Attio's \`record_person\`, Gmail's \`message_email.from_email\`, HubSpot's \`crm_contact\`, Granola's transcript speaker, Slack messages, etc. **Identity fields (\`email\`, \`full_name\`, \`firstname\`/\`lastname\`, handle, employee_id) are JOIN KEYS — agents navigate from one surface to another by matching them.** If Priya's email is \`priya@northwind.com\` in Attio but \`priya.shah@northwind.com\` in Gmail, the briefing pipeline's CRM→email join silently breaks.

**How to honour identity consistency:**
1. **Extract every named person** from the persona description: proper nouns, named roles ("the AE Sarah", "CFO Mike"), explicit emails (\`raj@northwind.com\`).
2. **Decide canonical (\`full_name\`, \`email\`) ONCE per person** at the start of generation. Persist this decision across every adapter's archetype.
3. **When persona pins an email**, use it verbatim everywhere that person appears.
4. **When persona names a person but does NOT pin an email**, derive a canonical email and reuse it across all surfaces. Email format MUST match the convention used for any OTHER person in the same domain (if persona writes \`raj@northwind.com\`, use \`priya@northwind.com\` — NOT \`priya.shah@northwind.com\`). Default to bare-localpart \`firstname@domain\` when no other person at the same domain appears.
5. **Same person → identical strings everywhere.** \`record_person.primary_email\` in Attio = \`crm_contact.email\` in HubSpot = \`message_email.from_email\` (when sender is Priya) in Gmail = \`speaker.email\` in Granola transcript. Byte-for-byte equal.
6. **Full names match too.** \`record_person.full_name = "Priya Shah"\` everywhere — never \`P. Shah\` here, \`Priya S.\` there.
7. **NEVER let the LLM "improve" the format per resource.** Corporate-style \`firstname.lastname@\` looks plausible in Gmail but breaks the join if other surfaces use bare-localpart. Pick one form and stick.

**Example — encoding "Priya Shah, VP Engineering at Northwind. Sarah is the AE":**
The persona pins \`raj@northwind.com\` and \`aisha@northwind.com\` for trial users. Priya's email is unpinned but lives in the same domain → canonical = \`priya@northwind.com\` (matches the bare-localpart convention). Sarah's domain is Cumulus (the AE side) → \`sarah@cumulus.io\`.

\`\`\`json
{
  "attio": {
    "record_person": {
      "count": 5,
      "archetypes": [
        { "label": "priya", "weight": 0.25, "fields": { "full_name": "Priya Shah", "primary_email": "priya@northwind.com" } },
        { "label": "raj",   "weight": 0.20, "fields": { "full_name": "Raj Patel",  "primary_email": "raj@northwind.com" } }
      ]
    }
  },
  "hubspot": {
    "crm_contact": {
      "count": 5,
      "archetypes": [
        { "label": "priya", "weight": 0.25, "fields": { "firstname": "Priya", "lastname": "Shah", "email": "priya@northwind.com" } }
      ]
    }
  },
  "gmail": {
    "message_email": {
      "count": 47,
      "archetypes": [
        { "label": "soc2-from-sarah", "weight": 0.5, "fields": { "from_name": "Sarah Chen", "from_email": "sarah@cumulus.io", "to_email": "priya@northwind.com" } },
        { "label": "soc2-from-priya", "weight": 0.5, "fields": { "from_name": "Priya Shah", "from_email": "priya@northwind.com", "to_email": "sarah@cumulus.io" } }
      ]
    }
  }
}
\`\`\`
\`priya@northwind.com\` appears identically in Attio's \`primary_email\`, HubSpot's \`email\`, and Gmail's \`from_email\`/\`to_email\`. The briefing skill's "find Priya in CRM, then look up her Gmail thread" join works because the joiner column matches across surfaces.

**CRITICAL:** Cross-platform identity divergence is silent. Tests pass, individual responses look right, then agents fail because they can't navigate between surfaces. Pin the canonical (\`name\`, \`email\`) per person ONCE, before generating any adapter, and reuse those strings byte-for-byte.`;


// ---------------------------------------------------------------------------
// User prompt construction
// ---------------------------------------------------------------------------

/**
 * Build the system + user prompts for blueprint generation.
 */
export function buildPrompt(options: BuildPromptOptions): PromptPair {
  const { schema, persona, domain, apis, promptContexts, currentDate, volume, personaIndex, totalPersonas, apiPlatformNames, schemaMapping, resourceSpecs, tableClassifications } = options;

  const today = currentDate ?? new Date().toISOString().split('T')[0];
  const startDate = volume ? computeStartDate(today, volume) : undefined;
  const hasTables = schema.tables.length > 0;
  const hasApis = apis && Object.keys(apis).length > 0;
  const schemaDump = hasTables ? formatSchema(schema) : '';
  const requiredSummary = hasTables ? formatRequiredColumns(schema) : '';
  const apiSection = hasApis ? formatApis(apis!, promptContexts) : '';

  // When there's no DB schema but APIs are configured, tell the LLM to
  // ONLY generate API data — no entities, entityArchetypes, or patterns.
  const apiOnlyMode = !hasTables && hasApis;

  // Platform hint for Phase 1 of batched generation: tell the LLM which
  // platforms exist so it generates correct billing_platform / external_id
  // values in DB entities — without triggering full API data generation.
  const platformHint = !hasApis && apiPlatformNames && apiPlatformNames.length > 0
    ? formatPlatformHint(apiPlatformNames, personaIndex, promptContexts)
    : '';

  const identityContract = formatIdentityContract(
    collectIdentityContract({ schemaMapping, personaIndex, promptContexts, resourceSpecs }),
    'phase1',
  );

  const classificationBlock = hasTables
    ? formatTableClassification(schema, tableClassifications)
    : '';

  const dateRange = startDate
    ? `⚠ DATE RANGE: ${startDate} → ${today}. ALL generated dates MUST fall within this range. No exceptions.`
    : `⚠ Current date: ${today}. ALL generated dates must be relative to this date.`;

  const user = [
    `Domain: ${domain}`,
    '',
    `Persona: "${persona.name}"`,
    persona.description,
    '',
    dateRange,
    '',
    ...(personaIndex !== undefined
      ? [
          `⚠ Persona index: ${personaIndex} (of ${totalPersonas ?? '?'} total)`,
          `ALL string IDs MUST use this format: "cus_p${personaIndex}_001", "sub_p${personaIndex}_001", "inv_p${personaIndex}_001", "py_p${personaIndex}_001", etc.`,
          `Example: stripe_customer_id="cus_p${personaIndex}_001", stripe_subscription_id="sub_p${personaIndex}_001"`,
          '',
        ]
      : []),
    ...(hasTables
      ? ['--- DATABASE SCHEMA ---', schemaDump, '--- END SCHEMA ---', '']
      : []),
    ...(requiredSummary ? [requiredSummary, ''] : []),
    ...(classificationBlock ? [classificationBlock, ''] : []),
    ...(apiSection ? [apiSection, ''] : []),
    ...(platformHint ? [platformHint, ''] : []),
    ...(identityContract ? [identityContract, ''] : []),
    ...(apiOnlyMode
      ? [
          '⚠ API-ONLY MODE: There is NO database schema. Do NOT generate `entities`, `entityArchetypes`, or `patterns`. ' +
            'Only generate `apiEntities` and `apiEntityArchetypes`. Leave `entities` as an empty object `{}` and `patterns` as an empty array `[]`.',
          '',
        ]
      : []),
    'Generate a complete blueprint for this persona.  Follow the system instructions exactly.',
  ].join('\n');

  return { system: SYSTEM_PROMPT, user };
}



// ---------------------------------------------------------------------------
// Schema formatter  (human-readable dump for the LLM context window)
// ---------------------------------------------------------------------------

/**
 * Build a prominent reminder listing every REQUIRED column per table.
 * This makes it impossible for the LLM to miss them.
 */
/**
 * Render the TABLE CLASSIFICATION block. Splits every DB table into two
 * groups:
 *
 *   - MIRROR TARGETS: rows are derived from API entities by the mirror flow.
 *     Phase 1 MUST NOT emit archetypes for rows that have an API
 *     counterpart — only for rows the persona declares as having no API
 *     source (free-tier users, orphans, internal-only segments).
 *
 *   - DB-ONLY: no API source. Phase 1 generates every row.
 *
 * Without this block, the LLM treats every table the same and emits a full
 * set of archetypes for bridge tables — then the mirror flow runs and
 * creates a parallel set of rows from the API entities, doubling the row
 * count.
 */
function formatTableClassification(
  schema: SchemaModel,
  classifications: TableClassification[] | undefined,
): string {
  if (!classifications || classifications.length === 0) return '';

  const classByTable = new Map<string, TableClassification>();
  for (const c of classifications) classByTable.set(c.table, c);

  const mirrorTargets: string[] = [];
  const dbOnly: string[] = [];

  for (const table of schema.tables) {
    const c = classByTable.get(table.name);
    const role = c?.role ?? 'internal-only';
    if (role === 'external-mirrored' && c?.sources && c.sources.length > 0) {
      const sources = c.sources
        .map((s) => `${s.adapter}.${s.resource}`)
        .join(', ');
      mirrorTargets.push(`  - ${table.name} (sources: ${sources})`);
    } else {
      dbOnly.push(`  - ${table.name}`);
    }
  }

  if (mirrorTargets.length === 0) return '';

  const lines: string[] = [
    '⚠ TABLE CLASSIFICATION — read this BEFORE emitting any entityArchetypes:',
    '',
    'MIRROR TARGETS (DB rows are derived from API entities by the mirror flow):',
    ...mirrorTargets,
    '',
    'For mirror-target tables, the expander will create ONE DB row per API entity',
    'on each listed source — so do NOT emit archetypes for rows that have an API',
    'counterpart (rows whose billing_platform / external_id / *_customer_id fields',
    'would be non-null). Those rows are created automatically.',
    '',
    'For mirror-target tables, ONLY emit archetypes for rows the persona declares',
    'as having NO API source — e.g. free-tier users, paid-plan orphans whose linkage',
    'fields are NULL, internal-only segments. Such archetypes MUST set every cross-',
    'surface FK field (billing_platform, external_id, stripe_customer_id, etc.) to null',
    'in `fields`.',
    '',
    'On mirror-target tables, every archetype MUST use explicit `count` (never `weight`).',
    'There is no table-level row capacity for `weight` to apportion — the mirror flow',
    'supplies the volume. Read the persona for the exact integer (e.g. "847 free-tier',
    'users" → `count: 847`) and put it directly on the archetype. Archetypes that set',
    '`weight` without `count` on a mirror-target table will be dropped because',
    '`weight × 0-capacity = 0 rows`.',
  ];

  if (dbOnly.length > 0) {
    lines.push(
      '',
      'DB-ONLY (no API source — generate every row yourself):',
      ...dbOnly,
    );
  }

  return lines.join('\n');
}

function formatRequiredColumns(schema: SchemaModel): string {
  const sections: string[] = [];

  for (const table of schema.tables) {
    const required = table.columns.filter(
      (c) => !c.isNullable && !c.hasDefault && !c.isAutoIncrement && !c.isGenerated,
    );
    if (required.length === 0) continue;

    const cols = required.map((c) => `${c.name} (${c.pgType})`).join(', ');
    sections.push(`  ${table.name}: ${cols}`);
  }

  if (sections.length === 0) return '';

  return [
    '⚠ REQUIRED COLUMNS — you MUST provide values for these in every entity seed and pattern field:',
    ...sections,
  ].join('\n');
}

function formatSchema(schema: SchemaModel): string {
  const lines: string[] = [];

  if (schema.enums.length > 0) {
    lines.push('Enums:');
    for (const e of schema.enums) {
      lines.push(`  ${e.name}: ${e.values.join(' | ')}`);
    }
    lines.push('');
  }

  lines.push(`Insertion order: ${schema.insertionOrder.join(' → ')}`);
  lines.push('');

  for (const table of schema.tables) {
    lines.push(formatTable(table));
    lines.push('');
  }

  return lines.join('\n');
}

function formatTable(table: TableInfo): string {
  const lines: string[] = [];
  lines.push(`Table: ${table.name}`);

  if (table.comment) {
    lines.push(`  -- ${table.comment}`);
  }

  lines.push('  Columns:');
  for (const col of table.columns) {
    lines.push(`    ${formatColumn(col)}`);
  }

  if (table.primaryKey.length > 0) {
    lines.push(`  PK: (${table.primaryKey.join(', ')})`);
  }

  if (table.foreignKeys.length > 0) {
    lines.push('  Foreign keys:');
    for (const fk of table.foreignKeys) {
      lines.push(
        `    (${fk.columns.join(', ')}) → ${fk.referencedTable}(${fk.referencedColumns.join(', ')})`,
      );
    }
  }

  if (table.uniqueConstraints.length > 0) {
    lines.push('  Unique:');
    for (const uc of table.uniqueConstraints) {
      lines.push(`    (${uc.join(', ')})`);
    }
  }

  return lines.join('\n');
}

function formatApis(
  apis: Record<string, { adapter?: string; config?: Record<string, unknown> }>,
  promptContexts?: Record<string, PromptContext>,
): string {
  const lines: string[] = ['--- CONFIGURED APIs ---'];

  for (const [name, apiConfig] of Object.entries(apis)) {
    const adapterId = apiConfig.adapter ?? name;
    const ctx = promptContexts?.[adapterId];

    if (ctx) {
      lines.push('');
      lines.push(`--- PLATFORM: ${adapterId} ---`);
      lines.push(`Resources: ${ctx.resources.join(', ')}`);
      lines.push(`Amounts: ${ctx.amountFormat}`);
      if (ctx.relationships.length > 0) {
        lines.push('Relationships:');
        for (const rel of ctx.relationships) {
          lines.push(`  ${rel}`);
        }
      }
      if (Object.keys(ctx.requiredFields).length > 0) {
        lines.push('Required fields:');
        for (const [resource, fields] of Object.entries(ctx.requiredFields)) {
          lines.push(`  ${resource}: ${fields.join(', ')}`);
        }
      }
      if (ctx.notes) {
        lines.push(`Notes: ${ctx.notes}`);
      }
      lines.push(`--- END PLATFORM ---`);
    } else {
      lines.push(`  ${adapterId}`);
    }
  }

  lines.push('');
  lines.push(
    '⚠ MANDATORY: You MUST generate data for EVERY resource listed in each PLATFORM SCHEMA section above. ' +
      'For each platform, generate apiEntityArchetypes for ALL resource types with 10+ expected entities ' +
      '(customers, subscriptions, invoices, transactions, charges, payment_intents, credit_notes, coupons, payment_sources, etc.) ' +
      'and apiEntities for small reference data (<10 items like products, prices, items). ' +
      'Do NOT cherry-pick — cover ALL resources. Empty resource types cause broken API endpoints. ' +
      'Use matching sequence prefixes between DB and API archetypes for cross-platform ID consistency.',
  );
  return lines.join('\n');
}

/**
 * Compute the start date by subtracting the volume string from a given end date.
 * E.g. computeStartDate("2026-03-04", "6 months") → "2025-09-04"
 */
function computeStartDate(endDateStr: string, volume: string): string {
  const match = volume.trim().match(/^(\d+)\s*(day|week|month|year)s?$/i);
  if (!match) return endDateStr;

  const amount = parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();
  const d = new Date(endDateStr + 'T00:00:00Z');

  switch (unit) {
    case 'day':
      d.setUTCDate(d.getUTCDate() - amount);
      break;
    case 'week':
      d.setUTCDate(d.getUTCDate() - amount * 7);
      break;
    case 'month':
      d.setUTCMonth(d.getUTCMonth() - amount);
      break;
    case 'year':
      d.setUTCFullYear(d.getUTCFullYear() - amount);
      break;
  }

  return d.toISOString().split('T')[0]!;
}

/**
 * Generate a platform-awareness hint for Phase 1 (DB-only) generation.
 *
 * Tells the LLM which billing/API platforms exist so it can generate
 * correct `billing_platform` and `external_id` values in DB entities,
 * even though full API entity generation happens later in Phase 2.
 *
 * Prefix derivation order:
 * 1. Adapter's own `promptContext.idPrefix` (if the adapter declares one)
 * 2. Algorithmic derivation from the adapter ID (scales to any number of adapters)
 */
function formatPlatformHint(
  platformNames: string[],
  personaIndex?: number,
  promptContexts?: Record<string, PromptContext>,
): string {
  const pIdx = personaIndex ?? 1;
  const lines: string[] = [
    '--- CONFIGURED API PLATFORMS (cross-surface reference) ---',
    '⚠ The following API platforms are configured and will be generated separately.',
    'Do NOT generate apiEntities or apiEntityArchetypes — only generate DB entities and patterns.',
    'However, you MUST ensure DB entities reference these platforms correctly:',
    '',
    `Platforms: ${platformNames.join(', ')}`,
    '',
    'For DB columns like `billing_platform`, use these exact platform names.',
    'For DB columns like `external_id` or platform-specific ID columns, use the',
    'platform-specific customer ID prefix shown below. These prefixes MUST match',
    'what the API entities will use later for cross-surface consistency:',
    '',
  ];

  for (const name of platformNames) {
    const prefix = derivePlatformCustomerPrefix(name, pIdx, promptContexts);
    lines.push(`  ${name}: customer prefix "${prefix}" (e.g. "${prefix}001")`);
  }

  lines.push('');
  lines.push(
    'Distribute customers across platforms as described in the persona. ' +
    'Each customer\'s external_id must use the prefix for their billing_platform.',
  );
  lines.push('--- END PLATFORMS ---');
  return lines.join('\n');
}

/**
 * Derive a deterministic customer ID prefix for any platform.
 *
 * Priority:
 * 1. Adapter-declared `promptContext.idPrefix` (e.g. "cus_" for Stripe)
 * 2. Algorithmic: abbreviate the adapter ID to 2-4 chars + `_cus_p{N}_`
 *
 * This scales to any number of adapters without hardcoding.
 */
function derivePlatformCustomerPrefix(
  adapterId: string,
  personaIndex: number,
  promptContexts?: Record<string, PromptContext>,
): string {
  // 1. Check if the adapter declared its own prefix
  const ctx = promptContexts?.[adapterId];
  if (ctx?.idPrefix) {
    return `${ctx.idPrefix}p${personaIndex}_`;
  }

  // 2. Algorithmic derivation from adapter ID
  const abbr = abbreviateAdapterId(adapterId);
  return `${abbr}_cus_p${personaIndex}_`;
}

/**
 * Produce a short (2-4 char) abbreviation from an adapter ID.
 *
 * Rules:
 * - Single word ≤ 4 chars: use as-is (e.g. "wise" → "wise")
 * - Single word > 4 chars: first 3 chars (e.g. "stripe" → "str", "chargebee" → "chb")
 * - Hyphenated: first char of each part (e.g. "checkout-com" → "cko")
 * - Special: skip generic suffixes like "pay" when they'd make the abbr ambiguous
 */
function abbreviateAdapterId(id: string): string {
  const parts = id.split('-');

  if (parts.length === 1) {
    const word = parts[0]!;
    if (word.length <= 4) return word;
    // Take first + middle consonant + last consonant for distinctness
    const consonants = word.replace(/[aeiou]/g, '');
    if (consonants.length >= 3) return consonants.slice(0, 3);
    return word.slice(0, 3);
  }

  // Multi-part: first letter of each, capped at 4 chars
  return parts
    .map((p) => p[0])
    .join('')
    .slice(0, 4);
}

// ---------------------------------------------------------------------------
// Identity contract block (cross-surface ID prefix pinning)
// ---------------------------------------------------------------------------

/**
 * Resolved identity-contract row: a single (DB column ⇄ API id) pin with the
 * exact prefix both sides must use. The output of `collectIdentityContract`
 * is consumed by both prompt rendering (Phase 1 + Phase 2) and the post-hoc
 * validator, so they all see the same set of constraints.
 */
export interface IdentityContractEntry {
  dbTable: string;
  dbColumn: string;
  adapterId: string;
  apiResource: string;
  apiField: string;
  /** Persona-namespaced prefix, e.g. "cus_p1_" */
  prefix: string;
}

/**
 * Resolve `schemaMapping` + per-adapter prefix lookups into the concrete set
 * of cross-surface ID constraints that apply for a given persona/run.
 *
 * Returns an empty array (and *not* an error) when:
 *   - schemaMapping is undefined
 *   - personaIndex is undefined (no namespacing yet → contract underdefined)
 *   - no non-bridge id-mapping entries exist
 *   - no adapter-side prefix can be resolved (caller decides if that's OK)
 */
export function collectIdentityContract(
  options: {
    schemaMapping?: SchemaMapping;
    personaIndex?: number;
    promptContexts?: Record<string, PromptContext>;
    resourceSpecs?: Record<string, AdapterResourceSpecs>;
    /** Restrict to a subset of adapter IDs (e.g. one Phase 2 batch). */
    filterAdapters?: string[];
  },
): IdentityContractEntry[] {
  const { schemaMapping, personaIndex, promptContexts, resourceSpecs, filterAdapters } = options;
  if (!schemaMapping || personaIndex === undefined) return [];

  const out: IdentityContractEntry[] = [];
  for (const e of schemaMapping.mappings) {
    if (e.isBridgeTable) continue;
    if (e.apiField !== 'id') continue;
    if (filterAdapters && !filterAdapters.includes(e.adapterId)) continue;

    const rawPrefix = getResourceIdPrefix(e.adapterId, e.apiResource, promptContexts, resourceSpecs);
    if (!rawPrefix) continue;

    out.push({
      dbTable: e.dbTable,
      dbColumn: e.dbColumn,
      adapterId: e.adapterId,
      apiResource: e.apiResource,
      apiField: e.apiField,
      prefix: getPersonaIdPrefix(rawPrefix, personaIndex),
    });
  }
  return out;
}

/**
 * Render the IDENTITY CONTRACT block — same constraints, two framings.
 *
 *   phase: 'phase1'  →  framed for DB archetype generation (vary[<column>])
 *   phase: 'phase2'  →  framed for API archetype generation (vary.id)
 *
 * Returns an empty string when there are no constraints to render — callers
 * splice that conditionally so the no-cross-surface-FK case is a clean no-op.
 */
export function formatIdentityContract(
  entries: IdentityContractEntry[],
  phase: 'phase1' | 'phase2',
): string {
  if (entries.length === 0) return '';

  if (phase === 'phase1') {
    const lines = [
      '--- IDENTITY CONTRACT (DB side, informational) ---',
      'The following DB columns are cross-surface join keys with the API mock.',
      'The system will pin them to the prefixes below after generation, so you',
      'do not need to set `vary` on these columns yourself. The values are',
      'shown here so any archetype that REFERENCES these IDs by name (in',
      'narrative fields, FKs from related tables, etc.) uses matching strings.',
      '',
    ];
    for (const e of entries) {
      lines.push(
        `  ${e.dbTable}.${e.dbColumn}  →  prefix "${e.prefix}"  ` +
        `(joins ${e.adapterId}.${e.apiResource}.${e.apiField})  ` +
        `e.g. "${e.prefix}001", "${e.prefix}002", …`,
      );
    }
    lines.push('--- END IDENTITY CONTRACT ---');
    return lines.join('\n');
  }

  // phase 2 — API side
  const lines = [
    '--- IDENTITY CONTRACT (API side, informational) ---',
    'The following API resource IDs are cross-surface join keys with DB',
    'columns. The system will pin `vary.id` for these resources after',
    'generation, so you do not need to set it yourself. Use the prefixes',
    'below when referencing these IDs in OTHER fields — e.g. when emitting',
    '`subscription.customer` or `charge.customer`, those reference fields',
    'should use the same prefix so they resolve correctly.',
    '',
  ];
  for (const e of entries) {
    lines.push(
      `  ${e.adapterId}.${e.apiResource}.${e.apiField}  →  prefix "${e.prefix}"  ` +
      `(matches ${e.dbTable}.${e.dbColumn})  ` +
      `e.g. "${e.prefix}001", "${e.prefix}002", …`,
    );
  }
  lines.push('--- END IDENTITY CONTRACT ---');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Schema mapping prompt (DB↔API field correspondence)
// ---------------------------------------------------------------------------

export interface BuildSchemaMappingPromptOptions {
  schema: SchemaModel;
  /** Adapter IDs and their resource lists from promptContexts */
  adapterResources: Record<string, string[]>;
}

/**
 * System prompt for the schema mapping LLM call.
 * Asks the LLM to inspect the DB schema and API resource lists,
 * then produce field-level mappings between DB columns and API fields.
 */
const SCHEMA_MAPPING_SYSTEM_PROMPT = `You are a data architect analysing a database schema and a set of API platform resource types.

Your task is to identify which DB tables and columns correspond to which API platform resources and fields.

## Bridge Tables

A "bridge table" is a DB table that acts as a projection of external API platform data.
Bridge tables typically have columns like:
- \`billing_platform\` or \`provider\` — identifies which API platform the row came from
- \`external_id\` or \`platform_id\` — the ID of the entity on the external platform
- Other columns that mirror fields from the API platform (name, email, status, amount, etc.)

When a DB table is a bridge table, its rows should be **derived from** the API platform data
rather than generated independently. This ensures the DB and API are always consistent.

## Your Task

1. For each DB table, determine if it is a bridge table (has platform identifier + external ID columns)
2. For each bridge table, map its columns to the corresponding API resource fields
3. Identify cross-surface identity columns on non-bridge tables (see below) and map them too
4. Map CROSS-SURFACE BODY FIELDS for every table that links to an API resource (see below)

## Cross-Surface Identity Columns

A "cross-surface identity column" is a string column on a non-bridge DB table whose
NAME suggests it stores an external API platform's ID (a known platform prefix
combined with a resource hint, usually ending in \`_id\`). Examples:

- customers.stripe_customer_id     →  stripe.customer.id
- orders.paddle_subscription_id    →  paddle.subscription.id
- accounts.chargebee_id            →  chargebee.customer.id

For every such column you find, you MUST emit a SchemaMappingEntry with
\`isBridgeTable: false\`, mapping the DB column to that API resource's primary
\`id\` field. This entry is what tells the generator that the DB-side values and
the API-side IDs MUST be the same string sequence — without it, the DB and the
mock API will silently produce two universes of IDs that never join.

Apply this even when the DB table itself is internal-only (not a bridge table).

## Cross-Surface Body Fields (CRITICAL)

When a DB table maps to an API resource (via a bridge or a cross-surface identity column),
its other columns often hold the same data as fields on that API resource. The generator
mirrors API entities into DB rows by copying these mapped fields — every column you DON'T
map ends up NULL or randomly filled, even when the API source has the value.

For each table that maps to an API resource, walk its remaining columns and emit a
SchemaMappingEntry for every column that has a clear semantic counterpart on the API
resource. Use your knowledge of the API platform's schema (Stripe, Plaid, Chargebee,
HubSpot, etc.) — these are well-documented public APIs.

Common semantic correspondences:

- payments.failure_reason          →  stripe.charge.failure_code      (or .failure_message)
- payments.amount_cents            →  stripe.charge.amount             (integer minor units)
- payments.status                  →  stripe.charge.status             (succeeded/failed/pending)
- payments.payment_method          →  stripe.charge.payment_method_details.type
- invoices.amount_cents            →  stripe.invoice.amount_due        (or .total)
- invoices.status                  →  stripe.invoice.status
- subscriptions.status             →  stripe.subscription.status
- subscriptions.canceled_at        →  stripe.subscription.canceled_at
- customers.email                  →  stripe.customer.email
- customers.name                   →  stripe.customer.name

The pattern: any column whose name describes business state (status, reason, amount,
method, type, kind, code, message, *_at timestamps) very likely has an API counterpart.
Map it. Adapter-side categorical fields and reason fields are especially important —
without these mappings, "failed payment" rows arrive in the DB with NULL reasons.

\`isBridgeTable: false\` for these entries (the column lives on a non-bridge table that
mirrors an API resource); \`apiField\` is the dotted path's leaf (use the top-level field
when the API stores it nested, e.g. \`failure_code\`, not \`outcome.reason\` — the generator
reads top-level body fields).

## Derivation — when a blind copy is wrong (CRITICAL)

The default mirror behaviour is a blind copy: \`row[dbColumn] = body[apiField]\`. This is
ONLY correct when the source field's value space equals the destination's. When they
differ, you MUST emit a \`derivation\` rule instead, or the DB column ends up filled with
foreign vocabulary the destination's enum constraint doesn't allow.

For each mapping, ask: **do the source values look exactly like the values the
destination column accepts?** If no, use a derivation.

### Three derivation forms

**(1) \`derivation: { kind: 'derive', from, cases, default? }\`** — value transformation.

Use when the destination is an enum and the source is one of:
- A number that bands into categories (Stripe \`subscription.items.data[0].price.unit_amount\`: 2900/7900/49900 → starter/pro/enterprise).
- A vendor-specific string id (RevenueCat \`subscription.product_id\`: "com.foo.starter.monthly" → starter).
- A different enum altogether (some adapters use "Basic"/"Pro"/"Ent" — map them to your enum's case).

\`\`\`jsonc
{ "dbTable": "users", "dbColumn": "plan",
  "adapterId": "stripe", "apiResource": "customer",
  "apiField": "id",   // informational only when derivation is set
  "isBridgeTable": true, "direction": "drift_capable",
  "derivation": {
    "kind": "derive",
    "from": "items.data[0].price.unit_amount",
    "cases": { "2900": "starter", "7900": "pro", "49900": "enterprise" },
    "default": "free"
  }
}
\`\`\`

The \`from\` path is rooted at the API response body for \`apiResource\` (so on a Stripe
\`subscription\` body, \`items.data[0].price.unit_amount\` reaches into the embedded
subscription_item's embedded price). Use array indices in \`[0]\` or bare-digit form.

**Every value in \`cases\` and \`default\` MUST be in the destination column's enum.**
If your case maps "2900" → "premium" but the enum is \`{free, starter, pro, enterprise}\`,
the system rejects the mapping and retries the call.

**(2) \`derivation: { kind: 'constant', value }\`** — flat value.

Use when no API field on this platform's resource encodes the destination column. The
classic case: the persona says "every GoCardless customer is on the starter plan" — the
GoCardless API doesn't have a plan/tier concept at all, so the DB \`plan\` column on
GC-mirrored rows is a persona-level constant.

\`\`\`jsonc
{ "dbTable": "users", "dbColumn": "plan",
  "adapterId": "gocardless", "apiResource": "customer",
  "apiField": "id", "isBridgeTable": true, "direction": "mirror",
  "derivation": { "kind": "constant", "value": "starter" }
}
\`\`\`

**(3) NO \`derivation\` — blind copy.** Use ONLY when the source and destination have the
same value space. Examples:
- \`users.email ← stripe.customer.email\` (both open strings).
- \`payments.status ← stripe.charge.status\` (both an enum, identical values).
- \`users.country ← stripe.customer.address.country\` (both ISO country codes).

### Rule of thumb

If the destination column is an enum, look at its \`enumValues\` and the source field's
likely values. Are they the same set? If not, use \`derivation: derive\` with explicit
cases. NEVER copy a source whose values can't appear in the destination enum.

The previous behaviour — emitting a blind copy with \`apiField: "collection_mode"\` for a
\`plan\` column that is \`enum {free, starter, pro, enterprise}\` — is wrong. The mirror
will write "automatic" / "manual" into a column that doesn't accept those values, and the
seeded data will be silently broken. Always check value-space equality before defaulting
to copy.

## Direction — mirror vs drift_capable (CRITICAL)

Every mapping entry MUST set \`direction\` to either \`"mirror"\` or \`"drift_capable"\`.

This flag tells the row reconciler whether the DB and API are *allowed* to hold
different values on the same logical row (anchor-paired rows). It has nothing to
do with normal mirror-flow derivation — it only governs whether the anchor-pair
reconciler enforces equality on this specific column.

**Getting this wrong corrupts the test data.** Marking a true drift field as
\`mirror\` erases the persona-narrated divergence (e.g. "DB shows active, Stripe
shows canceled" becomes "both show active" — the entire test scenario
disappears). Marking a true mirror field as \`drift_capable\` leaves DB and API
holding different amounts/customers on a logically-paired row — an agent
reading either side sees inconsistent data with no narrative reason for it.

### ALWAYS \`drift_capable\` — no exceptions

These column-name patterns are drift signals by definition. They name the
state of a row at a moment in time, and the whole point of having both a DB
and an external API is that those two views of "current state" can disagree.
**You MUST mark these \`drift_capable\` regardless of any other consideration:**

- \`status\`, \`state\`, \`phase\`, \`stage\`, \`lifecycle\` (and any column whose
  name ends in any of these — \`payment_status\`, \`subscription_state\`, etc.).
  This includes every status mapping across every resource: subscription
  status, invoice status, charge status, customer status, dispute status.
- \`canceled_at\`, \`cancelled_at\`, \`cancellation_reason\`, \`cancellation_details\`
  — cancellation is the most common drift event in billing data.
- \`current_period_start\`, \`current_period_end\`, \`trial_start\`, \`trial_end\`,
  \`period_start\`, \`period_end\` — period rollovers happen at different
  cadences on the two surfaces.
- \`updated_at\`, \`synced_at\`, \`last_sync\`, \`refreshed_at\` — these literally
  describe per-surface bookkeeping; they can't agree by definition.
- \`paused_at\`, \`resumed_at\`, \`pending_update\`, \`pending_*\` — state-transition
  metadata that the DB lags the external system on.

If a column name matches any of these patterns, \`direction\` is
\`drift_capable\`. Do not rationalize it as mirror. Do not write "when synced
correctly these would agree" — they won't, that's the entire reason a
revenue-recovery / reconciliation agent exists.

### ALWAYS \`mirror\` — these are facts, not state

These describe immutable facts about the same logical entity. The DB and API
agree on them by definition, because they're the same fact recorded twice:

- All \`id\` mappings (cross-surface IDs always match — that's their entire
  purpose). \`apiField === "id"\` → always \`mirror\`.
- Amounts, totals, balances, fees: \`amount\`, \`amount_due\`, \`amount_paid\`,
  \`amount_refunded\`, \`amount_captured\`, \`unit_amount\`, \`total\`, \`subtotal\`,
  \`balance\`, \`mrr_cents\`, \`price\`, \`fee\`, \`tax\`.
- Currencies: \`currency\`, \`currency_code\`.
- FK references to shared entities: \`customer\`, \`customer_id\`,
  \`subscription\`, \`subscription_id\`, \`invoice\`, \`invoice_id\`,
  \`payment_intent\`, \`charge\`, etc.
- Created timestamps (immutable per-event): \`created\`, \`created_at\`. (Note:
  \`updated_at\` is the OPPOSITE — that's drift_capable.)
- Failure reasons on failed charges: \`failure_reason\`, \`failure_code\`,
  \`failure_message\`, \`decline_code\`. (These describe a past event.)
- Identity attributes the same entity carries on both sides: \`name\`,
  \`email\`, \`phone\`, \`description\`, \`metadata\`.
- Payment instrument facts: \`payment_method\` (the type used), \`brand\`,
  \`last4\`, \`exp_month\`, \`exp_year\`.

### Decision procedure when the column doesn't match either list

1. Does the column name describe a *moment-in-time state* the system is in
   right now (status, phase, period bounds, sync metadata)? → \`drift_capable\`.
2. Does the column name describe a *historical fact* about a past event
   (amount charged, when it was created, why it failed)? → \`mirror\`.
3. Does the column name describe an *identity attribute* (name, email,
   customer reference)? → \`mirror\`.
4. Genuinely ambiguous? → \`mirror\`, but this should be rare. The two lists
   above cover ~all of billing/CRM/messaging schemas.

The flag is required on EVERY entry, including id mappings (always
\`"mirror"\` for those — cross-surface IDs must match by definition).

## Rules

- Only map columns that have a clear semantic correspondence — do NOT guess
- A single DB table may map to multiple API resources (e.g. a payments table may correspond to both charges and payment_intents)
- Multiple DB columns may map to the same API resource (e.g. name, email, status all map to customers)
- If a DB column name contains a platform prefix (e.g. \`stripe_customer_id\`), map it to that specific platform
- **CRITICAL: Emit one mapping entry PER adapter PER column. NEVER use wildcards like "all" or "any".**
  Different platforms use different resource names for the same concept (e.g. Stripe uses "charges" while PayPal uses "payments").
  You MUST emit a separate mapping for each platform with its correct resource name.
- **CRITICAL: Every entry MUST include \`direction\` (\`"mirror"\` or \`"drift_capable"\`).** See the direction section above.
- Output ONLY valid JSON matching the provided schema. No markdown, no commentary.`;

/**
 * Build the prompt for schema mapping — a lightweight LLM call that maps
 * DB columns to API resource fields before generation begins.
 */
export function buildSchemaMappingPrompt(
  options: BuildSchemaMappingPromptOptions,
): PromptPair {
  const { schema, adapterResources } = options;

  const lines: string[] = [
    '--- DATABASE SCHEMA ---',
    '',
  ];

  for (const table of schema.tables) {
    lines.push(`Table: ${table.name}`);
    lines.push(`  Columns: ${table.columns.map(c => `${c.name} (${c.pgType}${c.isNullable ? '' : ' NOT NULL'})`).join(', ')}`);
    if (table.foreignKeys.length > 0) {
      lines.push(`  FKs: ${table.foreignKeys.map(fk => `${fk.columns.join(',')} → ${fk.referencedTable}(${fk.referencedColumns.join(',')})`).join('; ')}`);
    }
    lines.push('');
  }

  lines.push('--- API PLATFORMS ---');
  lines.push('');
  for (const [adapterId, resources] of Object.entries(adapterResources)) {
    lines.push(`Platform: ${adapterId}`);
    lines.push(`  Resources: ${resources.join(', ')}`);
    lines.push('');
  }

  lines.push('Analyse the DB schema and API platforms above.');
  lines.push('Identify bridge tables and cross-surface identity columns, AND emit body-field');
  lines.push('mappings for every DB column on a mirrored table that has a semantic counterpart');
  lines.push('on its linked API resource (status, amount, failure_reason→failure_code, method, etc).');
  lines.push('Without body-field mappings, mirrored rows arrive in the DB with NULL/random data.');

  return { system: SCHEMA_MAPPING_SYSTEM_PROMPT, user: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// Distribution prompt (ResourceSpec-based, PR3)
// ---------------------------------------------------------------------------

export interface BuildDistributionPromptOptions {
  persona: { name: string; description: string };
  domain: string;
  /** Adapter-level resource specs */
  resourceSpecs: Record<string, AdapterResourceSpecs>;
  /** Current date (ISO string) */
  currentDate?: string;
  /** Volume string from config */
  volume?: string;
  /** 1-based persona index */
  personaIndex?: number;
  totalPersonas?: number;
  /**
   * Identity entity count constraints from Phase 1 DB archetypes.
   * Maps resource type → exact count for identity resources to ensure
   * DB↔API coordination. Counts apply to non-apiOnly archetypes only;
   * apiOnly archetypes are additive on top.
   */
  identityEntityCounts?: Record<string, number>;
  /**
   * LLM-derived DB↔API field correspondence. When provided, drives the
   * IDENTITY CONTRACT block on the API side, pinning archetype id prefixes
   * to the same string the DB side already uses.
   */
  schemaMapping?: SchemaMapping;
  /**
   * Per-adapter prompt context (idPrefix lookups) for the identity contract.
   */
  promptContexts?: Record<string, PromptContext>;
  /**
   * Anchors declared in Phase 1's `data.anchors`. The Phase 2 prompt lectures
   * the LLM at length about binding anchors — this field gives it the actual
   * list of ids to bind. Without it, the lecture has no referent and the LLM
   * silently omits bindings (and validation aborts the run).
   */
  anchors?: import('../types/blueprint.js').Anchor[];
  /**
   * Persona-pinned requirements scoped to this prompt's (adapter, resource).
   * Pre-extracted prose injected verbatim as a "PERSONA-PINNED REQUIREMENTS"
   * block at the end of the user prompt. Surfaces the persona's exact
   * numeric/date pins so the distribution LLM does not need to find them
   * embedded in the persona description.
   */
  personaConstraintsBlock?: string;
}

const DISTRIBUTION_SYSTEM_PROMPT = `You are a synthetic data architect. Your ONLY task is to decide the distribution of API entity data for a given persona.

You will be given a set of API platform resource specifications. For each resource type, decide:
1. **count** — how many entities of this type to generate (use the volume hint and persona context)
2. **archetypes** — 2-8 representative sub-groups with labels, weights, and field overrides
3. **facts** — testable facts about the distribution choices (anomalies, overdue items, risk signals)

## Output format
Return a JSON object with:
- "resources": array of { "resource": "<type>", "distribution": { count, archetypes } }
- "facts": optional array of testable facts about the generated data

Each archetype has:
- "label": human-readable name
- "weight": fraction 0-1 (matched-archetype weights sum to ~1.0; apiOnly weights are additive)
- "fieldOverrides": array of { "field", "value" } pairs for CONSTANT values (value is always a string)
- "vary": optional array of { "field", "type", ... } for fields where you want a SPECIFIC variation strategy
- "apiOnly": optional boolean. Set true when entities have NO database counterpart (see API-ONLY ARCHETYPES section below).
- "count": optional integer. Only meaningful when apiOnly:true — explicit additive count for this orphan archetype.

## When to use vary
Most fields are auto-varied by the assembler from the spec (IDs, timestamps, emails, names, etc.).
Use "vary" ONLY when you have a specific opinion the assembler cannot infer:
- Amount ranges: { "field": "amount", "type": "range", "min": 500, "max": 2000 }
- Specific pick values: { "field": "currency", "type": "pick", "values": ["usd", "eur"] }
- Derived templates: { "field": "description", "type": "derived", "template": "Invoice for {{name}}" }
Do NOT include vary for: IDs (assembler handles prefixes), timestamps, emails, names, phones.

## CRITICAL — PINNED VALUES MUST LIVE IN fieldOverrides, NEVER IN vary
When the persona states an EXACT numeric value (a sum, total, amount, threshold) or an EXACT date for a specific row or set of rows, that value MUST appear as a literal in \`fieldOverrides\`. Using \`vary.range\` or \`vary.timestamp\` on a field with a pinned value is wrong — \`vary.range\` rolls a RANDOM number from the range and rarely lands on the pinned value.

This is the single biggest cause of "the count is right but the totals are wrong" persona failures. The expander faithfully renders what you emit. If you give it a range it rolls random numbers; if you give it a literal it uses the literal.

**DON'T (broken — produces random £1 to £999):**
\`\`\`json
{ "label": "overdue-invoice-4800", "count": 1,
  "fieldOverrides": [{"field": "status", "value": "payment_due"}],
  "vary": [{"field": "total", "type": "range", "min": 100, "max": 99999}] }
\`\`\`

**DO (pinned — produces exactly £4,800 in pence):**
\`\`\`json
{ "label": "overdue-invoice-4800", "count": 1,
  "fieldOverrides": [
    {"field": "status", "value": "payment_due"},
    {"field": "total", "value": "480000"},
    {"field": "date", "value": "2026-04-11T00:00:00Z"},
    {"field": "due_date", "value": "2026-04-25T00:00:00Z"}
  ] }
\`\`\`

Apply this rule to:
- Amount fields when persona names an exact amount: \`total\`, \`amount\`, \`amount_due\`, \`subtotal\`, \`unit_amount\`, \`unit_price.amount\`, \`mrr_cents\`, \`balance\`.
- Date fields when persona names an exact date: \`date\`, \`due_date\`, \`charge_date\`, \`created\`, \`canceled_at\`, \`occurred_at\`, \`last_login_at\`.
- Sum-constrained groups: when N rows must collectively sum to S, either set every row's amount to S/N as a literal, OR distribute the rows across N archetypes each with its own pinned amount. NEVER use a single \`vary.range\` and hope.

When the persona names a value in £/$/€ + decimal, convert to integer minor units (pence/cents) BEFORE writing the literal. £4,800 → 480000. $79.00 → 7900.

If \`fieldOverrides\` value must be a string per the schema, write the integer as a string ("480000") — the validator coerces numeric strings to numbers downstream.

## CRITICAL — FACT-DRIVEN DISTRIBUTIONS
The persona description contains specific numeric claims (counts, totals, percentages, amounts).
These are HARD CONSTRAINTS — your archetype distributions MUST produce those exact numbers.
- "3 overdue invoices totalling £12,400" → create an archetype with weight producing exactly 3 entities, status "payment_due"/"overdue", amounts summing to the total
- "8% churn rate" → canceled archetype weight = 0.08
- Do NOT generate random distributions and hope they match. Encode every persona claim directly into archetype weights, counts, and field values.
- Do NOT include a "facts" array — facts are generated automatically after expansion from actual data.

## CRITICAL — DATE-DRIVEN DISTRIBUTIONS
The persona description ALSO contains specific date references for events ("on Apr 22 the SOC 2 package arrived", "demo call last week", "after the kickoff on March 6"). These are HARD CONSTRAINTS for any timestamp field on entities created by the expander.
- Parse every explicit date, relative date ("last week" = today − 7d, "two weeks ago" = today − 14d, "yesterday" = today − 1d), and event anchor in the persona description.
- For each anchored event, create a dedicated archetype with a tight timestamp window (e.g. \`vary\` field \`{ type: 'range', min: <anchor 00:00 UTC unix>, max: <anchor + 24h unix> }\`) — NOT a generic random timestamp.
- A "47-message thread on Apr 22" should produce 47 timestamps clustered within ~1 day of Apr 22, not scattered across the full date range.
- Every entity in a cluster must get a DISTINCT timestamp; the \`range\` vary type guarantees this.
- Mid-range "safe" dates are wrong if the narrative anchors elsewhere — the data must match the persona's stated timeline.

## CRITICAL — NARRATIVE-NAMED-ENTITY DISTRIBUTIONS
The persona description ALSO names specific entities — channels (\`#deals\`), thread topics ("the SOC 2 review thread", "intro outreach"), records ("Northwind deal", "Priya Shah"), kebab-case ids, quoted titles. These are HARD CONSTRAINTS for fields like \`name\`, \`title\`, \`subject\`, \`thread_subject\`, \`channel_name\`, \`label\`, \`dealname\`.
- Extract every named entity from the persona and pin it as an archetype field value, EXACT case and spelling preserved (strip only \`#\` / \`@\` routing punctuation).
- Create ONE dedicated archetype per named instance — three named threads → three archetypes weighted by message count, NOT one archetype with one generic subject.
- Distinct narrative threads MUST get distinct field values. Marshallers group entities by these strings; identical strings cause unwanted merges (e.g. all 47 emails collapsing into one Gmail thread, two channels merging into one).
- Cross-resource label fields are non-negotiable. When persona names a channel \`deals\`, BOTH \`channel.name = "deals"\` AND \`message.channel_name = "deals"\` must match exactly. The marshaller resolves cross-refs by exact label match.
- NEVER substitute a generic placeholder ("Conversation", "general", "sample-channel", a corporate name when persona said \`deals\`) when the persona has named the entity.

## CRITICAL — API-ONLY ARCHETYPES (cross-platform asymmetry)
The persona may explicitly declare entities that exist on the API side WITHOUT a database counterpart. Common phrasings: "3 deliberate Stripe-only orphans from a botched import", "5 abandoned Plaid items linked to closed bank accounts", "2 webhook subscriptions that never made it into the audit log". These are HARD CONSTRAINTS — without them, the data is symmetric and the asymmetry-detection scenarios cannot be tested.
- Create a DEDICATED archetype with \`apiOnly: true\` for each declared asymmetric group. Set \`count\` to the explicit number from the persona ("3 orphans" → \`count: 3\`).
- apiOnly archetypes are ADDITIVE on top of the matched count. Their weight does NOT count toward the ~1.0 sum of matched archetypes. Example: matched archetypes summing to weight 1.0 with \`distribution.count: 100\`, plus an \`apiOnly: true\` archetype with \`count: 3\` → 103 total entities, 3 with no DB counterpart.
- Use apiOnly ONLY when the persona explicitly declares such asymmetry. NEVER use it speculatively, as a "small percentage of weird data," or to express anomalies that are actually matched (a customer in past_due is matched, not apiOnly).
- The system enforces a soft cap: apiOnly entities should not exceed ~30% of matched entities. If the persona claims more than that, lower the count and surface the inconsistency.

## CRITICAL — PERSONA-LEVEL FIELD CONSTRAINTS
The persona may declare GLOBAL invariants over a field — claims that apply to EVERY entity, not just one archetype. Examples: "All payments are denominated in USD", "Every customer is in the EU region", "All invoices use 30-day terms". These are HARD CONSTRAINTS — encode them on EVERY archetype, not just the dominant one.
- For a single-value invariant ("all USD"), set the field on \`fieldOverrides\` for EVERY archetype: \`{ "field": "currency", "value": "usd" }\`. The assembler-derived default for currency_code is \`pick from [usd, eur, gbp]\` and will produce mixed currencies if you skip this.
- Alternatively, use a single-value \`vary\` to make the constraint loud: \`{ "field": "currency", "type": "pick", "values": ["usd"] }\`.
- NEVER assume the assembler-derived default will respect the persona's invariant. The assembler doesn't read the persona — only you do.
- This rule applies to: currency, region, country, locale, timezone, status (when persona pins one), and any other categorical field with a global persona-level constraint.

## CRITICAL — CROSS-COLUMN CORRELATION
When the persona names a count of entities sharing MULTIPLE correlated field values ("18 enterprise customers paying $499/mo each", "5 trial users with status=trialing AND mrr=0"), these correlations are HARD CONSTRAINTS — put the correlated fields on ONE archetype, never split across two distributions.
- "18 enterprise customers @ $499/mo" → ONE archetype with \`weight\` chosen so it produces 18 entities, \`fieldOverrides: [{field:"plan", value:"enterprise"}, {field:"mrr_cents", value:"49900"}]\`. NOT one archetype for plan and a separate weight for mrr.
- "3 enterprise customers downgraded to pro at $99/mo" → ONE dedicated archetype with \`fieldOverrides: [{field:"plan", value:"pro"}, {field:"mrr_cents", value:"9900"}]\` and a \`downgrade\` tag — even though plan and mrr are normally derived independently.
- The assembler's auto-variation generates fields independently. If you want plan and mrr to agree, you MUST co-locate them in one archetype. Splitting them across two distributions produces de-correlated rows and silently violates the persona's invariant.

## CRITICAL — LABELS IMPLY FIELD VALUES
An archetype's \`label\` is a human hint, not data. The actual record fields are what end up in the API response and (when mirrored) in the database. If your label encodes a categorical state — \`failed-expired-card\`, \`canceled-by-customer\`, \`paid-late\`, \`fraudulent-dispute\` — you MUST also encode that state in \`fieldOverrides\` on the resource's actual reason/code/status fields. Otherwise the label says one thing and the data says null, and downstream consumers (DB mirrors, agents reading the API) cannot categorize the row.
- \`label: "failed-expired-card"\` on a Stripe charge → \`fieldOverrides\` MUST include \`{field: "status", value: "failed"}\` AND \`{field: "failure_code", value: "expired_card"}\` AND \`{field: "failure_message", value: "Your card has expired."}\`. Leaving \`failure_code\` null is a bug — it drops the very signal the label promised.
- \`label: "canceled-by-customer"\` on a subscription → set \`status\`, \`cancellation_reason\`, \`canceled_at\` (as appropriate for the API).
- \`label: "fraudulent-dispute"\` → set \`status\` AND \`reason: "fraudulent"\`.
- General rule: read your own label. Identify the categorical state it names. Find the field(s) on the API resource that carry that state (use the resource's documented schema — failure_code/failure_message for charges, cancellation_reason for subscriptions, decline_code where applicable, etc.). Set them in \`fieldOverrides\`. Never leave them null when the label asserts a value.
- This rule is the single biggest cause of "the data looks right but the agent can't categorize it" bugs. Labels without matching field values produce silently broken datasets.

## CRITICAL — ANCHOR BINDING IS WHERE PERSONA EVENTS LIVE
The DB blueprint may declare anchors in \`data.anchors\` (named persona events like "Klein's double-charge on 2026-04-29"). Each anchor MUST be bound to at least one archetype on this API side via the archetype's \`anchor\` field — otherwise the persona event produces zero rows on the API and the mirror flow has nothing to propagate to the DB.
- For MIRROR events (DB and API agree, e.g. Klein's two succeeded payment_intents): bind the anchor on the relevant API resource(s) — \`{anchor: "klein_double_charge", count: 2, fieldOverrides: [...], vary: [{field: "id", type: "sequence", prefix: "pi_klein_dup_"}, ...]}\`. The DB blueprint should NOT bind the same anchor on the DB side; mirror flow creates the DB row from your API archetype.
- For DRIFT events (DB and API diverge, e.g. Larkspur's Stripe sub canceled but Postgres still active): the DB side will bind too. On THIS side, hardcode the cross-surface id in \`fieldOverrides\` (e.g. \`{field: "id", value: "sub_lark_drift_001"}\`) so the DB and API rows land on the same id while diverging on status/canceled_at. Do NOT use a sequence for the id on a drift archetype — sequence counters are global and the two surfaces would land on different ids.
- For TIME-WINDOW events ("this week", "yesterday"): bind the anchor on the API archetype with \`vary: [{field: "created", type: "anchor_date", anchor: "<id>", key: "event", format: "epoch_seconds"}]\`. The persona-pinned date propagates to the DB row via mirror.
- Generation fails with a clear error if any anchor is declared but unbound. Read each anchor in \`data.anchors\` and bind it.

## CRITICAL — EXPLICIT COUNTS BEAT WEIGHTS FOR PERSONA-PINNED NUMBERS
When the persona narrates an exact number ("8 failed charges — 4 card_expired, 2 insufficient_funds, 2 lost_card"), use \`count\` on a per-reason archetype. \`count\` emits EXACTLY that many rows and bypasses weight redistribution; \`weight\` only approximates and rounds. The remaining \`distribution.count\` is split across weight-only archetypes.
- \`{ label: "failed-expired-card", count: 4, fieldOverrides: [{field:"status", value:"failed"}, {field:"failure_code", value:"expired_card"}, ...] }\`
- \`{ label: "failed-insufficient-funds", count: 2, ... }\`
- \`{ label: "failed-lost-card", count: 2, ... }\`
- The weight-only succeeded archetypes (no \`count\`, sum to ~1.0) absorb the remaining capacity.
- Do NOT use \`weight: 0\` on plain archetypes hoping it means "explicit count" — that emits zero rows. \`weight: 0\` is only valid alongside \`apiOnly: true\` or an \`anchor\`. For plain "exactly N rows" use just \`count: N\` (omit \`weight\` or set it to 0; either works since count wins).

## Rules
- Matched-archetype weights must sum to ~1.0 per resource type. apiOnly archetypes are additive and do NOT count toward this sum.
- Reference data (volumeHint: "reference") should have low counts (1-10)
- Entity data (volumeHint: "entity") scales with the persona context (20-200)
- ⚠ IMPORTANT: You MUST include ALL listed resource types in your output. Every resource must have count >= 1. Even if the persona is unlikely to have many of a resource type (e.g. disputes, refunds), include at least a small realistic count (1-5). Mock API endpoints need data for all resource types to be useful.
- Field overrides set CONSTANT values that define the archetype (e.g. status, plan, currency)
- Output ONLY valid JSON matching the provided schema. No markdown, no commentary.`;

/**
 * Build the prompt for distribution generation — a focused LLM call that
 * produces only counts, archetypes, and weights for each API resource.
 *
 * The structural details (field specs, variation types, ID prefixes) are
 * ALL provided by ResourceSpec — the LLM only decides distribution.
 */
export function buildDistributionPrompt(
  options: BuildDistributionPromptOptions,
): PromptPair {
  const {
    persona,
    domain,
    resourceSpecs,
    currentDate,
    volume,
    personaIndex,
    totalPersonas,
    identityEntityCounts,
    schemaMapping,
    promptContexts,
    anchors,
  } = options;

  const today = currentDate ?? new Date().toISOString().split('T')[0];
  const startDate = volume ? computeStartDate(today, volume) : undefined;

  const adapterKeys = Object.keys(resourceSpecs);
  const identityContract = formatIdentityContract(
    collectIdentityContract({
      schemaMapping,
      personaIndex,
      promptContexts,
      resourceSpecs,
      filterAdapters: adapterKeys,
    }),
    'phase2',
  );

  const lines: string[] = [
    `Domain: ${domain}`,
    '',
    `Persona: "${persona.name}"`,
    persona.description,
    '',
  ];

  if (startDate) {
    lines.push(`Date range: ${startDate} → ${today}`);
  }

  if (personaIndex !== undefined) {
    lines.push(`Persona index: ${personaIndex} (of ${totalPersonas ?? '?'} total)`);
  }

  if (identityContract) {
    lines.push('', identityContract);
  }

  // Include identity entity count constraints if provided.
  // These are *matched* counts only — apiOnly archetypes (e.g. orphans the
  // persona declares as API-only) add to this total and are not coordinated
  // with the DB.
  if (identityEntityCounts && Object.keys(identityEntityCounts).length > 0) {
    lines.push('');
    lines.push('--- IDENTITY ENTITY COUNT CONSTRAINTS (from DB coordination) ---');
    lines.push('⚠ MANDATORY: The following counts are the MATCHED entity counts —');
    lines.push('every matched-archetype entity must have a corresponding row in the database.');
    lines.push('Use these EXACT counts as the sum of weights for archetypes WITHOUT apiOnly:true:');
    lines.push('');
    for (const [resource, count] of Object.entries(identityEntityCounts)) {
      lines.push(`  ${resource}: exactly ${count} matched entities`);
    }
    lines.push('');
    lines.push('apiOnly:true archetypes carry their own additive count (you choose, persona-driven).');
    lines.push('Example: matched=100 + an "orphan" apiOnly archetype with count:3 → 103 total entities,');
    lines.push('         3 of which have no DB counterpart and represent a deliberate asymmetry.');
    lines.push('Other non-identity resources can have any appropriate count.');
    lines.push('--- END CONSTRAINTS ---');
  }

  if (anchors && anchors.length > 0) {
    lines.push('');
    lines.push('--- DECLARED ANCHORS YOU MUST BIND ---');
    lines.push('⚠ MANDATORY: every anchor below was declared by Phase 1 and MUST be bound by at');
    lines.push('least one archetype in YOUR output (on one of the resources for this adapter).');
    lines.push('An unbound anchor is a persona event with zero rows — generation aborts.');
    lines.push('Bind by setting `anchor: "<id>"` on the archetype (with `count` for row count and');
    lines.push('`weight: 0`). Use `vary` rules with `type: "anchor_date"` to pull the event date.');
    lines.push('Bind ONLY the anchors whose persona event lives on a resource THIS adapter owns;');
    lines.push('leave the rest for other adapters\' Phase 2 calls. Read the persona description');
    lines.push('to match each anchor id to the correct resource on the correct adapter.');
    lines.push('');
    for (const a of anchors) {
      const dateParts = Object.entries(a.dates ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      const customerPart = a.customer?.match ? `, customer=${a.customer.match}` : '';
      lines.push(`  - id="${a.id}" (${dateParts}${customerPart})`);
    }
    lines.push('--- END ANCHORS ---');
  }

  lines.push('', '--- API PLATFORM RESOURCES ---', '');

  for (const [adapterId, specs] of Object.entries(resourceSpecs)) {
    lines.push(`Platform: ${adapterId}`);
    lines.push(`  Timestamp format: ${specs.platform.timestampFormat}`);
    lines.push(`  Amount format: ${specs.platform.amountFormat}`);
    lines.push('');

    for (const [resourceType, spec] of Object.entries(specs.resources)) {
      lines.push(`  Resource: ${resourceType} (${spec.volumeHint})`);

      const requiredFields = Object.entries(spec.fields)
        .filter(([, f]) => f.required && !f.auto)
        .map(([name, f]) => {
          const details: string[] = [f.type];
          if (f.enum) details.push(`enum[${f.enum.join('|')}]`);
          if (f.ref) details.push(`→ ${f.ref}`);
          if (f.isAmount) details.push('amount');
          if (f.idPrefix) details.push(`prefix:${f.idPrefix}`);
          return `${name}(${details.join(', ')})`;
        });

      lines.push(`    Required fields: ${requiredFields.join(', ')}`);

      if (spec.refs && spec.refs.length > 0) {
        lines.push(`    References: ${spec.refs.join(', ')}`);
      }

      lines.push('');
    }
  }

  lines.push('Return { "resources": [...], "facts": [...] }');
  lines.push('Each resource entry: { "resource": "<type>", "distribution": { "count": N (matched count), "archetypes": [...] } }');
  lines.push('Each archetype: { "label": "...", "weight": 0.N, "fieldOverrides": [...], "vary": [...], "apiOnly"?: bool, "count"?: int }');
  lines.push('fieldOverrides: [{ "field": "status", "value": "active" }] — constant values only, values are always strings.');
  lines.push('vary: [{ "field": "amount", "type": "range", "min": 500, "max": 5000 }] — only when you have a specific opinion the assembler cannot infer.');
  lines.push('apiOnly: true ONLY for archetypes the persona declares as having no DB counterpart (e.g. orphans). Add an explicit "count" alongside.');
  lines.push('facts: [{ "id": "fact_001", "type": "overdue", "platform": "<adapter>", "severity": "warn", "detail": "..." }] — testable assertions about the data.');

  // Persona-pinned requirements appended LAST so they dominate the user's
  // mental model. The block is pre-extracted prose; the LLM should treat
  // every requirement as a hard constraint on the archetypes it emits.
  if (options.personaConstraintsBlock && options.personaConstraintsBlock.trim().length > 0) {
    lines.push('', options.personaConstraintsBlock);
  }

  return { system: DISTRIBUTION_SYSTEM_PROMPT, user: lines.join('\n') };
}

function formatColumn(col: ColumnInfo): string {
  const parts: string[] = [col.name];
  parts.push(col.pgType);

  if (col.isAutoIncrement) parts.push('AUTO_INCREMENT');
  if (col.isGenerated) parts.push('GENERATED');
  if (!col.isNullable) parts.push('NOT NULL');
  if (col.hasDefault && col.defaultValue !== undefined) {
    parts.push(`DEFAULT ${col.defaultValue}`);
  }
  if (col.maxLength !== undefined) parts.push(`(${col.maxLength})`);
  if (col.enumValues && col.enumValues.length > 0) {
    parts.push(`[${col.enumValues.join(', ')}]`);
  }
  if (col.comment) parts.push(`-- ${col.comment}`);

  // Mark columns that MUST be included in blueprint data
  if (!col.isNullable && !col.hasDefault && !col.isAutoIncrement && !col.isGenerated) {
    parts.push('⚠ REQUIRED');
  }

  // Flag @default(now()) timestamp columns as auto-distributed by the expander.
  // Helps the LLM understand it can leave these unspecified in the common case
  // but should override per archetype to encode persona-pinned dates.
  if (
    col.defaultValue === 'now()' &&
    (col.type === 'timestamp' || col.type === 'timestamptz')
  ) {
    parts.push('⚠ AUTO-DISTRIBUTED across volume range; override only for persona-pinned dates');
  }

  return parts.join(' ');
}
