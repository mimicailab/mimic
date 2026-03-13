import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'bin/mimic.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  splitting: false,
  sourcemap: true,
  target: 'node22',
  outDir: 'dist',
  external: ['pg', '@mimicai/explorer', /^@mimicai\/adapter-/],
  banner: {
    js: '',
  },
});
