import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Use a preinstalled Chromium when present (CI containers), else Playwright's own.
const LOCAL_CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const executablePath = existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined;
const PORT = Number(process.env.E2E_PORT ?? 5199);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { executablePath },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    // The UI works without the API server (AI features show as disabled).
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
  ],
});
