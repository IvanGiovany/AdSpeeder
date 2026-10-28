import { defineConfig } from '@playwright/test';

// Extension e2e against local fixtures only (§5 Phase 3). Needs `npm run build:chrome` first;
// tests/e2e/harness.ts loads .output/chrome-mv3 and blocks every real network request.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
});
