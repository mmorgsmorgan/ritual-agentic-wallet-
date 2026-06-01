import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node18',
  platform: 'node',
  external: ['@ritkey/sdk', 'commander'],
  clean: true,
  dts: false,
  splitting: false,
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
});
