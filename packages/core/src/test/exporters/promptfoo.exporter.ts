import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import type { ScenarioExporter } from './exporter.interface.js';
import type { MimicScenario } from '../../types/fact-manifest.js';

/**
 * Exports MimicScenarios to PromptFoo's YAML config format.
 *
 * PromptFoo uses a `tests:` array with `vars`, `assert` blocks with built-in
 * assertion types (`contains`, `not-contains`, `javascript`, `llm-rubric`).
 */
export class PromptFooExporter implements ScenarioExporter {
  readonly format = 'promptfoo';

  constructor(private readonly agentUrl?: string) {}

  async export(
    scenarios: MimicScenario[],
    outputDir: string,
  ): Promise<string[]> {
    await mkdir(outputDir, { recursive: true });

    const tests = scenarios.map((s) => this.scenarioToTest(s));
    const url = this.agentUrl ?? 'http://localhost:3003/test';

    const yaml = [
      `description: "Mimic auto-generated scenarios"`,
      ``,
      `providers:`,
      `  - id: http`,
      `    config:`,
      `      url: ${url}`,
      `      method: POST`,
      `      body:`,
      `        input: "{{question}}"`,
      ``,
      `prompts:`,
      `  - "{{question}}"`,
      ``,
      `tests:`,
      ...tests,
    ].join('\n');

    const outPath = join(outputDir, 'promptfooconfig.yaml');
    await writeFile(outPath, yaml, 'utf-8');
    return [outPath];
  }

  private scenarioToTest(s: MimicScenario): string {
    const lines: string[] = [];
    lines.push(`  - description: "${s.name} [${s.tier}]"`);
    lines.push(`    vars:`);
    lines.push(`      question: ${yamlString(s.input)}`);
    lines.push(`    assert:`);

    for (const term of s.expect.response_contains) {
      lines.push(`      - type: contains`);
      lines.push(`        value: ${yamlString(term)}`);
    }

    for (const term of s.expect.response_excludes) {
      lines.push(`      - type: not-contains`);
      lines.push(`        value: ${yamlString(term)}`);
    }

    if (s.expect.numeric_range) {
      const { min, max } = s.expect.numeric_range;
      lines.push(`      - type: javascript`);
      lines.push(`        value: |`);
      lines.push(`          const nums = output.match(/[\\d,]+\\.?\\d*/g) || [];`);
      lines.push(`          return nums.some(n => {`);
      lines.push(`            const v = parseFloat(n.replace(/,/g, ''));`);
      lines.push(`            return v >= ${min} && v <= ${max};`);
      lines.push(`          });`);
    }

    lines.push(`    metadata:`);
    lines.push(`      tier: ${s.tier}`);
    lines.push(`      source_fact: ${s.source_fact}`);
    lines.push(`      platform: ${s.metadata.platform}`);

    return lines.join('\n');
  }
}

/** Safely quote a string for YAML output */
function yamlString(s: string): string {
  if (s.includes('"') || s.includes('\n') || s.includes(':') || s.includes('#')) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return `"${s}"`;
}
