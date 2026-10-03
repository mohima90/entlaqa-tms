import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.STORYBOOK_PORT ?? 6007);
const executablePath = process.env.PW_CHROMIUM_EXECUTABLE?.trim()
  ? process.env.PW_CHROMIUM_EXECUTABLE
  : undefined;

/** Accessibility + direction gate for every Storybook story (T-M1-A02). Run after `build-storybook`. */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: `node e2e/serve-static.mjs storybook-static`,
    url: `http://127.0.0.1:${PORT}/index.json`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { PORT: String(PORT) },
  },
});
