import { defineJadaratVitestConfig } from '@jadarat/config/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig(
  defineJadaratVitestConfig({
    // next.ts only adapts next/headers cookies and platform-db to the tested request-path functions.
    coverageExclude: ['src/next.ts'],
  }),
);
