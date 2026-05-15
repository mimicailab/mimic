/**
 * User-prompt builder for the contract compiler.
 *
 * Extracted from the legacy `generate/prompts.ts` so the V5 contract front
 * end has no remaining import into the deleted back-half. The compiler in
 * [contract-compiler.ts](./contract-compiler.ts) supplies its own
 * V5 system prompt and consumes only the grounded *user* prompt this
 * function returns — schema/adapter/bridge summaries plus the date range —
 * so the LLM has enough surface context to emit clauses with valid targets.
 */
import type {
  SchemaModel,
  PromptContext,
  AdapterResourceSpecs,
  ResourceSpec,
} from '../types/index.js';
import type { SchemaMapping } from '../types/blueprint.js';

void ({} as PromptContext);

export interface BuildCompilerUserPromptOptions {
  schema: SchemaModel;
  persona: { name: string; description: string };
  domain: string;
  /** Configured API adapters → array of resource names */
  adapterResources?: Record<string, string[]>;
  /** Full ResourceSpecs for field-grounded extraction. */
  resourceSpecs?: Record<string, AdapterResourceSpecs>;
  /** Schema mapping — drives the BRIDGE TABLES block */
  schemaMapping?: SchemaMapping;
  /** Current date (ISO YYYY-MM-DD) */
  currentDate?: string;
  /** Volume string from config (e.g. "6 months") */
  volume?: string;
  /** 1-based persona index */
  personaIndex?: number;
  /** Total personas in this batch */
  totalPersonas?: number;
}

/**
 * Build the user prompt for the contract compiler LLM call. The system
 * prompt lives next to the compiler so the V5 vocabulary stays close to the
 * code that consumes the output.
 */
export function buildCompilerUserPrompt(options: BuildCompilerUserPromptOptions): string {
  const {
    schema,
    persona,
    domain,
    adapterResources,
    resourceSpecs,
    schemaMapping,
    currentDate,
    volume,
    personaIndex,
    totalPersonas,
  } = options;

  const today = currentDate ?? new Date().toISOString().split('T')[0]!;
  const startDate = volume ? computeStartDate(today, volume) : undefined;

  const tableSummary = schema.tables.length > 0 ? formatTableSummary(schema) : '';
  // Prefer the field-grounded summary when resourceSpecs is available —
  // otherwise fall back to the lighter resource-name list.
  const adapterSummary =
    resourceSpecs && Object.keys(resourceSpecs).length > 0
      ? formatAdapterFieldSummary(resourceSpecs)
      : adapterResources && Object.keys(adapterResources).length > 0
        ? formatAdapterSummary(adapterResources)
        : '';
  const bridgeBlock = schemaMapping ? formatBridgeBlock(schemaMapping) : '';

  const dateRange = startDate
    ? `Date range: ${startDate} → ${today} (every date you produce MUST fall within this range — resolve relative dates against ${today})`
    : `Current date: ${today}`;

  const personaHint = personaIndex !== undefined
    ? `Persona index: ${personaIndex}${totalPersonas ? ` of ${totalPersonas}` : ''}`
    : '';

  return [
    `Domain: ${domain}`,
    '',
    `Persona: "${persona.name}"`,
    persona.description,
    '',
    dateRange,
    ...(personaHint ? ['', personaHint] : []),
    ...(tableSummary ? ['', tableSummary] : []),
    ...(adapterSummary ? ['', adapterSummary] : []),
    ...(bridgeBlock ? ['', bridgeBlock] : []),
    '',
    'Compile the persona contract. Emit one clause per requirement the persona states. Carry the exact source quote on every clause. Return ONLY the JSON object.',
  ].join('\n');
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

/** Compact one-line-per-table schema summary — enough grounding for target selection */
function formatTableSummary(schema: SchemaModel): string {
  const lines: string[] = ['--- DATABASE TABLES (for clause targets) ---'];
  for (const t of schema.tables) {
    const cols = t.columns.map((c) => c.name).join(', ');
    lines.push(`  ${t.name}: ${cols}`);
  }
  lines.push('--- END TABLES ---');
  return lines.join('\n');
}

function formatAdapterSummary(adapterResources: Record<string, string[]>): string {
  const lines: string[] = ['--- API ADAPTERS (for api.<adapter>.<resource> clause targets) ---'];
  for (const [adapter, resources] of Object.entries(adapterResources)) {
    lines.push(`  ${adapter}: ${resources.join(', ')}`);
  }
  lines.push('--- END ADAPTERS ---');
  return lines.join('\n');
}

/**
 * Field-grounded adapter summary. Lists every resource per adapter together
 * with the exact fields that resource exposes. The LLM is told that filter
 * keys in clause targets MUST match one of these fields.
 */
function formatAdapterFieldSummary(
  resourceSpecs: Record<string, AdapterResourceSpecs>,
): string {
  const lines: string[] = [
    '--- API RESOURCES + FIELDS (clause filter keys MUST exist in this list) ---',
    '',
    'Each line: api.<adapter>.<resource> → fields available for filters and',
    'pinned-value / aggregate predicates. If the persona narrates a fact whose',
    'natural filter key is NOT listed for the resource, retarget to a sibling',
    'resource that DOES expose it (e.g. tier/plan filters belong on subscription,',
    'NOT on customer). Never invent fields.',
    '',
  ];
  for (const [adapterId, specs] of Object.entries(resourceSpecs)) {
    for (const [resourceName, spec] of Object.entries(specs.resources)) {
      const fields = listResourceFilterableFields(spec);
      lines.push(`  api.${adapterId}.${resourceName}: ${fields.join(', ')}`);
    }
  }
  lines.push('--- END API RESOURCES + FIELDS ---');
  return lines.join('\n');
}

/**
 * List the fields on a ResourceSpec that are legal filter targets. Nested
 * object fields are flattened one level (e.g. `unit_amount.amount`).
 */
function listResourceFilterableFields(spec: ResourceSpec): string[] {
  const out: string[] = [];
  for (const [field, fieldSpec] of Object.entries(spec.fields)) {
    out.push(field);
    if (fieldSpec.type === 'object' && fieldSpec.properties) {
      for (const inner of Object.keys(fieldSpec.properties)) {
        out.push(`${field}.${inner}`);
      }
    }
  }
  return out;
}

function formatBridgeBlock(schemaMapping: SchemaMapping): string {
  const bridgeTables = schemaMapping.bridgeTables;
  if (!bridgeTables || bridgeTables.length === 0) return '';

  // Group api targets per bridge table
  const targetsByTable = new Map<string, Set<string>>();
  for (const m of schemaMapping.mappings) {
    if (!bridgeTables.includes(m.dbTable)) continue;
    if (m.apiField !== 'id') continue;
    if (!m.adapterId || !m.apiResource) continue;
    const set = targetsByTable.get(m.dbTable) ?? new Set();
    set.add(`${m.adapterId}.${m.apiResource}`);
    targetsByTable.set(m.dbTable, set);
  }

  const lines: string[] = [
    '--- BRIDGE TABLES (DB tables produced by the API → DB mirror) ---',
    'For these tables, prefer api.<adapter>.<resource> targets when the persona',
    'pins a specific platform. Clauses without a platform filter (e.g. plan/status',
    'only) stay on the DB surface.',
    '',
  ];
  for (const t of bridgeTables) {
    const targets = targetsByTable.get(t);
    if (targets && targets.size > 0) {
      lines.push(`  - ${t}  →  ${[...targets].sort().join(', ')}`);
    } else {
      lines.push(`  - ${t}`);
    }
  }
  lines.push('--- END BRIDGE TABLES ---');
  return lines.join('\n');
}
