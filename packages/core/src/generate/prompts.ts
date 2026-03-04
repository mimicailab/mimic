import type { SchemaModel, TableInfo, ColumnInfo } from '../types/index.js';

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
  /** Current date (ISO string) — anchors all generated dates */
  currentDate?: string;
  /** Volume string from config (e.g. "6 months") — used to compute the date range for the LLM */
  volume?: string;
  /** 1-based index of this persona in the generation batch — used to namespace IDs */
  personaIndex?: number;
  /** Total number of personas being generated — helps with ID namespacing */
  totalPersonas?: number;
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
    - For **Stripe**: resource types include \`customers\`, \`products\`, \`prices\`, \`subscriptions\`, \`invoices\`, \`payment_intents\`. Amounts in cents.
    - For **Plaid**: resource types include \`accounts\`, \`transactions\`. Amounts: negative=debit, positive=credit. Dates: YYYY-MM-DD.
    - For **Slack**: resource types include \`channels\`, \`users\`.
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
          "email": { "type": "derived", "template": "{{name}}@gmail.com" },
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
          "email": { "type": "derived", "template": "{{name}}@company.com" },
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
- \`fullName\` — realistic full name
- \`email\` — random email address
- \`phone\` — phone number
- \`companyName\` — company name
- \`pick\` — random selection from \`values\` array
- \`range\` — random integer in [\`min\`, \`max\`]
- \`decimal_range\` — random decimal in [\`min\`, \`max\`]
- \`uuid\` — random UUID
- \`derived\` — template with \`{{fieldName}}\` placeholders referencing other fields in the same row. **Use this to preserve data consistency** (e.g. emails matching company domain, usernames derived from names).
- \`sequence\` — sequential ID with \`prefix\`, e.g. prefix "cus_p1_" → "cus_p1_001", "cus_p1_002"

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
            "email": { "type": "derived", "template": "{{name}}@gmail.com" }
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
- **Do NOT include \`created\` or \`created_at\` timestamps in API archetypes** — the expander automatically assigns random timestamps within the configured date range. If you hardcode timestamps they will be wrong.`;

// ---------------------------------------------------------------------------
// User prompt construction
// ---------------------------------------------------------------------------

/**
 * Build the system + user prompts for blueprint generation.
 */
export function buildPrompt(options: BuildPromptOptions): PromptPair {
  const { schema, persona, domain, apis, currentDate, volume, personaIndex, totalPersonas } = options;

  const today = currentDate ?? new Date().toISOString().split('T')[0];
  const startDate = volume ? computeStartDate(today, volume) : undefined;
  const hasTables = schema.tables.length > 0;
  const schemaDump = hasTables ? formatSchema(schema) : '';
  const requiredSummary = hasTables ? formatRequiredColumns(schema) : '';
  const apiSection = apis && Object.keys(apis).length > 0 ? formatApis(apis) : '';

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
): string {
  const lines: string[] = ['--- CONFIGURED APIs ---'];
  for (const [name, apiConfig] of Object.entries(apis)) {
    const adapterId = apiConfig.adapter ?? name;
    lines.push(`  ${adapterId}`);
  }
  lines.push('--- END APIs ---');
  lines.push('');
  lines.push(
    '⚠ MANDATORY: You MUST generate apiEntityArchetypes and/or apiEntities for each API listed above. ' +
      'Use apiEntityArchetypes for resource types with 10+ entities (same archetype format as entityArchetypes). ' +
      'Use apiEntities for small reference data (<10 items like products, prices). ' +
      'Use matching sequence prefixes between DB and API archetypes for cross-platform ID consistency. ' +
      'Do NOT skip API data generation.',
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
