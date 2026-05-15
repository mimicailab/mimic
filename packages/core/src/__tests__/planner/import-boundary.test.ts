/**
 * Phase 13 — Planner ↔ projection import-boundary lint.
 *
 * The V5 design's Phase 6 guardrail (confirmed in chat as a hard
 * requirement): no code under `planner/` may import
 *
 *   - anything under `projection/`
 *   - any adapter manifest from `@mimicai/adapter-*`
 *   - the `ProjectorHints` symbol or registry
 *
 * The dependency direction is strictly one-way: planner → canonical
 * identity, projector → formatted identity. This test scans every file
 * under `packages/core/src/planner/` and asserts no forbidden import
 * string appears.
 *
 * If a future change needs cross-boundary types, prefer:
 *   - widening a type in `world/entity.ts` (planners own canonical types)
 *   - publishing a hint via `registerProjectorHints` in adapter init code
 */
import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PLANNER_DIR = resolve(here, '../../planner');

async function listTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await listTsFiles(full)));
    } else if (e.isFile() && full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const FORBIDDEN_PATTERNS: RegExp[] = [
  /from\s+['"][^'"]*\/projection\/[^'"]*['"]/,
  /from\s+['"]@mimicai\/adapter-[^'"]+['"]/,
  /from\s+['"][^'"]*projector-hints[^'"]*['"]/,
  /\bProjectorHints\b/,
  /\bgetProjectorHints\b/,
  /\bregisterProjectorHints\b/,
];

describe('planner ↔ projection import boundary (Phase 13 lint)', () => {
  it('no file under planner/ imports from projection/, adapters, or ProjectorHints', async () => {
    const files = await listTsFiles(PLANNER_DIR);
    expect(files.length).toBeGreaterThan(0);

    const violations: Array<{ file: string; pattern: string; line: string }> = [];
    for (const file of files) {
      const src = await readFile(file, 'utf8');
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // Skip comment lines so the doc-comment that DESCRIBES the
        // boundary doesn't trip the lint.
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
        for (const pat of FORBIDDEN_PATTERNS) {
          if (pat.test(line)) {
            violations.push({ file, pattern: String(pat), line: `${i + 1}: ${line.trim()}` });
          }
        }
      }
    }

    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}\n    ${v.pattern}\n    ${v.line}`)
        .join('\n');
      throw new Error(
        `Planner ↔ projection import boundary violated:\n${msg}\n\n` +
          'Phase 6 invariant: planner/ must not import from projection/, adapter packages, or ProjectorHints. ' +
          'The dependency is one-way: planner → canonical identity, projector → formatted identity.',
      );
    }
    expect(violations).toEqual([]);
  });

  it('induced-failure check: a planted forbidden import would trip the lint', async () => {
    // Fixture: prove the lint actually catches a violation by running it
    // against a synthetic source string instead of disk files.
    const synthetic = `
import { runProjection } from '../projection/projection-planner.js';
export function bad() { runProjection(); }
`;
    let caught = false;
    for (const pat of FORBIDDEN_PATTERNS) {
      if (pat.test(synthetic)) {
        caught = true;
        break;
      }
    }
    expect(caught).toBe(true);
  });
});
