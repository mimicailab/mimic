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
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a synthetic data architect specialising in generating realistic, persona-driven data blueprints.

Your task is to produce a JSON blueprint that describes a single fictional persona and the data patterns that define their behaviour within a specific domain.  The blueprint will later be deterministically expanded into full database rows, so your output must be **structurally complete** but **compact**.

Rules:
1. The persona must feel like a real person — give them a coherent backstory, plausible name, age, occupation, and location that match the description you are given.
2. Produce static "entity" rows for reference / dimension tables (accounts, categories, etc.) and "pattern" definitions for fact / transactional tables.
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
10. Output **only** valid JSON matching the provided Zod schema.  No markdown, no commentary.
11. If API services are listed under CONFIGURED APIs, produce an \`apiEntities\` object alongside \`entities\`.
    - \`apiEntities\` is keyed by adapter ID (e.g. "stripe", "slack"), then by resource type, then an array of entity seed objects.
    - Entity seeds are compact "DNA" — the expander will add timestamps and metadata. Include IDs that match any cross-platform ID columns in the database entities (e.g. if a DB customer row has stripe_customer_id "cus_001", the Stripe customer entity must use id "cus_001").
    - For **Stripe**: resource types are \`customers\`, \`products\`, \`prices\`, \`subscriptions\`, \`invoices\`. Amounts in cents. Include fields: id, name, email, amount/unit_amount, currency, status, interval.
    - For **Plaid**: resource types are \`accounts\` and \`transactions\`. For accounts: id, institution/name, type/subtype, balance. For transactions: id, account_id (must reference an account id), amount (negative=debit, positive=credit), date (YYYY-MM-DD), merchant, category. Generate a realistic volume of transactions covering the full time period — this is the primary data source for the persona's financial history.
    - For **Slack**: resource types are \`channels\`, \`users\`. Include fields: id, name, purpose/real_name.
    - If no database schema is provided, generate apiEntities based solely on the persona and domain description.`;

// ---------------------------------------------------------------------------
// User prompt construction
// ---------------------------------------------------------------------------

/**
 * Build the system + user prompts for blueprint generation.
 */
export function buildPrompt(options: BuildPromptOptions): PromptPair {
  const { schema, persona, domain, apis } = options;

  const hasTables = schema.tables.length > 0;
  const schemaDump = hasTables ? formatSchema(schema) : '';
  const requiredSummary = hasTables ? formatRequiredColumns(schema) : '';
  const apiSection = apis && Object.keys(apis).length > 0 ? formatApis(apis) : '';

  const user = [
    `Domain: ${domain}`,
    '',
    `Persona: "${persona.name}"`,
    persona.description,
    '',
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
    'Generate apiEntities for each configured API above. ' +
      'Ensure data consistency between database entities and API entities.',
  );
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
