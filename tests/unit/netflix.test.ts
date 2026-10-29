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
it('detects the captured Netflix ad label, permits 16x, reports selector diagnostics', async () => {
  const adapter = await start();
  const label = document.querySelector('[data-uia="ads-info-text"]');
  if (!label) throw new Error('Missing ad label');
  expect(adapter.evaluateNow().active).toBe(false);
  label.textContent = 'Ad';
  expect(adapter.evaluateNow()).toMatchObject({ active: true, kind: 'ad', confidence: 0.6 });
  label.textContent = 'Episode';
  expect(adapter.evaluateNow().active).toBe(false);
  expect(adapter.getCapabilities().maxRateHint).toBe(16);
  expect(adapter.getDiagnostics().selectorsVersion).toBe('2026-10-30-capture-1');
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
