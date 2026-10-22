import { defineConfig } from '@playwright/test';

const port = Number(process.env.PORT) || 4173;

// Browser smoke tests run against a production build in _site/.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${port}`,
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
  },
  webServer: {
    command: 'node tests/serve.js',
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI
  }
});
