/** @vitest-environment-options {"url":"https://www.netflix.com/watch/123"} */
import { afterEach, expect, it, vi } from 'vitest';
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
  const adapter = new CountingNetflix();
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

class CountingNetflix extends NetflixAdapter {
  get count() {
    return this.evaluations;
  }
}
it('coalesces 500 player mutations and disconnects watchers on destroy', async () => {
  const observe = vi.spyOn(MutationObserver.prototype, 'observe');
  const adapter = await start();
  const before = adapter.count;
  const root = document.querySelector('.watch-video');
  if (!root) throw new Error('Missing root');
  for (let n = 0; n < 500; n++) root.classList.toggle('changed');
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(adapter.count - before).toBe(1);
  expect(
    observe.mock.calls.some(([target, opts]) => target === document.body && opts?.subtree),
  ).toBe(false);
  adapter.destroy();
  const stopped = adapter.count;
  root.classList.toggle('changed');
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(adapter.count).toBe(stopped);
  observe.mockRestore();
});
