import { defineJadaratVitestConfig } from '@jadarat/config/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig(
  defineJadaratVitestConfig({
    // next.ts / auth-next.ts only adapt next/headers cookies and platform-db to the tested functions
    // (verify-claims.ts, auth-flow.ts); exercised end-to-end on staging.
    coverageExclude: ['src/next.ts', 'src/auth-next.ts'],
  }),
);
