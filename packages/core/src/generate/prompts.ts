import type { SchemaModel, TableInfo, ColumnInfo, PromptContext, AdapterResourceSpecs } from '../types/index.js';

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
}

/**
 * Summary of Phase 1 generation results, passed to Phase 2 so API archetypes
 * can use matching IDs and reference the DB structure.
 */
export interface Phase1Summary {
  /** DB tables with entity counts and sample ID columns */
  tables: { name: string; rowCount: number; idColumns?: Record<string, string> }[];
  /** Sequence prefixes extracted from Phase 1 archetypes, keyed by "table.column" */
  idPrefixes: Record<string, string>;
  /** Per-platform ID prefixes extracted from DB entities, keyed by platform name */
  platformPrefixes: Record<string, { column: string; prefix: string }[]>;
}

export interface BuildAdapterBatchPromptOptions {
  persona: { name: string; description: string };
  domain: string;
  /** Subset of API adapters to generate data for in this batch */
  apis: Record<string, { adapter?: string; config?: Record<string, unknown> }>;
  /** Platform-specific prompt contexts for this batch's adapters */
  promptContexts?: Record<string, PromptContext>;
  /** Current date (ISO string) */
  currentDate?: string;
  /** Volume string from config (e.g. "6 months") */
  volume?: string;
  /** 1-based index of this persona */
  personaIndex?: number;
  /** Total number of personas being generated */
  totalPersonas?: number;
  /** Summary of Phase 1 DB generation results for cross-surface ID consistency */
  phase1Summary?: Phase1Summary;
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
2. For **small reference/dimension tables** (categories, plans, settings — under ~10 rows), produce static "entity" rows in \`entities\`.
   For **larger entity tables** (customers, employees, accounts — 10+ expected rows), use \`entityArchetypes\` instead. See the ARCHETYPE SYSTEM section below.
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
3. **Use dedicated small archetypes for specific claims.** If the persona says "3 overdue invoices", create a separate archetype with weight that produces exactly 3 entities — do NOT rely on random status distribution from a larger pool.
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
  const { schema, persona, domain, apis, promptContexts, currentDate, volume, personaIndex, totalPersonas, apiPlatformNames } = options;

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
    ...(apiSection ? [apiSection, ''] : []),
    ...(platformHint ? [platformHint, ''] : []),
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
// Batched adapter generation prompt
// ---------------------------------------------------------------------------

/**
 * System prompt for Phase 2 of batched generation.
 *
 * Focused exclusively on API entity data — no persona profile, no database
 * entities, no patterns. The LLM receives a small subset of adapter platform
 * schemas and produces only `apiEntities` + `apiEntityArchetypes`.
 */
const BATCH_SYSTEM_PROMPT = `You are a synthetic data architect generating API entity data for an existing persona.

Generate ONLY apiEntities and apiEntityArchetypes for the specified API platforms.
Do NOT generate persona profiles, database entities, entityArchetypes, or patterns.

##############################################################################
# CRITICAL RULES
##############################################################################

**RULE A — DATE ANCHORING:** ALL dates must fall within the provided date range.

**RULE B — ID NAMESPACING:** ALL string IDs must use the persona index prefix.

**RULE C — REQUIRED FIELDS:** Every field listed under "Required fields" for
each platform resource MUST appear in either \`fields\` (constant) or \`vary\`
(randomized) of every archetype for that resource. Missing fields cause broken
API responses.

**RULE D — AMOUNT FORMATS:** Follow each platform's amount format exactly:
- "integer cents" → use \`range\` with values in cents (e.g. 2999 = $29.99)
- "decimal string" → put decimal strings in \`fields\` (e.g. "29.99")
- "decimal number" → use \`decimal_range\` (e.g. min: 29.00, max: 299.00)
- "object {value, currency}" → put the FULL object in \`fields\`:
  \`"amount": { "value": "29.99", "currency": "EUR" }\`
  Do NOT use \`derived\` templates for object amounts — they become strings.

**RULE E — VARY KEY NAMES:** Keys in \`vary\` must be actual field names from
the resource's required fields list, not values or IDs.

**RULE F — FACT-DRIVEN ARCHETYPES (MANDATORY):**
The persona description contains specific numeric claims (e.g., "3 overdue invoices totalling £12,400"). These are HARD CONSTRAINTS — design archetypes so expansion produces those exact numbers.
- Create dedicated small archetypes for specific claims (e.g., an overdue archetype with weight producing exactly 3 entities)
- For amount totals, set amounts so count × amount = claimed total
- Do NOT rely on random distributions matching the persona — encode claims directly into archetype weights and field values

**RULE G — DATE-DRIVEN ARCHETYPES (MANDATORY):**
The persona description also contains specific date references for events ("on Apr 22 the SOC 2 package arrived", "demo call last week", "after the kickoff on March 6"). These are HARD CONSTRAINTS for any timestamp/date field (\`sent_at\`, \`created_at\`, \`closed_at\`, \`paid_at\`, etc.).
- Parse every explicit date ("Apr 22"), relative date ("last week", "two weeks ago"), and event anchor ("during the kickoff") in the persona description.
- Resolve relative dates against the Current date in this prompt. "last week" = today − 7d; "yesterday" = today − 1d.
- For each anchored event, create a dedicated archetype whose timestamp field (\`vary\` of \`type: 'range'\`) clusters within ±1 day of the anchor — NOT a random timestamp across the full date range.
- Every entity in a cluster must get a DISTINCT timestamp (use \`range\` so the expander assigns unique values within the window).
- Mid-range "safe" dates are wrong. If the persona narrative anchors an event to a specific date, the data MUST land at that date.

**RULE H — NARRATIVE-NAMED-ENTITY ARCHETYPES (MANDATORY):**
The persona description also names specific entities — channels (\`#deals\`, \`#engineering\`), thread topics ("the SOC 2 review", "the intro outreach"), records ("Northwind deal", "Priya Shah"), proper nouns, kebab-case ids, quoted titles. These are HARD CONSTRAINTS for fields that name an entity (\`name\`, \`title\`, \`subject\`, \`thread_subject\`, \`channel_name\`, \`label\`, \`dealname\`, etc.).
- Extract every named entity from the persona — proper nouns, kebab-case ids, hash-prefixed channel names (\`#deals\` → \`deals\`), quoted titles, named threads.
- Create ONE dedicated archetype per named instance, with the relevant field PINNED to the EXACT persona string (preserve case, hyphens, spaces; strip only \`#\` / \`@\` routing punctuation). Two named channels → two archetypes; three named threads → three archetypes.
- Distinct narrative clusters MUST get distinct field values. Marshallers group by these strings (Gmail by \`thread_subject\`, Slack by channel \`name\`); collisions cause unwanted merges (47 emails collapsing into one thread, two channels merging into one).
- Cross-resource label fields are non-negotiable: when persona names a channel \`deals\`, BOTH \`channel.name = "deals"\` AND \`message.channel_name = "deals"\` must use the SAME exact string. The marshaller resolves cross-references by exact label match.
- NEVER substitute a generic placeholder ("Conversation", "general", "sample-channel", a corporate name when persona said \`deals\`) when the persona has named the entity.

**RULE I — NARRATIVE-NAMED-IDENTITY CONSISTENCY (MANDATORY):**
Named PEOPLE (proper nouns, named roles like "the AE Sarah") frequently span multiple adapter surfaces. Identity fields (\`email\`, \`full_name\`, \`firstname\`/\`lastname\`) are JOIN KEYS — agents navigate from one surface to another by matching them. Divergence is silent and breaks downstream joins.
- Decide canonical (\`full_name\`, \`email\`) ONCE per named person, BEFORE generating any adapter's content. Reuse byte-for-byte across every surface that person appears in.
- When persona pins an email (\`raj@northwind.com\`), use it verbatim everywhere.
- When persona names a person but does NOT pin an email, derive a canonical and reuse it. Match the format convention of any OTHER person in the same domain — if persona writes \`raj@northwind.com\`, use \`priya@northwind.com\` (NOT \`priya.shah@northwind.com\`). Default to bare-localpart \`firstname@domain\` when no other person at the same domain appears.
- Same person → identical strings everywhere: \`record_person.primary_email\` (Attio) = \`crm_contact.email\` (HubSpot) = \`message_email.from_email\` (Gmail, when sender is that person) = \`speaker.email\` (Granola transcript).
- NEVER let the LLM "improve" the format per resource. Corporate-style \`firstname.lastname@\` looks realistic in Gmail but breaks the CRM→email join if other surfaces use bare-localpart.

##############################################################################
# ARCHETYPE FORMAT
##############################################################################

- For resource types with 10+ expected entities → use \`apiEntityArchetypes\`
- For resource types with <10 entities → use \`apiEntities\` (flat arrays)
- Archetype weights should sum to ~1.0 per resource type
- Do NOT include \`created\` or \`created_at\` timestamps — the expander adds them

Available variation types:
- firstName, lastName, fullName, email, phone, companyName
- pick (random from values array), range (random int), decimal_range (random decimal)
- uuid, timestamp (random Unix seconds in date range), date (random ISO date)
- derived (template with {{fieldName}} placeholders), sequence (prefix + counter)

##############################################################################
# OUTPUT
##############################################################################

Output ONLY valid JSON matching the provided Zod schema. No markdown, no commentary.`;

/**
 * Build a prompt for a batch of API adapters ONLY (Phase 2 of batched
 * generation). Does not include DB schema or persona generation instructions.
 */
export function buildAdapterBatchPrompt(
  options: BuildAdapterBatchPromptOptions,
): PromptPair {
  const {
    persona,
    domain,
    apis,
    promptContexts,
    currentDate,
    volume,
    personaIndex,
    totalPersonas,
    phase1Summary,
  } = options;

  const today = currentDate ?? new Date().toISOString().split('T')[0];
  const startDate = volume ? computeStartDate(today, volume) : undefined;
  const apiSection = formatApis(apis, promptContexts);
  const batchAdapterKeys = Object.keys(apis).map(k => (apis[k] as { adapter?: string }).adapter ?? k);
  const dbContext = phase1Summary ? formatPhase1Summary(phase1Summary, batchAdapterKeys) : '';

  const dateRange = startDate
    ? `⚠ DATE RANGE: ${startDate} → ${today}. ALL generated dates MUST fall within this range.`
    : `⚠ Current date: ${today}. ALL generated dates must be relative to this date.`;

  const identityRegistry = buildIdentityRegistry(persona.description);

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
          `ALL string IDs MUST use format: "cus_p${personaIndex}_001", "sub_p${personaIndex}_001", etc.`,
          '',
        ]
      : []),
    ...(identityRegistry ? [identityRegistry, ''] : []),
    ...(dbContext ? [dbContext, ''] : []),
    apiSection,
    '',
    'Generate apiEntities and apiEntityArchetypes for ALL platforms listed above.',
    'Cover ALL resource types for each platform. Empty resources cause broken API endpoints.',
  ].join('\n');

  return { system: BATCH_SYSTEM_PROMPT, user };
}

/**
 * Build a "REGISTERED IDENTITIES" block that pre-extracts every named person
 * from the persona description and pins their canonical (full_name, email).
 * Pinned emails come straight from the persona text; unpinned named persons
 * get a derived `firstname@<dominant-domain>` email so identity fields remain
 * identical across every parallel adapter generation call.
 *
 * Without this, parallel adapter LLM calls each pick their own format
 * (Attio settles on `priya@`, Gmail drifts to `priya.shah@`) and downstream
 * cross-surface joins silently break.
 */
function buildIdentityRegistry(personaDescription: string): string {
  // 1. Pinned emails: anything that looks like `<localpart>@<domain>` in prose.
  const emailRe = /\b([a-zA-Z][\w.-]*?)@([a-zA-Z][\w.-]*?\.[a-zA-Z]{2,})\b/g;
  const pinned = new Map<string, string>(); // localpart-lower → full email
  for (const m of personaDescription.matchAll(emailRe)) {
    const local = (m[1] ?? '').toLowerCase();
    const full = `${m[1]}@${m[2]}`.toLowerCase();
    if (!pinned.has(local)) pinned.set(local, full);
  }

  // 2. Dominant domain among pinned emails — used to derive unpinned ones.
  const domainCounts = new Map<string, number>();
  for (const full of pinned.values()) {
    const dom = full.split('@')[1]!;
    domainCounts.set(dom, (domainCounts.get(dom) ?? 0) + 1);
  }
  const dominantDomain =
    [...domainCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  // 3. Named persons by FirstName-LastName proper-noun pairs in the prose.
  // Skip pairs that are clearly company/place names by ignoring those that
  // are followed by a comma + lowercase word ("Northwind Robotics, late-stage…")
  // — heuristic, not perfect, but fine for the common case.
  const personNameRe = /\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/g;
  const namedPersons = new Map<string, { fullName: string; firstName: string }>();
  for (const m of personaDescription.matchAll(personNameRe)) {
    const first = m[1]!;
    const last = m[2]!;
    const fullName = `${first} ${last}`;
    // Exclude common org/place tail-words and the words that immediately follow
    // a person-name in business prose (e.g. "Northwind Robotics" — Robotics).
    const orgTails = new Set([
      'Robotics', 'Inc', 'Ltd', 'LLC', 'Corp', 'Corporation', 'Co', 'Holdings',
      'Solutions', 'Systems', 'Technologies', 'Tech', 'Labs', 'Group', 'Capital',
      'Partners', 'Ventures', 'Software', 'Networks', 'Bank', 'Industries',
    ]);
    if (orgTails.has(last)) continue;
    if (!namedPersons.has(fullName.toLowerCase())) {
      namedPersons.set(fullName.toLowerCase(), { fullName, firstName: first });
    }
  }

  // 4. Build entries: prefer pinned email; otherwise derive bare-localpart at
  // dominant domain.
  const entries: string[] = [];
  for (const [, { fullName, firstName }] of namedPersons) {
    const local = firstName.toLowerCase();
    const email =
      pinned.get(local) ??
      (dominantDomain ? `${local}@${dominantDomain}` : null);
    if (!email) continue;
    entries.push(`  - ${fullName}: email=${email}, full_name="${fullName}"`);
  }
  // Also surface any pinned email whose localpart didn't match a FirstName-Last
  // pair (e.g. `raj@northwind.com` mentioned without "Raj Patel" alongside).
  for (const [local, full] of pinned) {
    const seen = entries.some((e) => e.includes(`email=${full}`));
    if (!seen) {
      const display = local.charAt(0).toUpperCase() + local.slice(1);
      entries.push(`  - ${display}: email=${full}`);
    }
  }

  if (entries.length === 0) return '';

  return [
    '⚠ REGISTERED IDENTITIES — USE THESE EXACT STRINGS:',
    'Every adapter generation call runs in parallel without shared state. To keep',
    'cross-surface identity joins working, the values below are pre-canonicalised.',
    'When the persona-named person below appears in ANY resource (Attio',
    'record_person, Gmail message_email, HubSpot crm_contact, Granola transcript',
    'speaker, Slack messages, Postgres users), use their email and full_name',
    'BYTE-FOR-BYTE as listed:',
    '',
    ...entries,
    '',
    'NEVER substitute a different format (e.g. firstname.lastname@) — the registry',
    'is the source of truth for identity. Adding an extra dot or rewriting the',
    'format silently breaks downstream agent joins.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Schema formatter  (human-readable dump for the LLM context window)
// ---------------------------------------------------------------------------

/**
 * Build a prominent reminder listing every REQUIRED column per table.
 * This makes it impossible for the LLM to miss them.
 */
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

/**
 * Format the Phase 1 generation summary for Phase 2 batch prompts.
 *
 * Gives the LLM context about what DB entities already exist and which
 * ID prefixes were used, so API archetypes use matching IDs for
 * cross-surface consistency.
 */
function formatPhase1Summary(summary: Phase1Summary, batchAdapterKeys?: string[]): string {
  const lines: string[] = [
    '--- DATABASE ENTITY SUMMARY (already generated — use matching IDs) ---',
    '⚠ CRITICAL: The database already has the following entities. Your API entity IDs',
    'MUST use the SAME sequence prefixes so cross-surface references are consistent.',
    '',
  ];

  for (const table of summary.tables) {
    lines.push(`  ${table.name}: ${table.rowCount} rows`);
  }

  // Show per-platform prefixes relevant to this batch
  const platforms = summary.platformPrefixes;
  const relevantPlatforms = batchAdapterKeys
    ? Object.entries(platforms).filter(([name]) => batchAdapterKeys.includes(name))
    : Object.entries(platforms);

  if (relevantPlatforms.length > 0) {
    lines.push('');
    lines.push('⚠ Platform-specific ID prefixes used in the DB (use these EXACT prefixes for API entities):');
    for (const [platform, entries] of relevantPlatforms) {
      for (const { column, prefix } of entries) {
        lines.push(`  ${platform} (DB ${column}) → "${prefix}" (e.g. "${prefix}001", "${prefix}002")`);
      }
    }
  } else if (Object.keys(summary.idPrefixes).length > 0) {
    lines.push('');
    lines.push('Sequence prefixes used in DB entities:');
    for (const [key, prefix] of Object.entries(summary.idPrefixes)) {
      lines.push(`  ${key} → "${prefix}" (e.g. "${prefix}001", "${prefix}002")`);
    }
  }

  lines.push('');
  lines.push(
    'For each platform\'s "customers" resource, the API entity `id` MUST use the same prefix ' +
    'as the DB entity\'s `external_id` or platform-specific ID column. This ensures an agent ' +
    'querying the API can find the same customer that exists in the database.',
  );
  lines.push('--- END DATABASE SUMMARY ---');
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
3. Also map non-bridge tables that have FK references to API platform IDs (e.g. an orders table with a stripe_customer_id column)

## Rules

- Only map columns that have a clear semantic correspondence — do NOT guess
- A single DB table may map to multiple API resources (e.g. a payments table may correspond to both charges and payment_intents)
- Multiple DB columns may map to the same API resource (e.g. name, email, status all map to customers)
- If a DB column name contains a platform prefix (e.g. \`stripe_customer_id\`), map it to that specific platform
- **CRITICAL: Emit one mapping entry PER adapter PER column. NEVER use wildcards like "all" or "any".**
  Different platforms use different resource names for the same concept (e.g. Stripe uses "charges" while PayPal uses "payments").
  You MUST emit a separate mapping for each platform with its correct resource name.
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
  lines.push('Identify bridge tables and map DB columns to API resource fields.');

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
   * Maps resource type → exact count. The LLM MUST use these counts
   * for identity resources (e.g. customers) to ensure DB↔API coordination.
   */
  identityEntityCounts?: Record<string, number>;
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
- "weight": fraction 0-1 (all weights sum to ~1.0)
- "fieldOverrides": array of { "field", "value" } pairs for CONSTANT values (value is always a string)
- "vary": optional array of { "field", "type", ... } for fields where you want a SPECIFIC variation strategy

## When to use vary
Most fields are auto-varied by the assembler from the spec (IDs, timestamps, emails, names, etc.).
Use "vary" ONLY when you have a specific opinion the assembler cannot infer:
- Amount ranges: { "field": "amount", "type": "range", "min": 500, "max": 2000 }
- Specific pick values: { "field": "currency", "type": "pick", "values": ["usd", "eur"] }
- Derived templates: { "field": "description", "type": "derived", "template": "Invoice for {{name}}" }
Do NOT include vary for: IDs (assembler handles prefixes), timestamps, emails, names, phones.

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

## Rules
- Archetype weights must sum to ~1.0 per resource type
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
  } = options;

  const today = currentDate ?? new Date().toISOString().split('T')[0];
  const startDate = volume ? computeStartDate(today, volume) : undefined;

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

  // Include identity entity count constraints if provided
  if (identityEntityCounts && Object.keys(identityEntityCounts).length > 0) {
    lines.push('');
    lines.push('--- IDENTITY ENTITY COUNT CONSTRAINTS (from DB coordination) ---');
    lines.push('⚠ MANDATORY: The following resource counts are coordinated with the database.');
    lines.push('You MUST use these EXACT counts for the specified resources:');
    lines.push('');
    for (const [resource, count] of Object.entries(identityEntityCounts)) {
      lines.push(`  ${resource}: exactly ${count} entities`);
    }
    lines.push('');
    lines.push('These counts ensure API entity totals match database identity table rows.');
    lines.push('Other non-identity resources can have any appropriate count.');
    lines.push('--- END CONSTRAINTS ---');
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
  lines.push('Each resource entry: { "resource": "<type>", "distribution": { "count": N, "archetypes": [...] } }');
  lines.push('Each archetype: { "label": "...", "weight": 0.N, "fieldOverrides": [...], "vary": [...] }');
  lines.push('fieldOverrides: [{ "field": "status", "value": "active" }] — constant values only, values are always strings.');
  lines.push('vary: [{ "field": "amount", "type": "range", "min": 500, "max": 5000 }] — only when you have a specific opinion the assembler cannot infer.');
  lines.push('facts: [{ "id": "fact_001", "type": "overdue", "platform": "<adapter>", "severity": "warn", "detail": "..." }] — testable assertions about the data.');

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

  return parts.join(' ');
}
