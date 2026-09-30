import { defineJadaratVitestConfig } from '@jadarat/config/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig(
  defineJadaratVitestConfig({
    // Thin factories over third-party clients; exercised by integration tests and the walking skeleton.
    coverageExclude: ['src/schema/**'],
  }),
);
