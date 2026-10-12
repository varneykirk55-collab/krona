import { defineConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';
const browser = JSON.parse(readFileSync('.data/browser-config.json', 'utf8'));
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  reporter: [['list'], ['json', { outputFile: '.data/e2e-results.json' }]],
  use: {
    baseURL: 'http://localhost:8081',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    browserName: 'chromium',
    launchOptions: {
      executablePath: browser.executablePath,
      args: browser.args,
      env: { ...process.env, LD_LIBRARY_PATH: browser.libPath } as Record<string, string>,
    },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: 'iphone-16-pro-sized',
      use: {
        viewport: { width: 402, height: 874 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: 'npx tsx tests/e2e/server.ts',
    url: 'http://localhost:8081/healthz',
    reuseExistingServer: false,
    timeout: 45000,
  },
});
