import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  // Aliases `wxt/browser` to an in-memory fake, so tests never touch a real browser or network.
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.ts'],
    restoreMocks: true,
  },
});
