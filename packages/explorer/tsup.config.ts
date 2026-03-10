import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['server/index.ts'],
  format: ['esm'],
  outDir: 'dist/server',
  dts: true,
  clean: false,
  target: 'node22',
  external: ['@mimicai/core', 'fastify', '@fastify/static', '@fastify/cors'],
});
