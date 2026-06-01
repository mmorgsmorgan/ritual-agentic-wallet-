import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/mcp/index.ts'],
  outDir: 'dist/mcp',
  format: ['esm'],
  target: 'node18',
  platform: 'node',
  // Don't bundle deps — the workspace + npm link handle resolution.
  // Bundling would inline @ritkey/sdk and @modelcontextprotocol/sdk needlessly.
  external: ['@ritkey/sdk', '@modelcontextprotocol/sdk', 'zod'],
  clean: true,
  dts: false,
  splitting: false,
  sourcemap: true,
  // Esbuild does syntax transpilation only — no type checking. Run `tsc --noEmit`
  // separately for type checking if needed.
});
