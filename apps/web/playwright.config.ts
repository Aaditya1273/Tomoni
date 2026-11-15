import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs an isolated stack: its own database (tomoni_e2e), API on :4001, and a production
 * build of the web app on :3001. Nothing touches the dev servers or the dev database.
 */
const E2E_ENV = { TOMONI_DB_NAME: 'tomoni_e2e', NODE_ENV: 'test' };

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: 'http://localhost:3001', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @tomoni/api start',
      // Readiness without the DB: global setup (which creates tomoni_e2e) runs after servers start.
      url: 'http://127.0.0.1:4001/api/system/sandbox',
      env: {
        ...E2E_ENV,
        API_PORT: '4001',
        TOMONI_ALLOWED_ORIGINS: 'http://localhost:3001,http://localhost:3101',
        LOG_LEVEL: 'warn',
        TOMONI_LOGIN_LIMIT: '100',
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm next build && pnpm next start -p 3001',
      url: 'http://localhost:3001/login',
      env: { API_ORIGIN: 'http://127.0.0.1:4001' },
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      command:
        'pnpm --filter @tomoni/sponsor exec next build && pnpm --filter @tomoni/sponsor exec next start -p 3101',
      url: 'http://localhost:3101/login',
      env: { API_ORIGIN: 'http://127.0.0.1:4001' },
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
