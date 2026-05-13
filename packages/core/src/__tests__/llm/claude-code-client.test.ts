import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { ClaudeCodeClient } from '../../llm/claude-code-client.js';
import { CostTracker } from '../../llm/cost-tracker.js';

// Stub the Claude Agent SDK so tests don't need it installed or hit the network.
// Each test resets `responses` to control what the fake SDK emits per call.
let responses: Array<string | { error: string }> = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  const query = () => {
    const next = responses.shift();
    if (!next) throw new Error('no stubbed response queued');
    async function* stream() {
      if (typeof next === 'object' && 'error' in next) {
        yield { type: 'result', subtype: 'error', usage: { input_tokens: 10, output_tokens: 0 } };
        return;
      }
      // Emit one assistant text block, then the success result with usage.
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: next as string }] },
      };
      yield {
        type: 'result',
        subtype: 'success',
        result: next as string,
        usage: { input_tokens: 42, output_tokens: 7 },
      };
    }
    return stream();
  };
  return { query };
});

beforeEach(() => {
  responses = [];
});

describe('ClaudeCodeClient.generateObject', () => {
  const schema = z.object({
    name: z.string(),
    age: z.number(),
  });

  it('parses a plain JSON response on first try', async () => {
    responses = ['{"name":"alice","age":30}'];
    const tracker = new CostTracker();
    const client = new ClaudeCodeClient({ model: 'claude-opus-4-7' }, tracker);

    const result = await client.generateObject({
      schema,
      prompt: 'make a person',
      label: 'mk',
    });

    expect(result.object).toEqual({ name: 'alice', age: 30 });
    expect(result.promptTokens).toBe(42);
    expect(result.completionTokens).toBe(7);
    const entries = tracker.getSummary().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.runtime).toBe('claude-code');
    expect(entries[0]!.cost).toBe(0);
  });

  it('strips ```json fences when the agent ignores instructions', async () => {
    responses = ['```json\n{"name":"bob","age":25}\n```'];
    const tracker = new CostTracker();
    const client = new ClaudeCodeClient({ model: 'claude-opus-4-7' }, tracker);

    const result = await client.generateObject({
      schema,
      prompt: 'make a person',
      label: 'mk',
    });

    expect(result.object).toEqual({ name: 'bob', age: 25 });
  });

  it('extracts JSON from prose when the agent adds an explanation', async () => {
    responses = ['Sure! Here you go: {"name":"carol","age":40} — let me know if you need more.'];
    const tracker = new CostTracker();
    const client = new ClaudeCodeClient({ model: 'claude-opus-4-7' }, tracker);

    const result = await client.generateObject({
      schema,
      prompt: 'make a person',
      label: 'mk',
    });

    expect(result.object).toEqual({ name: 'carol', age: 40 });
  });

  it('retries on Zod failure with a repair prompt then succeeds', async () => {
    responses = [
      '{"name":"dave"}', // missing `age` — Zod will reject
      '{"name":"dave","age":50}',
    ];
    const tracker = new CostTracker();
    const client = new ClaudeCodeClient({ model: 'claude-opus-4-7' }, tracker);

    const result = await client.generateObject({
      schema,
      prompt: 'make a person',
      label: 'mk',
    });

    expect(result.object).toEqual({ name: 'dave', age: 50 });
    // Two attempts recorded, both tagged claude-code, both cost 0.
    const entries = tracker.getSummary().entries;
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.label)).toEqual(['mk', 'mk:repair-1']);
    expect(entries.every((e) => e.runtime === 'claude-code')).toBe(true);
  });

  it('throws after exhausting repair budget', async () => {
    responses = [
      '{"name":"eve"}',
      '{"name":"eve"}',
      '{"name":"eve"}',
    ];
    const tracker = new CostTracker();
    const client = new ClaudeCodeClient({ model: 'claude-opus-4-7', maxRetries: 2 }, tracker);

    await expect(
      client.generateObject({ schema, prompt: 'p', label: 'mk' }),
    ).rejects.toThrow(/did not match schema/);

    // All 3 attempts should still be recorded for cost transparency.
    expect(tracker.getSummary().entries).toHaveLength(3);
  });
});

describe('ClaudeCodeClient.generateText', () => {
  it('returns the assistant text and tracks tokens under claude-code runtime', async () => {
    responses = ['hello world'];
    const tracker = new CostTracker();
    const client = new ClaudeCodeClient({ model: 'claude-opus-4-7' }, tracker);

    const result = await client.generateText({ prompt: 'say hi', label: 'hi' });

    expect(result.text).toBe('hello world');
    expect(result.promptTokens).toBe(42);
    const entries = tracker.getSummary().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.runtime).toBe('claude-code');
  });
});
