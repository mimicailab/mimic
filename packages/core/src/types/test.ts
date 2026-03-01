export interface TestScenario {
  name: string;
  persona: string;
  goal: string;
  input?: string;
  mode: 'text' | 'voice';
  expect: TestExpectation;
}

export interface TestExpectation {
  tools_called?: string[];
  response_contains?: string[];
  response_accurate?: boolean;
  no_hallucination?: boolean;
  confirms_before_action?: boolean;
  max_latency_ms?: number;
  custom?: Record<string, unknown>;
}

export interface TestResult {
  scenario: string;
  persona: string;
  passed: boolean;
  duration: number;
  agentInput: string;
  agentOutput: string;
  toolsCalled: string[];
  evaluations: EvaluationDetail[];
  llmCost?: number;
}

export interface EvaluationDetail {
  check: string;
  passed: boolean;
  expected?: unknown;
  actual?: unknown;
  explanation?: string;
}

export interface TestReport {
  totalScenarios: number;
  passed: number;
  failed: number;
  duration: number;
  results: TestResult[];
  cost: { generation: number; evaluation: number; total: number };
}
