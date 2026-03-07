import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import type { ScenarioExporter } from './exporter.interface.js';
import type { MimicScenario } from '../../types/fact-manifest.js';

/**
 * Exports MimicScenarios to Braintrust's JSONL dataset format + a starter scorer file.
 */
export class BraintrustExporter implements ScenarioExporter {
  readonly format = 'braintrust';

  async export(
    scenarios: MimicScenario[],
    outputDir: string,
  ): Promise<string[]> {
    await mkdir(outputDir, { recursive: true });
    const files: string[] = [];

    // Dataset (JSONL)
    const datasetLines = scenarios.map((s) =>
      JSON.stringify({
        input: { question: s.input },
        expected: {
          must_contain: s.expect.response_contains,
          must_exclude: s.expect.response_excludes,
          ...(s.expect.numeric_range
            ? { numeric_range: s.expect.numeric_range }
            : {}),
        },
        metadata: {
          tier: s.tier,
          source_fact: s.source_fact,
          platform: s.metadata.platform,
          name: s.name,
        },
      }),
    );

    const datasetPath = join(outputDir, 'braintrust-dataset.jsonl');
    await writeFile(datasetPath, datasetLines.join('\n') + '\n', 'utf-8');
    files.push(datasetPath);

    // Starter scorer
    const scorerPath = join(outputDir, 'braintrust-scorer.ts');
    await writeFile(scorerPath, SCORER_TEMPLATE, 'utf-8');
    files.push(scorerPath);

    return files;
  }
}

const SCORER_TEMPLATE = `import { Score } from "braintrust";

export function mimicScorer(args: {
  input: { question: string };
  output: string;
  expected: { must_contain: string[]; must_exclude: string[] };
}): Score {
  const { output, expected } = args;
  const lower = output.toLowerCase();

  const containsPassed = expected.must_contain.every((term) =>
    lower.includes(term.toLowerCase())
  );
  const excludesPassed = expected.must_exclude.every(
    (term) => !lower.includes(term.toLowerCase())
  );

  return {
    name: "mimic",
    score: containsPassed && excludesPassed ? 1 : 0,
    metadata: {
      missing: expected.must_contain.filter(
        (t) => !lower.includes(t.toLowerCase())
      ),
      hallucinated: expected.must_exclude.filter((t) =>
        lower.includes(t.toLowerCase())
      ),
    },
  };
}
`;
