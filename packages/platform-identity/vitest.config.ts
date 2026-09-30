import { defineJadaratVitestConfig } from '@jadarat/config/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig(
  defineJadaratVitestConfig({
    // next.ts only adapts next/headers cookies to verifyClaims(); covered by E2E once auth is wired (T-M1-D03).
    coverageExclude: ['src/next.ts'],
  }),
);
