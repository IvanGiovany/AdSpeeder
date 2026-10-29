/** @vitest-environment-options {"url":"https://www.netflix.com/watch/123"} */
import { afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { NetflixAdapter } from '../../src/platforms/netflix/NetflixAdapter';
import { defaultSettings } from '../../src/shared/settings';
import { silentLogger } from './helpers/logger';
const lifetimes: AbortController[] = [];
afterEach(() => {
  lifetimes.forEach((c) => {
    c.abort();
  });
  document.body.innerHTML = '';
});
async function start() {
  document.body.innerHTML = readFileSync('tests/fixtures/netflix-ad-break.html', 'utf8');
  const lifetime = new AbortController();
  lifetimes.push(lifetime);
  const adapter = new NetflixAdapter();
  await adapter.init({ settings: defaultSettings(), signal: lifetime.signal, log: silentLogger() });
  return adapter;
}
it('detects only visible ad markers, caps at 4, reports provisional diagnostics', async () => {
  const adapter = await start();
  expect(adapter.evaluateNow().active).toBe(false);
  document.querySelector('[data-uia="ad-break"]')?.removeAttribute('hidden');
  expect(adapter.evaluateNow()).toMatchObject({ active: true, kind: 'ad', confidence: 0.9 });
  expect(adapter.getCapabilities().maxRateHint).toBe(4);
  expect(adapter.getDiagnostics().selectorsVersion).toMatch(/-provisional$/);
  expect(adapter.isWatchContext(new URL('https://www.netflix.com/browse'))).toBe(false);
});
it.each(['intro', 'recap', 'promo'] as const)('reports %s separately', async (kind) => {
  const adapter = await start();
  const key = kind === 'promo' ? 'next-episode-seamless-button' : `player-skip-${kind}`;
  document.querySelector(`[data-uia="${key}"]`)?.removeAttribute('hidden');
  expect(adapter.evaluateNow()).toMatchObject({ active: true, kind });
  adapter.destroy();
});
