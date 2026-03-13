import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type PackageManager = 'pnpm' | 'yarn' | 'npm' | 'bun';

/**
 * Detect the package manager used in the project.
 *
 * Detection order:
 * 1. Lock file presence (most reliable)
 * 2. `packageManager` field in root package.json
 * 3. Falls back to npm
 */
export function detectPackageManager(cwd: string = process.cwd()): PackageManager {
  // Check cwd and ancestors so nested projects (e.g. examples/* in a monorepo)
  // can inherit the workspace package manager from the repo root.
  let dir = cwd;
  while (true) {
    // 1) Lock files (most reliable)
    if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
    if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock'))) return 'bun';
    if (existsSync(join(dir, 'package-lock.json'))) return 'npm';

    // 2) packageManager field in package.json
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
      const pm = pkg.packageManager as string | undefined;
      if (pm) {
        if (pm.startsWith('pnpm')) return 'pnpm';
        if (pm.startsWith('yarn')) return 'yarn';
        if (pm.startsWith('bun')) return 'bun';
        if (pm.startsWith('npm')) return 'npm';
      }
    } catch {
      // No package.json or unreadable — keep walking up
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return 'npm';
}

/** Get the install command for a package. */
export function installCmd(pm: PackageManager, pkg: string): string {
  switch (pm) {
    case 'pnpm': return `pnpm add ${pkg}`;
    case 'yarn': return `yarn add ${pkg}`;
    case 'bun': return `bun add ${pkg}`;
    case 'npm': return `npm install ${pkg}`;
  }
}

/** Get the uninstall command for a package. */
export function uninstallCmd(pm: PackageManager, pkg: string): string {
  switch (pm) {
    case 'pnpm': return `pnpm remove ${pkg}`;
    case 'yarn': return `yarn remove ${pkg}`;
    case 'bun': return `bun remove ${pkg}`;
    case 'npm': return `npm uninstall ${pkg}`;
  }
}
