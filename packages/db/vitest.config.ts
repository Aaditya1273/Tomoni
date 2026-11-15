import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    env: { TOMONI_DB_NAME: 'tomoni_test_db', NODE_ENV: 'test' },
    fileParallelism: false,
    hookTimeout: 60_000,
  },
});
