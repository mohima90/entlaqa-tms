import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;
// Local sandboxes may provide a pre-installed Chromium; CI installs the matching browser.
const executablePath = process.env.PW_CHROMIUM_EXECUTABLE?.trim()
  ? process.env.PW_CHROMIUM_EXECUTABLE
  : undefined;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // No retries, in CI either: a test that only passes on retry is flaky and must be fixed or
  // quarantined with an owner (CLAUDE.md quality gates), not hidden.
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
  ],
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          // Runs the production standalone build (same artifact as containers/Vercel).
          command: 'node .next/standalone/apps/suite/server.js',
          url: `${baseURL}/ar`,
          reuseExistingServer: false,
          timeout: 60_000,
          env: { PORT: String(PORT), HOSTNAME: '127.0.0.1', NODE_ENV: 'production' },
        },
      }),
});
