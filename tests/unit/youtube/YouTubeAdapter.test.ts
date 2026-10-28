/**
 * @vitest-environment-options {"url": "https://www.youtube.com/watch?v=abc", "settings": {"disableJavaScriptFileLoading": true, "disableJavaScriptEvaluation": true, "handleDisabledFileLoadingAsSuccess": true}}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdStateSnapshot } from '../../../src/platforms/signals';
import { BRIDGE_NS, BRIDGE_READY_ATTR } from '../../../src/platforms/youtube/bridgeProtocol';
import { SELECTORS_VERSION } from '../../../src/platforms/youtube/selectors';
import {
  BRIDGE_FALLBACK_MS,
  HREF_POLL_MS,
  isYouTubeWatchUrl,
  parseCountdown,
  parsePod,
  YOUTUBE_MEDIA_SHORTCUT_KEYS,
  YouTubeAdapter,
} from '../../../src/platforms/youtube/YouTubeAdapter';
import { defaultSettings } from '../../../src/shared/settings';
import { loadFixture, runSteps, settle, type FixtureApi } from '../helpers/fixture';
import { silentLogger } from '../helpers/logger';

/** Exposes the protected evaluation counter (coalescing check). */
class CountingAdapter extends YouTubeAdapter {
  get evaluationCount(): number {
    return this.evaluations;
  }
}

interface Started {
  adapter: CountingAdapter;
  lifetime: AbortController;
  snapshots: AdStateSnapshot[];
  navigations: URL[];
  last: () => AdStateSnapshot;
}

const started: Started[] = [];

async function start(): Promise<Started> {
  const adapter = new CountingAdapter();
  const lifetime = new AbortController();
  await adapter.init({ settings: defaultSettings(), log: silentLogger(), signal: lifetime.signal });
  const snapshots: AdStateSnapshot[] = [];
  const navigations: URL[] = [];
  adapter.onSnapshot((s) => snapshots.push(s));
  adapter.onNavigation((u) => navigations.push(u));
  const s: Started = {
    adapter,
    lifetime,
    snapshots,
    navigations,
    last: () => snapshots.at(-1) ?? adapter.evaluateNow(),
  };
  started.push(s);
  return s;
}

function video(): HTMLVideoElement {
  const v = document.querySelector('video');
  if (!v) throw new Error('fixture has no video');
  return v;
}

/** Simulates content having played for a while (happy-dom has no media pipeline). */
function playContent(seconds = 2): void {
  const v = video();
  Object.defineProperty(v, 'currentTime', { configurable: true, value: seconds });
  v.dispatchEvent(new Event('timeupdate'));
}

beforeEach(() => {
  history.replaceState(null, '', '/watch?v=abc');
});

afterEach(() => {
  for (const s of started.splice(0)) s.lifetime.abort();
  vi.useRealTimers();
  document.documentElement.removeAttribute(BRIDGE_READY_ATTR);
});

describe('pure helpers', () => {
  it.each([
    ['Ad 1 of 2', { index: 1, total: 2 }],
    ['Anuncio 2 de 3 · 0:15', { index: 2, total: 3 }],
    ['広告 1/2', { index: 1, total: 2 }],
    ['Ad · 0:15', null],
    ['Ad 3 of 2', null],
    ['Ad 1 of 11', null],
    ['Sponsored', null],
    [null, null],
  ])('parsePod(%j)', (text, expected) => {
    expect(parsePod(text)).toEqual(expected);
  });

  it.each([
    ['0:05', 5],
    ['Ad · 1:02', 62],
    ['Ad 1 of 2 · 0:00', 0],
    ['Skip', null],
  ])('parseCountdown(%j)', (text, expected) => {
    expect(parseCountdown(text)).toBe(expected);
  });

  it.each([
    ['https://www.youtube.com/watch?v=x', true],
    ['https://m.youtube.com/watch?v=x', true],
    ['https://www.youtube.com/live/abc', true],
    ['https://music.youtube.com/watch?v=x', true],
    ['https://www.youtube.com/', false],
    ['https://www.youtube.com/results?search_query=x', false],
    ['https://www.youtube.com/shorts/abc', false],
    ['https://www.youtube.com/embed/abc', false],
    ['https://music.youtube.com/', false],
    ['https://example.com/watch?v=x', false],
  ])('isWatchContext(%s) = %s', (url, expected) => {
    expect(isYouTubeWatchUrl(new URL(url))).toBe(expected);
  });
});

describe('ad pod fixture (Y1 + Y3, pod parsing, flicker)', () => {
  let fixture: FixtureApi;
  beforeEach(() => {
    fixture = loadFixture('youtube-ad-pod');
  });

  it('reports each pod ad with its index, the flicker as 0, and the end as 0', async () => {
    const s = await start();
    let i = await runSteps(fixture, (action) => action === 'adStart');
    expect(s.last().confidence).toBe(0);

    await fixture.step(i++); // Ad 1 of 2
    await settle();
    expect(s.last()).toMatchObject({
      active: true,
      kind: 'ad',
      confidence: 0.9,
      pod: { index: 1, total: 2 },
      ssaiSuspected: false, // pre-roll: the content src isn't known yet
    });
    expect(s.last().reasons).toEqual(['yt.playerClass.ad-showing', 'yt.adUi']);

    await fixture.step(i++); // flicker
    await fixture.step(i++); // src ad2
    await settle();
    expect(s.last()).toMatchObject({ active: false, confidence: 0 });

    await fixture.step(i++); // Ad 2 of 2
    await settle();
    expect(s.last()).toMatchObject({ confidence: 0.9, pod: { index: 2, total: 2 } });

    await runSteps(fixture, () => false, i);
    await settle();
    expect(s.last()).toMatchObject({ active: false, confidence: 0, kind: null });
  });

  it('coalesces a burst of mutations into one evaluation', async () => {
    const s = await start();
    const before = s.adapter.evaluationCount;
    const root = document.querySelector('#movie_player');
    for (let n = 0; n < 40; n++) root?.classList.toggle('ad-showing');
    await settle();
    expect(s.adapter.evaluationCount - before).toBe(1);
  });

  it('ignores hidden ad UI', async () => {
    const s = await start();
    const module = document.querySelector('.video-ads');
    if (!module) throw new Error('no ad module');
    module.innerHTML = '<div class="ytp-ad-player-overlay-layout" hidden>Ad 1 of 1</div>';
    await settle();
    expect(s.last().confidence).toBe(0);
    module.innerHTML = '<div style="display:none"><span class="ytp-ad-badge__text">Ad</span></div>';
    await settle();
    expect(s.last().confidence).toBe(0);
  });

  it('marks the segment skippable through the Y3 signal and keeps capabilities non-live', async () => {
    const s = await start();
    await runSteps(fixture, (action) => action === 'flicker');
    await settle();
    expect(s.last().confidence).toBe(0.9);
    expect(s.adapter.getCapabilities()).toEqual({
      allowRateBoost: true,
      allowMute: true,
      rateEnforcement: 'guard',
    });
  });

  it('exposes the player root, media shortcut keys and selector diagnostics', async () => {
    const s = await start();
    await runSteps(fixture, (action) => action === 'flicker');
    await settle();
    expect(s.adapter.getInteractionRoot()).toBe(document.querySelector('#movie_player'));
    expect(s.adapter.getMediaShortcutKeys()).toEqual(['m', 'M', '<', '>']);
    expect(YOUTUBE_MEDIA_SHORTCUT_KEYS).not.toContain(' ');
    expect(s.adapter.getDiagnostics()).toEqual({
      selectorsVersion: SELECTORS_VERSION,
      chainIndices: expect.objectContaining({
        playerRoot: 0,
        video: 0,
        adModule: 0,
        adOverlay: 0,
        adBadgeText: 0,
      }) as Record<string, number>,
    });
  });

  it('reports a fallback chain index when the primary selector is gone (drift)', async () => {
    document.querySelector('#movie_player')?.removeAttribute('id');
    const s = await start();
    expect(s.adapter.getDiagnostics().chainIndices.playerRoot).toBe(1);
  });

  it('finds the video and reports it as the video element', async () => {
    const s = await start();
    expect(s.adapter.getVideoElement()).toBe(video());
  });
});

describe('SSAI fixture (§2.3)', () => {
  let fixture: FixtureApi;
  beforeEach(() => {
    fixture = loadFixture('youtube-ssai');
  });

  async function startDuringStitchedAd(): Promise<{ s: Started; next: number }> {
    const s = await start();
    let i = await runSteps(fixture, (action) => action === 'waitForPlayback');
    playContent(); // stands in for waitForPlayback
    i = await runSteps(fixture, (action) => action === 'countdown', i + 1);
    await settle();
    return { s, next: i };
  }

  it('suspects SSAI when the ad shows with no src change against known content', async () => {
    const { s } = await startDuringStitchedAd();
    expect(s.last()).toMatchObject({ active: true, confidence: 0.9, ssaiSuspected: true });
  });

  it('exits as soon as the countdown reaches 0, while ad-showing is still set', async () => {
    const { s, next } = await startDuringStitchedAd();
    await fixture.step(next); // 0:01
    await settle();
    expect(s.last().confidence).toBe(0.9);
    await fixture.step(next + 1); // 0:00
    await settle();
    expect(document.querySelector('#movie_player')?.classList.contains('ad-showing')).toBe(true);
    expect(s.last()).toMatchObject({
      active: false,
      confidence: 0,
      reasons: ['yt.ssai.exit'],
      ssaiSuspected: true,
    });
  });

  it('exits when ad-showing clears even if the overlay lingers', async () => {
    const { s } = await startDuringStitchedAd();
    document.querySelector('#movie_player')?.classList.remove('ad-showing');
    await settle();
    expect(s.last()).toMatchObject({ confidence: 0, reasons: ['yt.ssai.exit'] });
  });

  it('does not suspect SSAI when the src changed (Y5 corroborates instead)', async () => {
    const s = await start();
    await runSteps(fixture, (action) => action === 'waitForPlayback');
    playContent();
    fixture.actions.src?.('ad');
    fixture.actions.adStart?.({ index: 1, total: 1 });
    await settle();
    expect(s.last()).toMatchObject({ confidence: 1, ssaiSuspected: false });
    expect(s.last().reasons).toContain('yt.media');
  });
});

describe('live fixture (§2.3 context exclusions)', () => {
  it('allows mute only on a live stream', async () => {
    loadFixture('youtube-live');
    const s = await start();
    expect(s.adapter.getCapabilities()).toEqual({
      allowRateBoost: false,
      allowMute: true,
      rateEnforcement: 'guard',
    });
    expect(s.adapter.getDiagnostics().chainIndices.liveIndicator).toBe(0);
  });
});

describe('MAIN-world bridge (Y4)', () => {
  function captureNonce(): { nonce: () => string } {
    let nonce = '';
    const original = window.postMessage.bind(window);
    vi.spyOn(window, 'postMessage').mockImplementation((message: unknown, ...rest: unknown[]) => {
      const m = message as { type?: string; nonce?: string };
      if (m.type === 'probe' && m.nonce) nonce = m.nonce;
      (original as (...args: unknown[]) => void)(message, ...rest);
    });
    return { nonce: () => nonce };
  }

  function reply(data: Record<string, unknown>, source: Window | null = window): void {
    window.dispatchEvent(new MessageEvent('message', { data, source }));
  }

  it('sends a namespaced probe and scores a video-id mismatch as an ad', async () => {
    loadFixture('youtube-ad-pod');
    const { nonce } = captureNonce();
    const s = await start();
    document.querySelector('#movie_player')?.classList.add('something'); // triggers a probe
    await settle();
    expect(nonce()).toMatch(/^[0-9a-f]{32}$/);
    const result = { ns: BRIDGE_NS, type: 'probe-result', adHint: null, live: null };
    reply({ ...result, nonce: nonce(), videoId: 'abc' });
    await settle();
    expect(s.last().confidence).toBe(0);
    reply({ ...result, nonce: nonce(), videoId: 'ad-video' });
    await settle();
    expect(s.last()).toMatchObject({ confidence: 0.5, reasons: ['yt.bridge'] });
  });

  it('ignores a wrong nonce, another namespace, another source and bad fields', async () => {
    loadFixture('youtube-ad-pod');
    const { nonce } = captureNonce();
    const s = await start();
    document.querySelector('#movie_player')?.classList.add('x');
    await settle();
    const good = { ns: BRIDGE_NS, type: 'probe-result', videoId: null, adHint: true, live: null };
    reply({ ...good, nonce: 'forged' });
    reply({ ...good, nonce: nonce(), ns: 'other' });
    reply({ ...good, nonce: nonce(), adHint: 'yes' });
    reply({ ...good, nonce: nonce() }, null);
    await settle();
    expect(s.last().confidence).toBe(0);
    reply({ ...good, nonce: nonce() });
    await settle();
    expect(s.last().confidence).toBe(0.5);
  });

  it('a bridge that reports live turns off the rate boost', async () => {
    loadFixture('youtube-ad-pod');
    const { nonce } = captureNonce();
    const s = await start();
    document.querySelector('#movie_player')?.classList.add('x');
    await settle();
    reply({
      ns: BRIDGE_NS,
      type: 'probe-result',
      nonce: nonce(),
      videoId: null,
      adHint: null,
      live: true,
    });
    expect(s.adapter.getCapabilities().allowRateBoost).toBe(false);
  });

  it('injects the bridge via <script src> after 1 s only if it never announced itself', async () => {
    vi.useFakeTimers();
    loadFixture('youtube-ad-pod');
    await start();
    const injected: string[] = [];
    new MutationObserver((records) => {
      for (const node of records.flatMap((r) => [...r.addedNodes])) {
        if (node instanceof HTMLScriptElement) injected.push(node.src);
      }
    }).observe(document.documentElement, { childList: true });
    vi.advanceTimersByTime(BRIDGE_FALLBACK_MS - 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(injected).toEqual(['chrome-extension://test-extension-id/youtube-bridge.js']);
    // It removes itself once loaded.
    await vi.advanceTimersByTimeAsync(10);
    expect(document.querySelectorAll('script')).toHaveLength(0);
  });

  it('does not inject when the MAIN-world script is running', async () => {
    vi.useFakeTimers();
    loadFixture('youtube-ad-pod');
    document.documentElement.setAttribute(BRIDGE_READY_ATTR, '');
    await start();
    vi.advanceTimersByTime(BRIDGE_FALLBACK_MS);
    expect(document.querySelectorAll('script')).toHaveLength(0);
  });
});

describe('navigation (§2.3)', () => {
  it('emits once per distinct URL from yt-navigate-finish and popstate', async () => {
    loadFixture('youtube-ad-pod');
    const s = await start();
    history.pushState(null, '', '/watch?v=next');
    document.dispatchEvent(new Event('yt-navigate-finish'));
    document.dispatchEvent(new Event('yt-navigate-finish'));
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(s.navigations.map((u) => u.href)).toEqual(['https://www.youtube.com/watch?v=next']);
    history.pushState(null, '', '/watch?v=third');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(s.navigations).toHaveLength(2);
  });

  it('falls back to a 1 s href poll', async () => {
    vi.useFakeTimers();
    loadFixture('youtube-ad-pod');
    const s = await start();
    history.pushState(null, '', '/watch?v=polled');
    expect(s.navigations).toHaveLength(0);
    vi.advanceTimersByTime(HREF_POLL_MS);
    expect(s.navigations.map((u) => u.searchParams.get('v'))).toEqual(['polled']);
  });

  it('waits for a player root that appears after start', async () => {
    document.body.replaceChildren();
    const s = await start();
    expect(s.adapter.getInteractionRoot()).toBeNull();
    loadFixture('youtube-ad-pod');
    await settle();
    expect(s.adapter.getInteractionRoot()).toBe(document.querySelector('#movie_player'));
  });

  it('stops everything when its signal aborts', async () => {
    vi.useFakeTimers();
    const fixture = loadFixture('youtube-ad-pod');
    const s = await start();
    s.lifetime.abort();
    s.adapter.destroy();
    await runSteps(fixture, (action) => action === 'flicker');
    history.pushState(null, '', '/watch?v=after');
    vi.advanceTimersByTime(HREF_POLL_MS * 2);
    expect(s.snapshots).toHaveLength(0);
    expect(s.navigations).toHaveLength(0);
  });
});
