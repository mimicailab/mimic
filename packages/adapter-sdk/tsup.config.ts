import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin/behavior-codegen.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  target: 'node22',
  outDir: 'dist',
  external: ['@mimicai/core', 'fastify'],
});
