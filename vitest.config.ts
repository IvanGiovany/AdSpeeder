import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  // Aliases `wxt/browser` to an in-memory fake, so tests never touch a real browser or network.
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/shared/**'],
      reporter: ['text', 'json-summary'],
      // Phase 2 "Done when": core coverage ≥ 90% lines.
      thresholds: { 'src/core/**': { lines: 90 } },
    },
  },
});
