import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import type { ScenarioExporter } from './exporter.interface.js';
import type { MimicScenario } from '../../types/fact-manifest.js';

/**
 * Exports MimicScenarios to Mimic's own test scenario format.
 *
 * Output is a JSON array matching the `test.scenarios` shape in mimic.json,
 * ready to be merged into the config or loaded as a standalone scenario file.
 */
export class MimicExporter implements ScenarioExporter {
  readonly format = 'mimic';

  async export(
    scenarios: MimicScenario[],
    outputDir: string,
  ): Promise<string[]> {
    await mkdir(outputDir, { recursive: true });

    const mimicScenarios = scenarios.map((s) => ({
      name: s.name,
      persona: s.metadata.persona,
      goal: s.goal,
      input: s.input,
      expect: {
        response_contains: s.expect.response_contains,
        ...(s.expect.response_excludes.length > 0 && {
          response_excludes: s.expect.response_excludes,
        }),
        ...(s.expect.numeric_range && {
          numeric_range: s.expect.numeric_range,
        }),
        max_latency_ms: s.expect.max_latency_ms,
      },
      metadata: {
        tier: s.tier,
        source_fact: s.source_fact,
        platform: s.metadata.platform,
      },
    }));

    const outPath = join(outputDir, 'mimic-scenarios.json');
    await writeFile(outPath, JSON.stringify(mimicScenarios, null, 2), 'utf-8');
    return [outPath];
  }
}
