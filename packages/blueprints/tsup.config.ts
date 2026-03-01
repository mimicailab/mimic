import { defineConfig } from 'tsup';
import { cp } from 'node:fs/promises';
import { resolve } from 'node:path';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  target: 'node22',
  outDir: 'dist',
  async onSuccess() {
    // Copy blueprint JSON files into dist/ so they sit alongside index.js
    // and can be resolved via __dirname at runtime.
    await cp(
      resolve('src', 'finance'),
      resolve('dist', 'finance'),
      { recursive: true },
    );
    await cp(
      resolve('src', 'calendar'),
      resolve('dist', 'calendar'),
      { recursive: true },
    );
    await cp(
      resolve('src', 'support'),
      resolve('dist', 'support'),
      { recursive: true },
    );
  },
});
