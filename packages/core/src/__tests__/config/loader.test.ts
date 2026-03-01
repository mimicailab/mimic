import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../config/loader.js';

describe('loadConfig', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `mimic-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should load a valid config file', async () => {
    const config = {
      domain: 'personal finance',
      personas: [
        { name: 'test-persona', description: 'A test persona' },
      ],
    };
    await writeFile(join(testDir, 'mimic.json'), JSON.stringify(config));

    const result = await loadConfig(testDir);
    expect(result.domain).toBe('personal finance');
    expect(result.personas).toHaveLength(1);
    expect(result.personas[0].name).toBe('test-persona');
  });

  it('should apply default values', async () => {
    const config = {
      domain: 'test',
      personas: [{ name: 'p', description: 'd' }],
    };
    await writeFile(join(testDir, 'mimic.json'), JSON.stringify(config));

    const result = await loadConfig(testDir);
    expect(result.llm.provider).toBe('anthropic');
    expect(result.llm.model).toBe('claude-haiku-4-5');
    expect(result.generate.volume).toBe('6 months');
    expect(result.generate.seed).toBe(42);
  });

  it('should resolve environment variables', async () => {
    process.env.TEST_MIMIC_URL = 'postgresql://localhost:5432/test';
    const config = {
      domain: 'test',
      personas: [{ name: 'p', description: 'd' }],
      databases: {
        primary: {
          type: 'postgres',
          url: '$TEST_MIMIC_URL',
        },
      },
    };
    await writeFile(join(testDir, 'mimic.json'), JSON.stringify(config));

    const result = await loadConfig(testDir);
    const primary = result.databases?.primary;
    expect(primary?.type).toBe('postgres');
    expect((primary as any).url).toBe('postgresql://localhost:5432/test');

    delete process.env.TEST_MIMIC_URL;
  });

  it('should throw ConfigNotFoundError when file does not exist', async () => {
    await expect(loadConfig(testDir)).rejects.toThrow('Configuration file not found');
  });

  it('should throw ConfigInvalidError for invalid JSON', async () => {
    await writeFile(join(testDir, 'mimic.json'), 'not json');
    await expect(loadConfig(testDir)).rejects.toThrow('Failed to parse');
  });

  it('should throw ConfigInvalidError for missing required fields', async () => {
    await writeFile(join(testDir, 'mimic.json'), '{}');
    await expect(loadConfig(testDir)).rejects.toThrow('Invalid mimic.json');
  });

  it('should throw for unset environment variables', async () => {
    const config = {
      domain: 'test',
      personas: [{ name: 'p', description: 'd' }],
      databases: {
        primary: {
          type: 'postgres',
          url: '$UNSET_VAR_FOR_MIMIC_TEST',
        },
      },
    };
    await writeFile(join(testDir, 'mimic.json'), JSON.stringify(config));
    await expect(loadConfig(testDir)).rejects.toThrow('UNSET_VAR_FOR_MIMIC_TEST');
  });

  it('should validate persona name format', async () => {
    const config = {
      domain: 'test',
      personas: [{ name: 'Invalid Name!', description: 'd' }],
    };
    await writeFile(join(testDir, 'mimic.json'), JSON.stringify(config));
    await expect(loadConfig(testDir)).rejects.toThrow('Invalid mimic.json');
  });
});
