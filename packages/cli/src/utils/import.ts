import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * Dynamically import a package from a project's node_modules.
 *
 * Handles the CJS/ESM interop issue where `createRequire.resolve()` returns
 * a `.cjs` path but `import()` needs the ESM `.js` entry. Works for both
 * local monorepo symlinks and real npm installs.
 *
 * @param pkg  - Package specifier (e.g. `@mimicai/adapter-stripe`)
 * @param cwd  - Project directory that has the package installed
 */
export async function importFromProject(
  pkg: string,
  cwd: string,
): Promise<Record<string, unknown>> {
  // 1. Try bare specifier — works when the package is resolvable from the
  //    calling context (e.g. same node_modules tree).
  try {
    return await import(/* @vite-ignore */ pkg);
  } catch {
    // fall through
  }

  // 2. Resolve from the project's node_modules using createRequire, then
  //    swap .cjs → .js so we load the ESM entry. Dynamic import() of CJS
  //    bundles can fail due to missing path context in ESM/CJS interop.
  const req = createRequire(join(cwd, 'package.json'));
  let resolved = req.resolve(pkg);
  if (resolved.endsWith('.cjs')) {
    resolved = resolved.replace(/\.cjs$/, '.js');
  }
  return await import(/* @vite-ignore */ resolved);
}

/**
 * Walk up the directory tree from `startPath` to find a node_modules that
 * can resolve `pkg`. Useful in pnpm workspaces where the adapter symlink
 * lives in the monorepo root.
 */
export async function importFromAncestors(
  pkg: string,
  startPath: string,
): Promise<Record<string, unknown>> {
  let dir = join(startPath, '..');
  for (let i = 0; i < 10; i++) {
    try {
      return await importFromProject(pkg, dir);
    } catch {
      const parent = join(dir, '..');
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(`Cannot find ${pkg}`);
}
