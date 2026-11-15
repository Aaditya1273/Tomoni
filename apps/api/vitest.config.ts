import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    env: {
      TOMONI_DB_NAME: 'tomoni_test_api',
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      TOMONI_QUEUE_PREFIX: 'test-api',
      TOMONI_TODAY: '2026-11-15',
    },
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
