import { z } from 'zod';
import type { LLMClient } from '../llm/client.js';
import type { ExpandedData, Row, ApiResponseSet } from '../types/dataset.js';
import type { Fact } from '../types/fact-manifest.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Data stats — a compact summary of expanded data for the LLM
// ---------------------------------------------------------------------------

export interface DataStats {
  /** Per-table row counts and column value distributions */
  tables: Record<string, TableStats>;
  /** Per-adapter resource counts and status distributions */
  apis: Record<string, Record<string, ResourceStats>>;
}

interface TableStats {
  rowCount: number;
  /** For categorical columns: value → count */
  distributions: Record<string, Record<string, number>>;
  /** For numeric columns: min, max, sum, avg */
  numerics: Record<string, { min: number; max: number; sum: number; avg: number }>;
}

interface ResourceStats {
  count: number;
  /** Status distribution if status field exists */
  statusDistribution?: Record<string, number>;
  /** Sum of amount fields if present */
  totalAmount?: number;
}

// ---------------------------------------------------------------------------
// Zod schema for LLM fact output
// ---------------------------------------------------------------------------

const FactOutputSchema = z.object({
  facts: z.array(z.object({
    id: z.string().describe('Unique fact ID, e.g. "fact_001"'),
    type: z.enum([
      'anomaly', 'overdue', 'pending', 'integrity', 'growth', 'risk',
      'dispute', 'churn', 'fraud', 'compliance', 'refund', 'upgrade',
      'downgrade', 'payment', 'cancellation',
    ]).describe('Category of the fact'),
    platform: z.string().describe('Source platform or "database"'),
    severity: z.enum(['info', 'warn', 'critical'])
      .describe('info = basic recognition, warn = reasoning required, critical = hallucination guard'),
    detail: z.string().describe('Human-readable summary with exact numbers from the data'),
    data: z.record(z.unknown()).describe('Structured key-value pairs with the exact numeric values referenced in detail'),
  })),
});

// ---------------------------------------------------------------------------
// Stats builder
// ---------------------------------------------------------------------------

/** Columns worth tracking distributions for (categorical) */
const CATEGORICAL_COLUMNS = new Set([
  'status', 'plan', 'tier', 'type', 'role', 'billing_platform',
  'platform', 'provider', 'source_platform', 'payment_provider',
  'currency', 'interval', 'state', 'category',
]);

/** Columns worth tracking numeric stats for */
const NUMERIC_COLUMN_PATTERNS = [
  'amount', 'price', 'total', 'balance', 'mrr', 'revenue', 'cost',
  'quantity', 'count', 'rate',
];

/**
 * Build a compact statistical summary of expanded data.
 * This is what we send to the LLM so it can write facts from truth.
 */
export function buildDataStats(expanded: ExpandedData): DataStats {
  const tables: Record<string, TableStats> = {};
  const apis: Record<string, Record<string, ResourceStats>> = {};

  // ---- DB tables ----
  for (const [tableName, rows] of Object.entries(expanded.tables)) {
    if (rows.length === 0) continue;
    tables[tableName] = buildTableStats(rows);
  }

  // ---- API responses ----
  for (const [adapterId, responseSet] of Object.entries(expanded.apiResponses)) {
    apis[adapterId] = {};
    for (const [resource, responses] of Object.entries(responseSet.responses)) {
      if (responses.length === 0) continue;
      const bodies = responses.map(r => r.body as Record<string, unknown>);
      apis[adapterId][resource] = buildResourceStats(bodies);
    }
  }

  return { tables, apis };
}

function buildTableStats(rows: Row[]): TableStats {
  const distributions: Record<string, Record<string, number>> = {};
  const numerics: Record<string, { min: number; max: number; sum: number; avg: number }> = {};

  if (rows.length === 0) return { rowCount: 0, distributions, numerics };

  // Sample first row for column names
  const sampleRow = rows[0]!;
  const columns = Object.keys(sampleRow);

  for (const col of columns) {
    // Categorical distributions
    if (CATEGORICAL_COLUMNS.has(col)) {
      const dist: Record<string, number> = {};
      for (const row of rows) {
        const val = String(row[col] ?? 'null');
        dist[val] = (dist[val] ?? 0) + 1;
      }
      distributions[col] = dist;
      continue;
    }

    // Numeric stats
    const isNumericCol = NUMERIC_COLUMN_PATTERNS.some(p => col.includes(p));
    if (isNumericCol) {
      let min = Infinity, max = -Infinity, sum = 0, count = 0;
      for (const row of rows) {
        const val = Number(row[col]);
        if (!isNaN(val)) {
          min = Math.min(min, val);
          max = Math.max(max, val);
          sum += val;
          count++;
        }
      }
      if (count > 0) {
        numerics[col] = { min, max, sum, avg: Math.round(sum / count * 100) / 100 };
      }
    }
  }

  // Also track date-based columns for recency analysis
  const dateColumns = columns.filter(c =>
    c.includes('login') || c.includes('_at') || c.includes('_date'),
  );
  const now = Date.now();
  for (const col of dateColumns) {
    if (distributions[col] || numerics[col]) continue; // already tracked
    // Build age buckets: <7d, 7-30d, 30-90d, >90d
    const buckets: Record<string, number> = {
      'last_7_days': 0,
      '7_to_30_days': 0,
      '30_to_90_days': 0,
      'over_90_days': 0,
      'null': 0,
    };
    for (const row of rows) {
      const val = row[col];
      if (val == null) { buckets['null']!++; continue; }
      const age = now - new Date(val as string).getTime();
      const days = age / (24 * 3600 * 1000);
      if (days < 7) buckets['last_7_days']!++;
      else if (days < 30) buckets['7_to_30_days']!++;
      else if (days < 90) buckets['30_to_90_days']!++;
      else buckets['over_90_days']!++;
    }
    // Only include if there's meaningful variation
    const nonZero = Object.values(buckets).filter(v => v > 0).length;
    if (nonZero >= 2) {
      distributions[col] = buckets;
    }
  }

  return { rowCount: rows.length, distributions, numerics };
}

function buildResourceStats(bodies: Record<string, unknown>[]): ResourceStats {
  const stats: ResourceStats = { count: bodies.length };

  // Status distribution
  const statusDist: Record<string, number> = {};
  let hasStatus = false;
  for (const body of bodies) {
    const status = body.status as string | undefined;
    if (status) {
      hasStatus = true;
      statusDist[status] = (statusDist[status] ?? 0) + 1;
    }
  }
  if (hasStatus) stats.statusDistribution = statusDist;

  // Total amount
  let totalAmount = 0;
  let hasAmount = false;
  for (const body of bodies) {
    const amt = (body.amount_due as number) ?? (body.amount as number) ?? (body.total as number);
    if (typeof amt === 'number') {
      hasAmount = true;
      totalAmount += amt;
    }
  }
  if (hasAmount) stats.totalAmount = totalAmount;

  return stats;
}

// ---------------------------------------------------------------------------
// Fact generation prompt
// ---------------------------------------------------------------------------

const FACT_GENERATION_SYSTEM = `You are a data analyst examining a synthetic dataset generated for testing AI billing agents.

Your job: produce **testable facts** that describe what actually exists in the data.

## Rules
1. Every number in your facts MUST come directly from the data stats provided. Do NOT invent numbers.
2. Each fact must be verifiable — an automated test could check the data and confirm the fact is true.
3. Include facts across different severity levels:
   - **info**: Basic counts and distributions an agent should recognise (e.g., "1,200 Stripe customers")
   - **warn**: Patterns requiring reasoning (e.g., "3 overdue invoices totalling £12,400 on Chargebee")
   - **critical**: Edge cases an agent must NOT hallucinate about (e.g., "0 fraud cases on Paddle — agent must not invent any")
4. Cover all platforms and the database. Include cross-platform facts where interesting.
5. The "data" object must contain the exact numeric values that make the fact testable:
   - For counts: { "count": <exact number> }
   - For amounts: { "total_amount": <exact number>, "currency": "..." }
   - For distributions: { "count": N, "total": M, "percentage": P }
   - For comparisons: { "platform_a_count": N, "platform_b_count": M }
6. Produce 8-20 facts. Quality over quantity — each fact should be useful for testing an agent.
7. The "detail" field is human-readable. The "data" field is machine-readable. Both must agree.

## Fact types to consider
- **overdue**: Invoices past due, with counts and amounts
- **churn**: Canceled/expired subscriptions, rates
- **risk**: Inactive users, at-risk accounts, login patterns
- **integrity**: Data consistency issues (e.g., paid users without billing records)
- **growth**: Revenue trends, customer acquisition
- **dispute**: Open disputes, amounts at risk
- **pending**: Pending settlements, charges
- **anomaly**: Unusual patterns in the data
- **payment/refund/upgrade/downgrade/cancellation**: Transaction patterns`;

/**
 * Generate facts from actual expanded data using an LLM.
 *
 * The LLM sees real data stats (counts, distributions, amounts) and produces
 * facts that are guaranteed to match the data — no enforcement needed.
 */
export async function generateFacts(
  llmClient: LLMClient,
  expanded: ExpandedData,
  persona: { name: string; description: string },
  domain: string,
): Promise<Fact[]> {
  const stats = buildDataStats(expanded);

  // Build user prompt with actual data stats
  const userPrompt = [
    `Domain: ${domain}`,
    `Persona: "${persona.name}"`,
    persona.description,
    '',
    '## Actual Data Stats',
    '',
    '### Database Tables',
    ...Object.entries(stats.tables).map(([table, s]) => {
      const lines = [`**${table}** (${s.rowCount} rows)`];
      for (const [col, dist] of Object.entries(s.distributions)) {
        const entries = Object.entries(dist)
          .sort((a, b) => b[1] - a[1])
          .map(([v, c]) => `${v}: ${c}`)
          .join(', ');
        lines.push(`  ${col}: { ${entries} }`);
      }
      for (const [col, n] of Object.entries(s.numerics)) {
        lines.push(`  ${col}: min=${n.min}, max=${n.max}, sum=${n.sum}, avg=${n.avg}`);
      }
      return lines.join('\n');
    }),
    '',
    '### API Platforms',
    ...Object.entries(stats.apis).map(([adapter, resources]) => {
      const lines = [`**${adapter}**`];
      for (const [resource, s] of Object.entries(resources)) {
        let line = `  ${resource}: ${s.count} entities`;
        if (s.statusDistribution) {
          const dist = Object.entries(s.statusDistribution)
            .sort((a, b) => b[1] - a[1])
            .map(([v, c]) => `${v}: ${c}`)
            .join(', ');
          line += ` — status: { ${dist} }`;
        }
        if (s.totalAmount !== undefined) {
          line += ` — total amount: ${s.totalAmount}`;
        }
        lines.push(line);
      }
      return lines.join('\n');
    }),
    '',
    'Generate facts that accurately describe this data. Every number must match the stats above.',
  ].join('\n');

  try {
    logger.step('Generating facts from expanded data...');

    const result = await llmClient.generateObject({
      schema: FactOutputSchema,
      schemaName: 'FactOutput',
      schemaDescription: 'Testable facts derived from actual expanded data statistics',
      system: FACT_GENERATION_SYSTEM,
      prompt: userPrompt,
      label: `facts:${persona.name}`,
      category: 'generation',
      temperature: 0.3, // Low temperature — we want accuracy, not creativity
    });

    const facts = result.object.facts as Fact[];
    logger.success(`Generated ${facts.length} facts from actual data`);
    return facts;
  } catch (error) {
    logger.warn(
      `Fact generation failed: ${error instanceof Error ? error.message : String(error)}. ` +
      `Falling back to blueprint facts.`,
    );
    return expanded.facts;
  }
}
