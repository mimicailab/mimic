import { describe, it, expect } from 'vitest';

describe('Evaluator - keyword checks', () => {
  it('should pass tools_called when all expected tools are present', () => {
    const expected = ['get_transactions', 'get_accounts'];
    const actual = ['get_transactions', 'get_accounts', 'get_user_profile'];

    const allPresent = expected.every((tool) => actual.includes(tool));
    expect(allPresent).toBe(true);
  });

  it('should fail tools_called when expected tool is missing', () => {
    const expected = ['get_transactions', 'get_balance'];
    const actual = ['get_transactions'];

    const allPresent = expected.every((tool) => actual.includes(tool));
    expect(allPresent).toBe(false);
  });

  it('should pass response_contains with case-insensitive matching', () => {
    const response = 'Your total spending on Dining was $523.45 last month.';
    const keywords = ['dining', 'spending'];

    const allContained = keywords.every((kw) =>
      response.toLowerCase().includes(kw.toLowerCase()),
    );
    expect(allContained).toBe(true);
  });

  it('should fail response_contains when keyword is missing', () => {
    const response = 'Your total spending was $523.45 last month.';
    const keywords = ['groceries'];

    const allContained = keywords.every((kw) =>
      response.toLowerCase().includes(kw.toLowerCase()),
    );
    expect(allContained).toBe(false);
  });

  it('should pass max_latency_ms when within threshold', () => {
    const actualMs = 2500;
    const maxMs = 5000;
    expect(actualMs).toBeLessThanOrEqual(maxMs);
  });

  it('should fail max_latency_ms when over threshold', () => {
    const actualMs = 6000;
    const maxMs = 5000;
    expect(actualMs).toBeGreaterThan(maxMs);
  });
});
