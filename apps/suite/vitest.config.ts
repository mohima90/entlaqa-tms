import { defineJadaratVitestConfig } from '@jadarat/config/vitest';
import { defineConfig } from 'vitest/config';

const base = defineJadaratVitestConfig({
  // Pages/layouts are covered by Playwright E2E (Arabic + English); unit coverage targets lib/ + proxy.
  coverageInclude: ['src/lib/**/*.ts', 'src/proxy.ts'],
  coverageExclude: ['src/lib/config-status.ts'],
});

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    exclude: [...base.test.exclude, 'e2e/**'],
    // next-intl's ESM build imports `next/server` without an extension; let Vite resolve it.
    server: { deps: { inline: ['next-intl'] } },
  },
});
