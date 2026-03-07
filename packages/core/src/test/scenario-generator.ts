import { z } from 'zod';
import type { LLMClient } from '../llm/client.js';
import type { CostTracker } from '../llm/cost-tracker.js';
import type {
  Fact,
  FactManifest,
  MimicScenario,
  ScenarioTier,
  FactSeverity,
} from '../types/fact-manifest.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Zod schema for LLM-generated scenario
// ---------------------------------------------------------------------------

const GeneratedScenarioSchema = z.object({
  name: z.string().describe('kebab-case scenario name, e.g. "chargebee-overdue-escalation"'),
  goal: z.string().describe('What the agent should demonstrate, e.g. "Agent surfaces the 34-day overdue invoice as highest priority"'),
  input: z.string().describe('The natural-language question to ask the agent'),
  response_contains: z
    .array(z.string())
    .describe('Terms the agent MUST mention in its response — use specific values from the fact data'),
  response_excludes: z
    .array(z.string())
    .describe('Phrases the agent must NOT say — hallucination guards, incorrect conclusions'),
  numeric_range: z
    .object({
      field: z.string(),
      min: z.number(),
      max: z.number(),
    })
    .optional()
    .describe('Optional numeric assertion — the agent must reference a number in this range'),
});

const BatchScenarioSchema = z.object({
  scenarios: z.array(GeneratedScenarioSchema),
});

// ---------------------------------------------------------------------------
// Tier mapping
// ---------------------------------------------------------------------------

const SEVERITY_TO_TIER: Record<FactSeverity, ScenarioTier> = {
  info: 'smoke',
  warn: 'functional',
  critical: 'adversarial',
};

const TIER_TO_LATENCY: Record<ScenarioTier, number> = {
  smoke: 10_000,
  functional: 20_000,
  adversarial: 15_000,
};

// ---------------------------------------------------------------------------
// ScenarioGenerator
// ---------------------------------------------------------------------------

export class ScenarioGenerator {
  private readonly llmClient: LLMClient;
  private readonly costTracker: CostTracker;

  constructor(llmClient: LLMClient, costTracker: CostTracker) {
    this.llmClient = llmClient;
    this.costTracker = costTracker;
  }

  /**
   * Generate MimicScenarios from a FactManifest.
   *
   * Uses a single batched LLM call for all facts to minimise latency and cost.
   * Falls back to per-fact calls if the batch fails.
   */
  async generate(
    manifest: FactManifest,
    tiers?: ScenarioTier[],
  ): Promise<MimicScenario[]> {
    let facts = manifest.facts;

    // Filter by tier (severity → tier mapping)
    if (tiers && tiers.length > 0) {
      const tierSet = new Set(tiers);
      facts = facts.filter((f) => tierSet.has(SEVERITY_TO_TIER[f.severity]));
    }

    if (facts.length === 0) {
      logger.debug('No facts to generate scenarios from');
      return [];
    }

    logger.debug(`Generating scenarios for ${facts.length} fact(s)`);

    const generated = await this.generateBatch(facts, manifest);
    const now = new Date().toISOString();

    return generated.map((g, i) => {
      const fact = facts[i]!;
      const tier = SEVERITY_TO_TIER[fact.severity];

      return {
        name: g.name,
        tier,
        source_fact: fact.id,
        goal: g.goal,
        input: g.input,
        expect: {
          response_contains: g.response_contains,
          response_excludes: g.response_excludes,
          numeric_range: g.numeric_range,
          max_latency_ms: TIER_TO_LATENCY[tier],
        },
        metadata: {
          persona: manifest.persona,
          platform: fact.platform,
          severity: fact.severity,
          generated: now,
        },
      };
    });
  }

  // -----------------------------------------------------------------------
  // LLM call
  // -----------------------------------------------------------------------

  private async generateBatch(
    facts: Fact[],
    manifest: FactManifest,
  ): Promise<z.infer<typeof GeneratedScenarioSchema>[]> {
    const factsBlock = facts
      .map(
        (f, i) =>
          `Fact ${i + 1} (${f.id}):\n` +
          `  type: ${f.type}\n` +
          `  platform: ${f.platform}\n` +
          `  severity: ${f.severity}\n` +
          `  detail: ${f.detail}\n` +
          `  data: ${JSON.stringify(f.data)}`,
      )
      .join('\n\n');

    const system = `You are a test scenario generator for AI agent evaluation.

Given a list of facts about generated data, produce one test scenario per fact.
Each scenario is a question an evaluator will ask the agent, plus assertions on what the response must and must not contain.

Rules:
- The "input" should be a natural question a user would ask, not a test instruction
- "response_contains" must use specific values from the fact's data (numbers, names, percentages, dates)
- "response_excludes" should guard against common hallucinations — the opposite of what's true
- If the fact has numeric data, include a numeric_range assertion with ±10% tolerance
- Return exactly one scenario per fact, in the same order as the input facts
- Scenario names should be kebab-case: {platform}-{fact-type}-{short-descriptor}`;

    const prompt = `Domain: ${manifest.domain}
Persona: ${manifest.persona}

${factsBlock}

Generate exactly ${facts.length} scenario(s), one per fact above.`;

    const { object } = await this.llmClient.generateObject({
      schema: BatchScenarioSchema,
      schemaName: 'scenarios',
      schemaDescription: 'Test scenarios generated from fact manifest',
      system,
      prompt,
      label: 'scenario-generation',
      category: 'generation',
      temperature: 0.3,
    });

    // Ensure we have exactly the right number of scenarios
    if (object.scenarios.length !== facts.length) {
      logger.warn(
        `LLM returned ${object.scenarios.length} scenarios for ${facts.length} facts — truncating/padding`,
      );
    }

    // Pad with fallback scenarios if LLM returned fewer
    const result = [...object.scenarios];
    while (result.length < facts.length) {
      const fact = facts[result.length]!;
      result.push({
        name: `${fact.platform}-${fact.type}-fallback`,
        goal: `Agent correctly identifies: ${fact.detail}`,
        input: `What can you tell me about ${fact.type} issues on ${fact.platform}?`,
        response_contains: [fact.platform],
        response_excludes: [],
      });
    }

    return result.slice(0, facts.length);
  }
}
