import { defineConfig } from 'vitest/config';

// Tests for the repository gate scripts (migration naming, server actions, RTL, licences).
export default defineConfig({
  test: {
    root: new URL('.', import.meta.url).pathname,
    include: ['**/*.test.mjs'],
    exclude: ['**/node_modules/**', '__fixtures__/**'],
  },
});
