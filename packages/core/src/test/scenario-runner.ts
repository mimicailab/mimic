import type { LLMClient } from '../llm/index.js';
import type { CostTracker } from '../llm/index.js';
import type {
  TestScenario,
  TestResult,
  TestReport,
  ExpandedData,
} from '../types/index.js';
import { TestAgentError } from '../utils/errors.js';
import { PersonaSimulator } from './persona-sim.js';
import { Evaluator, type AgentResponse } from './evaluator.js';
import { Reporter } from './reporter.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Describes the agent endpoint that the test runner sends requests to.
 */
export interface TestTarget {
  /** Protocol type.  Only HTTP is supported in v0.1.0. */
  type: 'http';
  /** Full URL of the agent endpoint (e.g. `http://localhost:3000/chat`). */
  url: string;
  /** Per-request timeout in milliseconds (default 30 000). */
  timeout?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// ScenarioRunner
// ---------------------------------------------------------------------------

/**
 * Orchestrates the full test loop for every scenario:
 *
 *   1. **Generate input** via {@link PersonaSimulator}.
 *   2. **POST to agent** HTTP endpoint with the generated message.
 *   3. **Parse** the agent's response as {@link AgentResponse}.
 *   4. **Evaluate** the response with {@link Evaluator}.
 *   5. **Build** a {@link TestResult} per scenario and a final {@link TestReport}.
 *
 * Gracefully handles agent timeouts, HTTP errors, and malformed JSON
 * responses by marking the scenario as failed with a descriptive error.
 */
export class ScenarioRunner {
  private readonly llmClient: LLMClient;
  private readonly evaluator: Evaluator;
  private readonly reporter: Reporter;
  private readonly costTracker: CostTracker;
  private readonly personaSim: PersonaSimulator;

  constructor(
    llmClient: LLMClient,
    evaluator: Evaluator,
    reporter: Reporter,
    costTracker: CostTracker,
  ) {
    this.llmClient = llmClient;
    this.evaluator = evaluator;
    this.reporter = reporter;
    this.costTracker = costTracker;
    this.personaSim = new PersonaSimulator(llmClient);
  }

  /**
   * Run all scenarios against the specified agent target and return a
   * complete test report.
   *
   * @param scenarios - The list of test scenarios to execute.
   * @param target    - The agent HTTP endpoint to test against.
   * @param data      - Map of persona ID to expanded ground-truth data.
   * @returns A filled-in {@link TestReport}.
   */
  async run(
    scenarios: TestScenario[],
    target: TestTarget,
    data: Map<string, ExpandedData>,
  ): Promise<TestReport> {
    const suiteStart = performance.now();
    const results: TestResult[] = [];

    for (const scenario of scenarios) {
      const result = await this.runSingle(scenario, target, data);
      results.push(result);
    }

    const suiteDuration = performance.now() - suiteStart;
    const costSummary = this.costTracker.getSummary();

    const report: TestReport = {
      totalScenarios: scenarios.length,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      duration: Math.round(suiteDuration),
      results,
      cost: {
        generation: costSummary.generation,
        evaluation: costSummary.evaluation,
        total: costSummary.total,
      },
    };

    return report;
  }

  // -----------------------------------------------------------------------
  // Single scenario execution
  // -----------------------------------------------------------------------

  private async runSingle(
    scenario: TestScenario,
    target: TestTarget,
    data: Map<string, ExpandedData>,
  ): Promise<TestResult> {
    const scenarioStart = performance.now();

    // Resolve persona ground-truth data
    const groundTruth = data.get(scenario.persona);
    if (!groundTruth) {
      return this.buildFailedResult(
        scenario,
        '',
        '',
        [],
        performance.now() - scenarioStart,
        `No ground-truth data found for persona "${scenario.persona}". ` +
          `Available personas: ${[...data.keys()].join(', ')}`,
      );
    }

    const persona = groundTruth.blueprint.persona;

    // 1. Generate input
    let input: string;
    try {
      input = await this.personaSim.generateInput(scenario, persona);
      logger.debug(`[${scenario.name}] Input: ${input}`);
    } catch (err) {
      return this.buildFailedResult(
        scenario,
        '',
        '',
        [],
        performance.now() - scenarioStart,
        `Failed to generate input: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 2. Call agent
    let agentResponse: AgentResponse;
    const agentCallStart = performance.now();
    try {
      const { response } = await this.callAgent(target, input);
      agentResponse = response;
    } catch (err) {
      const duration = performance.now() - scenarioStart;
      const message =
        err instanceof TestAgentError ? err.message : String(err);
      return this.buildFailedResult(
        scenario,
        input,
        '',
        [],
        duration,
        message,
      );
    }
    const agentDuration = performance.now() - agentCallStart;

    logger.debug(
      `[${scenario.name}] Agent responded in ${Math.round(agentDuration)}ms`,
    );

    // 3. Evaluate
    let evaluations;
    try {
      evaluations = await this.evaluator.evaluate(
        scenario,
        agentResponse,
        groundTruth,
        agentDuration,
      );
    } catch (err) {
      return this.buildFailedResult(
        scenario,
        input,
        agentResponse.text,
        agentResponse.toolCalls.map((tc) => tc.name),
        performance.now() - scenarioStart,
        `Evaluation error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 4. Build result
    const passed = evaluations.every((e) => e.passed);
    const scenarioDuration = performance.now() - scenarioStart;
    const evalCost = this.costTracker
      .getSummary()
      .entries.filter(
        (e) =>
          e.category === 'evaluation' &&
          e.label.includes(scenario.name),
      )
      .reduce((sum, e) => sum + e.cost, 0);

    return {
      scenario: scenario.name,
      persona: scenario.persona,
      passed,
      duration: Math.round(scenarioDuration),
      agentInput: input,
      agentOutput: agentResponse.text,
      toolsCalled: agentResponse.toolCalls.map((tc) => tc.name),
      evaluations,
      llmCost: evalCost > 0 ? evalCost : undefined,
    };
  }

  // -----------------------------------------------------------------------
  // Agent HTTP call
  // -----------------------------------------------------------------------

  /**
   * POST the user message to the agent endpoint and parse the JSON response.
   *
   * @throws {TestAgentError} on timeout, HTTP errors, or invalid JSON.
   */
  private async callAgent(
    target: TestTarget,
    message: string,
  ): Promise<{ response: AgentResponse; raw: string }> {
    const timeoutMs = target.timeout ?? DEFAULT_TIMEOUT_MS;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let httpResponse: Response;
    try {
      httpResponse = await fetch(target.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new TestAgentError(
          `Agent timed out after ${timeoutMs}ms`,
          target.url,
        );
      }
      throw new TestAgentError(
        `Failed to reach agent: ${err instanceof Error ? err.message : String(err)}`,
        target.url,
        err instanceof Error ? err : undefined,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!httpResponse.ok) {
      const body = await httpResponse.text().catch(() => '');
      throw new TestAgentError(
        `Agent returned HTTP ${httpResponse.status}: ${body.slice(0, 200)}`,
        target.url,
      );
    }

    const raw = await httpResponse.text();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new TestAgentError(
        `Agent returned invalid JSON: ${raw.slice(0, 200)}`,
        target.url,
      );
    }

    const response = this.parseAgentResponse(parsed, target.url);
    return { response, raw };
  }

  /**
   * Validate and normalize the parsed JSON into an {@link AgentResponse}.
   * Tolerates missing `toolCalls` (defaults to empty array) but requires
   * a `text` field.
   */
  private parseAgentResponse(data: unknown, url: string): AgentResponse {
    if (typeof data !== 'object' || data === null) {
      throw new TestAgentError(
        'Agent response is not a JSON object',
        url,
      );
    }

    const obj = data as Record<string, unknown>;

    if (typeof obj.text !== 'string') {
      throw new TestAgentError(
        'Agent response missing required "text" field (string)',
        url,
      );
    }

    let toolCalls: AgentResponse['toolCalls'] = [];
    if (Array.isArray(obj.toolCalls)) {
      toolCalls = obj.toolCalls.map((tc: unknown, i: number) => {
        if (typeof tc !== 'object' || tc === null) {
          throw new TestAgentError(
            `toolCalls[${i}] is not an object`,
            url,
          );
        }
        const call = tc as Record<string, unknown>;
        if (typeof call.name !== 'string') {
          throw new TestAgentError(
            `toolCalls[${i}].name is not a string`,
            url,
          );
        }
        return {
          name: call.name,
          arguments:
            typeof call.arguments === 'object' && call.arguments !== null
              ? (call.arguments as Record<string, unknown>)
              : {},
        };
      });
    }

    return { text: obj.text, toolCalls };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private buildFailedResult(
    scenario: TestScenario,
    agentInput: string,
    agentOutput: string,
    toolsCalled: string[],
    duration: number,
    errorMessage: string,
  ): TestResult {
    return {
      scenario: scenario.name,
      persona: scenario.persona,
      passed: false,
      duration: Math.round(duration),
      agentInput,
      agentOutput,
      toolsCalled,
      evaluations: [
        {
          check: 'error',
          passed: false,
          explanation: errorMessage,
        },
      ],
    };
  }
}
