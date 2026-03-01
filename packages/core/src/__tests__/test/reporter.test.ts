import { describe, it, expect } from 'vitest';
import type { TestReport } from '../../types/test.js';

const sampleReport: TestReport = {
  totalScenarios: 3,
  passed: 2,
  failed: 1,
  duration: 12400,
  results: [
    {
      scenario: 'monthly-spending',
      persona: 'young-professional',
      passed: true,
      duration: 2341,
      agentInput: 'How much did I spend last month?',
      agentOutput: 'You spent $2,543.21 last month.',
      toolsCalled: ['get_transactions'],
      evaluations: [
        { check: 'tools_called', passed: true, expected: ['get_transactions'], actual: ['get_transactions'] },
        { check: 'response_accurate', passed: true, explanation: 'Response matches ground truth.' },
      ],
    },
    {
      scenario: 'category-breakdown',
      persona: 'young-professional',
      passed: true,
      duration: 3200,
      agentInput: 'Break down my spending by category',
      agentOutput: 'Here is your spending breakdown: Dining $523.45, Groceries $342.12...',
      toolsCalled: ['get_transactions_summary'],
      evaluations: [
        { check: 'tools_called', passed: true },
        { check: 'response_contains', passed: true },
      ],
    },
    {
      scenario: 'balance-check',
      persona: 'college-student',
      passed: false,
      duration: 5100,
      agentInput: 'What is my balance?',
      agentOutput: 'Your balance is $10,000.',
      toolsCalled: [],
      evaluations: [
        { check: 'tools_called', passed: false, expected: ['get_accounts'], actual: [] },
        { check: 'response_accurate', passed: false, explanation: 'Agent did not call any tools.' },
      ],
    },
  ],
  cost: { generation: 0.02, evaluation: 0.06, total: 0.08 },
};

describe('Reporter', () => {
  it('should have correct pass/fail counts', () => {
    expect(sampleReport.passed).toBe(2);
    expect(sampleReport.failed).toBe(1);
    expect(sampleReport.totalScenarios).toBe(3);
  });

  it('should have cost breakdown', () => {
    expect(sampleReport.cost.total).toBe(0.08);
    expect(sampleReport.cost.generation + sampleReport.cost.evaluation).toBeCloseTo(sampleReport.cost.total);
  });

  it('should serialize to valid JSON', () => {
    const json = JSON.stringify(sampleReport);
    const parsed = JSON.parse(json);
    expect(parsed.totalScenarios).toBe(3);
    expect(parsed.results).toHaveLength(3);
  });

  it('should have all evaluation details', () => {
    for (const result of sampleReport.results) {
      expect(result.evaluations.length).toBeGreaterThan(0);
      for (const evaluation of result.evaluations) {
        expect(evaluation.check).toBeTruthy();
        expect(typeof evaluation.passed).toBe('boolean');
      }
    }
  });
});
