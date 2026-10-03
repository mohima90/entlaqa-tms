import { fileURLToPath } from 'node:url';

const emptyModule = fileURLToPath(new URL('./empty-module.js', import.meta.url));

/**
 * Shared Vitest configuration for workspace packages.
 * Coverage threshold: Development Plan §5.1 (>= 80% line coverage for packages/* and domain code).
 * @param {{ coverageInclude?: string[], coverageExclude?: string[], thresholds?: Record<string, number>, environment?: string }} [options]
 */
export function defineJadaratVitestConfig(options = {}) {
  const thresholds = {
    lines: 80,
    statements: 80,
    functions: 80,
    branches: 75,
    ...options.thresholds,
  };
  return {
    resolve: {
      alias: { 'server-only': emptyModule },
    },
    test: {
      environment: options.environment ?? 'node',
      include: ['src/**/*.test.{ts,tsx}'],
      exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
      passWithNoTests: false,
      coverage: {
        provider: 'v8',
        reporter: ['text-summary', 'lcov', 'json-summary'],
        include: options.coverageInclude ?? ['src/**/*.{ts,tsx}'],
        // Stories are documentation, verified by the Storybook gate (axe in RTL/LTR, light/dark), not unit tests.
        exclude: [
          'src/**/*.test.{ts,tsx}',
          'src/**/*.stories.{ts,tsx}',
          'src/**/*.d.ts',
          ...(options.coverageExclude ?? []),
        ],
        thresholds,
      },
    },
  };
}

/** Integration tests (real PostgreSQL via TEST_DATABASE_URL); run by `pnpm test:integration` and the CI db job. */
export function defineJadaratIntegrationConfig() {
  return {
    resolve: { alias: { 'server-only': emptyModule } },
    test: {
      environment: 'node',
      include: ['src/**/*.integration.test.ts'],
      passWithNoTests: true,
      testTimeout: 30_000,
    },
  };
}
