import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ClaudeSkillExporter } from '../../test/exporters/claude-skill.exporter.js';
import type { MimicScenario } from '../../types/fact-manifest.js';

function makeScenario(
  overrides: Partial<MimicScenario> & {
    name: string;
    platform: string;
    persona?: string;
  },
): MimicScenario {
  const { name, platform, persona = 'test-persona', ...rest } = overrides;
  return {
    name,
    tier: 'smoke',
    source_fact: `fact_${name}`,
    goal: `Goal for ${name}`,
    input: `Input for ${name}`,
    expect: {
      response_contains: ['foo'],
      response_excludes: [],
      max_latency_ms: 10_000,
    },
    metadata: {
      persona,
      platform,
      severity: 'info',
      generated: new Date().toISOString(),
    },
    ...rest,
  };
}

describe('ClaudeSkillExporter', () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'mimic-claude-skill-'));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it('writes SKILL.md under <outDir>/skills/mimic-eval/ and mimic-scenarios.json at the export root', async () => {
    const exporter = new ClaudeSkillExporter({ targetSkill: 'briefing-prep' });
    const scenarios = [makeScenario({ name: 's1', platform: 'attio' })];

    const files = await exporter.export(scenarios, outDir);

    expect(files).toHaveLength(2);
    expect(files).toContain(join(outDir, 'mimic-scenarios.json'));
    expect(files).toContain(join(outDir, 'skills', 'mimic-eval', 'SKILL.md'));

    const skillPath = files.find((p) => p.endsWith('SKILL.md'))!;
    const skillContent = await readFile(skillPath, 'utf-8');
    expect(skillContent.startsWith('---\nname: mimic-eval\n')).toBe(true);

    const scenariosPath = files.find((p) => p.endsWith('mimic-scenarios.json'))!;
    const scenariosContent = JSON.parse(await readFile(scenariosPath, 'utf-8'));
    expect(scenariosContent).toHaveLength(1);
    expect(scenariosContent[0].name).toBe('s1');
    expect(scenariosContent[0].metadata.source_fact).toBe('fact_s1');
  });

  it('substitutes the target skill name throughout the body', async () => {
    const exporter = new ClaudeSkillExporter({ targetSkill: 'revenue-recovery' });
    const scenarios = [makeScenario({ name: 's1', platform: 'stripe' })];

    const files = await exporter.export(scenarios, outDir);
    const skillPath = files.find((p) => p.endsWith('SKILL.md'))!;
    const content = await readFile(skillPath, 'utf-8');

    expect(content).toContain('default `revenue-recovery`');
    expect(content).toContain('skills/revenue-recovery/SKILL.md');
    expect(content).not.toContain('briefing-prep');
  });

  it('uses placeholder when target skill is omitted', async () => {
    const exporter = new ClaudeSkillExporter();
    const scenarios = [makeScenario({ name: 's1', platform: 'attio' })];

    const files = await exporter.export(scenarios, outDir);
    const skillPath = files.find((p) => p.endsWith('SKILL.md'))!;
    const content = await readFile(skillPath, 'utf-8');

    expect(content).toContain('<your-target-skill>');
  });

  it('derives MCP server list from union of scenario platforms', async () => {
    const exporter = new ClaudeSkillExporter({ targetSkill: 'briefing-prep' });
    const scenarios: MimicScenario[] = [
      makeScenario({ name: 's1', platform: 'attio' }),
      makeScenario({ name: 's2', platform: 'gmail' }),
      makeScenario({ name: 's3', platform: 'attio' }), // duplicate
      makeScenario({ name: 's4', platform: 'slack' }),
    ];

    const files = await exporter.export(scenarios, outDir);
    const skillPath = files.find((p) => p.endsWith('SKILL.md'))!;
    const content = await readFile(skillPath, 'utf-8');

    expect(content).toContain('`mimic-attio`');
    expect(content).toContain('`mimic-gmail`');
    expect(content).toContain('`mimic-slack`');

    // Each platform appears in the MCP-server list line exactly once.
    const mcpLineMatch = content.match(/MCP tools for (.+?) — fan out/);
    expect(mcpLineMatch).not.toBeNull();
    const mcpLine = mcpLineMatch![1]!;
    expect((mcpLine.match(/mimic-attio/g) ?? []).length).toBe(1);
  });

  it('emits a generic platform hint when scenarios have no platform', async () => {
    const exporter = new ClaudeSkillExporter({ targetSkill: 'briefing-prep' });
    const scenarios: MimicScenario[] = [
      {
        ...makeScenario({ name: 's1', platform: 'attio' }),
        metadata: {
          persona: 'test',
          platform: '',
          severity: 'info',
          generated: new Date().toISOString(),
        },
      },
    ];

    const files = await exporter.export(scenarios, outDir);
    const skillPath = files.find((p) => p.endsWith('SKILL.md'))!;
    const content = await readFile(skillPath, 'utf-8');

    expect(content).toContain('mimic-<platform>');
  });

  it('records persona and scenario count in the body', async () => {
    const exporter = new ClaudeSkillExporter({ targetSkill: 'briefing-prep' });
    const scenarios = [
      makeScenario({ name: 's1', platform: 'attio', persona: 'northwind-priya' }),
      makeScenario({ name: 's2', platform: 'gmail', persona: 'northwind-priya' }),
    ];

    const files = await exporter.export(scenarios, outDir);
    const skillPath = files.find((p) => p.endsWith('SKILL.md'))!;
    const content = await readFile(skillPath, 'utf-8');

    expect(content).toContain('`northwind-priya`');
    expect(content).toContain('Scenarios at generation time: 2');
  });
});
