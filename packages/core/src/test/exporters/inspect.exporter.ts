import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import type { ScenarioExporter } from './exporter.interface.js';
import type { MimicScenario } from '../../types/fact-manifest.js';

/**
 * Exports MimicScenarios to UK AISI Inspect format —
 * a self-contained Python task file with dataset + scorer.
 */
export class InspectExporter implements ScenarioExporter {
  readonly format = 'inspect';

  async export(
    scenarios: MimicScenario[],
    outputDir: string,
  ): Promise<string[]> {
    await mkdir(outputDir, { recursive: true });

    const persona = scenarios[0]?.metadata.persona ?? 'default';
    const funcName = `mimic_${persona.replace(/[^a-z0-9]/gi, '_')}`;

    const samples = scenarios
      .map((s) => {
        const target = {
          must_contain: s.expect.response_contains,
          must_exclude: s.expect.response_excludes,
          ...(s.expect.numeric_range
            ? { numeric_range: s.expect.numeric_range }
            : {}),
        };
        return [
          `        Sample(`,
          `            input=${pyString(s.input)},`,
          `            target=${pyDict(target)},`,
          `            metadata=${pyDict({ tier: s.tier, source_fact: s.source_fact, platform: s.metadata.platform })},`,
          `        ),`,
        ].join('\n');
      })
      .join('\n');

    const python = `from inspect_ai import Task, task
from inspect_ai.dataset import Dataset, Sample
from inspect_ai.scorer import Score, Scorer, scorer, accuracy
from inspect_ai.solver import generate


@task
def ${funcName}() -> Task:
    return Task(
        dataset=mimic_dataset(),
        plan=[generate()],
        scorer=mimic_scorer(),
    )


def mimic_dataset() -> Dataset:
    return Dataset(samples=[
${samples}
    ])


@scorer(metrics=[accuracy()])
def mimic_scorer() -> Scorer:
    async def score(state, target) -> Score:
        output = state.output.completion.lower()
        must_contain = target.text.get("must_contain", [])
        must_exclude = target.text.get("must_exclude", [])

        missing = [t for t in must_contain if t.lower() not in output]
        hallucinated = [t for t in must_exclude if t.lower() in output]
        passed = not missing and not hallucinated

        return Score(
            value=1.0 if passed else 0.0,
            explanation=f"Missing: {missing} | Hallucinated: {hallucinated}"
            if not passed
            else "All assertions passed",
        )

    return score
`;

    const outPath = join(outputDir, 'inspect_task.py');
    await writeFile(outPath, python, 'utf-8');
    return [outPath];
  }
}

/** Convert a JS string to a Python string literal */
function pyString(s: string): string {
  const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/** Convert a plain JS object to a Python dict literal */
function pyDict(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj).map(([k, v]) => {
    const key = `"${k}"`;
    if (Array.isArray(v)) {
      const items = v.map((item) =>
        typeof item === 'string' ? pyString(item) : String(item),
      );
      return `${key}: [${items.join(', ')}]`;
    }
    if (typeof v === 'object' && v !== null) {
      return `${key}: ${pyDict(v as Record<string, unknown>)}`;
    }
    if (typeof v === 'string') return `${key}: ${pyString(v)}`;
    return `${key}: ${String(v)}`;
  });
  return `{${entries.join(', ')}}`;
}
