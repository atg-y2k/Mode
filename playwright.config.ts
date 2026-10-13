import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Use a preinstalled Chromium when present (CI containers), else Playwright's own.
const LOCAL_CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const executablePath = existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined;
const PORT = Number(process.env.E2E_PORT ?? 5199);
const API_PORT = Number(process.env.E2E_API_PORT ?? 8787);
// Reuse servers that are already up, except in CI. Set E2E_FRESH=1 to insist
// on fresh ones (fails if the ports are taken), or move both with
// E2E_PORT / E2E_API_PORT. The tests check that the API they reach is the
// keyless one (tests/e2e/support.ts) — a dev server with keys is refused.
const reuseExistingServer = !process.env.CI && !process.env.E2E_FRESH;

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
  webServer: [
    {
      // The Mode API without any keys: Claude and the image APIs are off, so
      // plans come from the server's template and images go by hand-off —
      // the tests never depend on AI keys (or on the developer's .env).
      command: 'npx tsx server/index.ts',
      url: `http://localhost:${API_PORT}/api/health`,
      env: {
        PORT: String(API_PORT),
        MODE_AI: 'off',
        IMAGE_PROVIDER: 'none',
        ANTHROPIC_API_KEY: '',
        OPENAI_API_KEY: '',
        GEMINI_API_KEY: '',
        MODE_ACCESS_TOKEN: '',
      },
      reuseExistingServer,
      timeout: 60_000,
    },
    {
      // Vite proxies /api to the server above.
      command: `npx vite --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      env: { API_PORT: String(API_PORT) },
      reuseExistingServer,
      timeout: 60_000,
    },
  ],
  projects: [
    {
      name: 'desktop',
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.ts/,
      // A 390 px phone (iPhone 12–15 width) on Chromium, with touch.
      use: { ...devices['Pixel 7'], browserName: 'chromium', viewport: { width: 390, height: 844 } },
    },
  ],
});
