import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Blueprint } from '@mimicai/core';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Registry of built-in blueprints.  Keys use the format `domain/persona-id`
 * and map to the JSON filename within that domain subdirectory.
 */
const BUILTIN_REGISTRY: Record<string, { domain: string; file: string; description: string }> = {
  'finance/young-professional': {
    domain: 'finance',
    file: 'young-professional.json',
    description: 'Maya Chen — 28yo product designer, Austin TX, $95K salary',
  },
  'finance/freelancer': {
    domain: 'finance',
    file: 'freelancer.json',
    description: 'Alex Rivera — 34yo freelance web developer, Portland OR, ~$85K variable',
  },
  'finance/college-student': {
    domain: 'finance',
    file: 'college-student.json',
    description: 'Jordan Park — 21yo CS student & part-time barista, Austin TX, ~$18K',
  },
  'finance/retiree': {
    domain: 'finance',
    file: 'retiree.json',
    description: 'Robert Williams — 65yo retired teacher, Mesa AZ, pension + SS ~$42K',
  },
  'calendar/busy-family': {
    domain: 'calendar',
    file: 'busy-family.json',
    description: 'Sarah & Mike Thompson — dual-income family, 2 kids, Denver CO, packed schedule',
  },
  'calendar/solo-professional': {
    domain: 'calendar',
    file: 'solo-professional.json',
    description: 'David Kim — 31yo software architect, San Francisco CA, heavy work + fitness calendar',
  },
  'support/frustrated-customer': {
    domain: 'support',
    file: 'frustrated-customer.json',
    description: 'Karen Mitchell — 42yo, recurring billing issues, escalation-prone',
  },
  'support/enterprise-admin': {
    domain: 'support',
    file: 'enterprise-admin.json',
    description: 'James Okafor — IT admin at 500-person company, API/SSO issues, technical',
  },
};

/**
 * The prefix used in mimic.json to reference built-in blueprints.
 * Example: "builtin:finance/young-professional"
 */
const BUILTIN_PREFIX = 'builtin:';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load a blueprint by its reference string.
 *
 * Accepts either:
 *   - A `builtin:domain/persona-id` reference (e.g. `"builtin:finance/young-professional"`)
 *   - A bare registry key (e.g. `"finance/young-professional"`)
 *
 * @throws Error if the blueprint reference is unknown or the file cannot be read.
 */
export async function loadBlueprint(ref: string): Promise<Blueprint> {
  const key = ref.startsWith(BUILTIN_PREFIX)
    ? ref.slice(BUILTIN_PREFIX.length)
    : ref;

  const entry = BUILTIN_REGISTRY[key];
  if (!entry) {
    throw new Error(
      `Unknown built-in blueprint: "${ref}". ` +
        `Available: ${Object.keys(BUILTIN_REGISTRY).join(', ')}`,
    );
  }

  const filePath = join(__dirname, entry.domain, entry.file);

  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as Blueprint;
  } catch (err) {
    throw new Error(
      `Failed to load built-in blueprint "${ref}" from ${filePath}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}

/**
 * List all available built-in blueprints with their metadata.
 */
export function listBuiltinBlueprints(): {
  id: string;
  domain: string;
  description: string;
}[] {
  return Object.entries(BUILTIN_REGISTRY).map(([id, entry]) => ({
    id,
    domain: entry.domain,
    description: entry.description,
  }));
}

/**
 * Check whether a blueprint reference points to a built-in blueprint.
 *
 * Returns `true` for:
 *   - `"builtin:finance/young-professional"`
 *   - `"finance/young-professional"`
 */
export function isBuiltinBlueprint(ref: string): boolean {
  const key = ref.startsWith(BUILTIN_PREFIX)
    ? ref.slice(BUILTIN_PREFIX.length)
    : ref;

  return key in BUILTIN_REGISTRY;
}
