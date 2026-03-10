import type { SchemaModel, TableInfo, ColumnInfo, PromptContext } from '../types/index.js';

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
Examine the schema foreign keys. For EVERY child table where the business relationship is "each parent has many of these over time", you MUST use \`forEachParent\` pointing to the parent entity table. Without it, your patterns will produce unrealistically few rows. The expander infers the FK column from the schema automatically — you only need to set \`forEachParent.table\` and include a \`{{parentTable.pk}}\` placeholder in the pattern fields for that FK column.`;


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
    ...(dbContext ? [dbContext, ''] : []),
    apiSection,
    '',
    'Generate apiEntities and apiEntityArchetypes for ALL platforms listed above.',
    'Cover ALL resource types for each platform. Empty resources cause broken API endpoints.',
  ].join('\n');

  return { system: BATCH_SYSTEM_PROMPT, user };
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
