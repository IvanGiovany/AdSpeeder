import { defineConfig } from '@playwright/test';

// Extension e2e against local fixtures only (§5 Phase 3); specs land in tests/e2e.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
});
