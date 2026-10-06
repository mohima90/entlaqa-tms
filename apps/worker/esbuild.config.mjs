// Bundles the worker into one ES module (dist/main.mjs) for containers and scheduled runs: workspace
// packages export TypeScript sources, which Node does not run from node_modules. No minification, so
// stack traces stay readable; no source is shipped beyond the bundle.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22.18',
  format: 'esm',
  // CommonJS dependencies (pg) call require(); give the ES module bundle one.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  // `server-only` throws outside React Server Components; it marks server code, the worker is one.
  alias: {
    'server-only': fileURLToPath(
      new URL('../../packages/config/vitest/empty-module.js', import.meta.url),
    ),
  },
  // Never loaded: pg's optional native driver, and the TypeScript compiler that graphile-worker's
  // config-file loader (cosmiconfig) requires only for a `.ts` config file, which we do not use.
  external: ['pg-native', 'typescript'],
  legalComments: 'none',
  logLevel: 'warning',
});
