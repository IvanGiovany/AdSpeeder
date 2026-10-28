import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Controller,
  MAX_BOOSTED_MS,
  MAX_MUTED_ONLY_MS,
  ORPHAN_CHECK_MS,
  SELECTOR_DRIFT_PAGES,
  STATS_FLUSH_MS,
  type ControllerOptions,
} from '../../../src/core/Controller';
import { RateProbe } from '../../../src/core/RateProbe';
import { BOOST_MARKER_ATTR } from '../../../src/core/SessionSnapshot';
import { VideoEngine } from '../../../src/core/VideoEngine';
import type { TabStatus } from '../../../src/shared/messaging';
import { applyPatch, defaultSettings, type SettingsPatch } from '../../../src/shared/settings';
import type { StatsBatch } from '../../../src/shared/stats';
import {
  adSnapshot,
  confidenceSnapshot,
  FakeAdapter,
  flickerSnapshot,
  IDLE_SNAPSHOT,
} from '../helpers/FakeAdapter';
import { FakeVideo, flushMicrotasks, type FakeVideoOptions } from '../helpers/FakeVideo';
import { silentLogger } from '../helpers/logger';

interface Harness {
  controller: Controller;
  adapter: FakeAdapter;
  video: FakeVideo;
  lifetime: AbortController;
  log: ReturnType<typeof silentLogger>;
  sendStats: ReturnType<typeof vi.fn<(batch: StatsBatch) => Promise<void>>>;
  statuses: TabStatus[];
  setAlive: (alive: boolean) => void;
}

const harnesses: Harness[] = [];

async function setup(
  options: {
    video?: FakeVideoOptions;
    settings?: SettingsPatch;
    configure?: (adapter: FakeAdapter) => void;
    controller?: Partial<ControllerOptions>;
  } = {},
): Promise<Harness> {
  const video = new FakeVideo({ playbackRate: 1.5, ...options.video });
  const adapter = new FakeAdapter(video.el);
  options.configure?.(adapter);
  const lifetime = new AbortController();
  const log = silentLogger();
  const statuses: TabStatus[] = [];
  const sendStats = vi.fn<(batch: StatsBatch) => Promise<void>>(() => Promise.resolve());
  let alive = true;
  const controller = new Controller({
    adapter,
    settings: applyPatch(defaultSettings(), options.settings ?? {}),
    log,
    signal: lifetime.signal,
    now: () => Date.now(),
    isRuntimeAlive: () => alive,
    sendStats,
    reportStatus: (s) => statuses.push(s),
    ...options.controller,
  });
  await controller.start();
  const harness: Harness = {
    controller,
    adapter,
    video,
    lifetime,
    log,
    sendStats,
    statuses,
    setAlive: (value) => {
      alive = value;
    },
  };
  harnesses.push(harness);
  return harness;
}

/** A trusted pointerdown, as a real click would produce (§3.3). */
function userInput(): void {
  const event = new Event('pointerdown');
  Object.defineProperty(event, 'isTrusted', { value: true });
  document.dispatchEvent(event);
}

const phase = (h: Harness) => h.controller.state.phase;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const h of harnesses.splice(0)) h.lifetime.abort();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('boost and restore', () => {
  it('boosts on an ad and restores the user’s 1.5x after the exit debounce', async () => {
    const h = await setup();
    h.adapter.emit(adSnapshot());
    expect(phase(h)).toBe('BOOSTING');
    expect(h.video.playbackRate).toBe(16);
    expect(h.video.muted).toBe(true);

    h.adapter.emit(IDLE_SNAPSHOT);
    expect(phase(h)).toBe('EXIT_PENDING');
    vi.advanceTimersByTime(299);
    expect(h.video.playbackRate).toBe(16);
    vi.advanceTimersByTime(1);
    expect(phase(h)).toBe('IDLE');
    expect(h.video.playbackRate).toBe(1.5);
    expect(h.video.muted).toBe(false);
  });

  it('acts on an ad already showing at start', async () => {
    const h = await setup({
      configure: (a) => {
        a.emit(adSnapshot());
      },
    });
    expect(phase(h)).toBe('BOOSTING');
  });

  it('clamps the requested speed to settings and capabilities.maxRateHint', async () => {
    const h = await setup({
      settings: { speed: 8 },
      configure: (a) => {
        a.capabilities = { ...a.capabilities, maxRateHint: 4 };
      },
    });
    h.adapter.emit(adSnapshot());
    expect(h.video.playbackRate).toBe(4);
  });

  it('respects settings.mute = false', async () => {
    const h = await setup({ settings: { mute: false } });
    h.adapter.emit(adSnapshot());
    expect(h.video.muted).toBe(false);
    expect(h.video.playbackRate).toBe(16);
  });

  it('does nothing without a video, outside a watch context, or when disabled', async () => {
    const noVideo = await setup({
      configure: (a) => {
        a.setVideo(null);
      },
    });
    noVideo.adapter.emit(adSnapshot());
    expect(phase(noVideo)).toBe('IDLE');

    const notWatching = await setup({
      configure: (a) => {
        a.watchContext = false;
      },
    });
    notWatching.adapter.emit(adSnapshot());
    expect(phase(notWatching)).toBe('IDLE');

    const disabled = await setup({ settings: { enabled: false } });
    disabled.adapter.emit(adSnapshot());
    expect(phase(disabled)).toBe('IDLE');

    const platformOff = await setup({ settings: { platforms: { youtube: false } } });
    platformOff.adapter.emit(adSnapshot());
    expect(phase(platformOff)).toBe('IDLE');
  });

  it('starts boosting when the video appears during an active ad', async () => {
    const h = await setup({
      configure: (a) => {
        a.setVideo(null);
      },
    });
    h.adapter.emit(adSnapshot());
    const late = new FakeVideo();
    h.adapter.setVideo(late.el);
    expect(phase(h)).toBe('BOOSTING');
    expect(late.playbackRate).toBe(16);
  });
});

describe('pods and debounce (§3.4)', () => {
  it('pod flicker under 300 ms keeps one snapshot', async () => {
    const h = await setup();
    h.adapter.emit(adSnapshot({ pod: { index: 1, total: 2 } }));
    vi.advanceTimersByTime(5000);
    h.adapter.emit(flickerSnapshot());
    vi.advanceTimersByTime(250);
    h.adapter.emit(adSnapshot({ pod: { index: 2, total: 2 } }));
    expect(phase(h)).toBe('BOOSTING');
    vi.advanceTimersByTime(5000);
    h.adapter.emit(IDLE_SNAPSHOT);
    vi.advanceTimersByTime(300);
    expect(phase(h)).toBe('IDLE');
    // One boost write, one restore write: the snapshot was never re-taken mid-pod.
    expect(h.video.rateWrites).toEqual([16, 1.5]);
    expect(h.video.mutedWrites).toEqual([true, false]);
    expect(h.video.playbackRate).toBe(1.5);
  });

  it('extends the exit debounce to 1,000 ms while more pod ads are known to follow', async () => {
    const h = await setup();
    h.adapter.emit(adSnapshot({ pod: { index: 1, total: 2 } }));
    h.adapter.emit(IDLE_SNAPSHOT);
    vi.advanceTimersByTime(999);
    expect(phase(h)).toBe('EXIT_PENDING');
    vi.advanceTimersByTime(1);
    expect(phase(h)).toBe('IDLE');
  });

  it('drops the exit debounce to 100 ms when SSAI is suspected', async () => {
    const h = await setup();
    h.adapter.emit(adSnapshot({ ssaiSuspected: true, pod: { index: 1, total: 2 } }));
    h.adapter.emit(IDLE_SNAPSHOT);
    vi.advanceTimersByTime(100);
    expect(phase(h)).toBe('IDLE');
  });
});

describe('rate defense (§3.5)', () => {
  it('re-asserts after the load algorithm resets the rate', async () => {
    const h = await setup({
      configure: (a) => {
        a.capabilities = { ...a.capabilities, rateEnforcement: 'none' };
      },
    });
    h.adapter.emit(adSnapshot());
    h.video.loadNewSource();
    expect(h.video.playbackRate).toBe(16);
  });

  it('a site reset loop ends in CONTESTED within budget, keeping the ad muted', async () => {
    const h = await setup();
    h.adapter.emit(adSnapshot());
    h.video.el.addEventListener('ratechange', () => {
      if (h.video.playbackRate !== 1) h.video.siteSetsRate(1);
    });
    h.video.siteSetsRate(1);
    for (let i = 0; i < 30 && phase(h) !== 'CONTESTED'; i++) {
      await flushMicrotasks();
      await vi.advanceTimersToNextTimerAsync();
    }
    expect(phase(h)).toBe('CONTESTED');
    expect(h.video.rateWrites.filter((r) => r === 16)).toHaveLength(11); // boost + 10 rewrites
    expect(h.video.muted).toBe(true);
    expect(h.log.warn).toHaveBeenCalledWith('rate-contested', { platform: 'youtube' });
    expect(h.statuses.at(-1)?.phase).toBe('contested');

    // CONTESTED stops rewriting even on load events, but still follows the exit path.
    h.video.loadNewSource();
    expect(h.video.playbackRate).toBe(1);
    h.adapter.emit(IDLE_SNAPSHOT);
    vi.advanceTimersByTime(300);
    expect(phase(h)).toBe('IDLE');
    expect(h.video.muted).toBe(false);
  });
});

describe('user intent (§3.3)', () => {
  it('a user unmute is respected for the rest of the segment', async () => {
    const h = await setup();
    h.adapter.emit(adSnapshot());
    userInput();
    h.video.setMuted(false);
    await flushMicrotasks();
    h.video.loadNewSource(); // reassert must not re-mute
    expect(h.video.muted).toBe(false);
    expect(h.video.playbackRate).toBe(16);
  });

  it('a site unmute without user input is undone', async () => {
    const h = await setup();
    h.adapter.emit(adSnapshot());
    h.video.setMuted(false);
    await flushMicrotasks();
    expect(h.video.muted).toBe(true);
  });

  it('a user speed change stands the guard down and survives the restore', async () => {
    const h = await setup();
    h.adapter.emit(adSnapshot());
    userInput();
    h.video.siteSetsRate(2);
    await flushMicrotasks();
    vi.runOnlyPendingTimers();
    expect(h.video.playbackRate).toBe(2);
    h.adapter.emit(IDLE_SNAPSHOT);
    vi.advanceTimersByTime(300 + 500);
    expect(h.video.playbackRate).toBe(2);
    expect(h.video.muted).toBe(false);
  });

  it('input older than 500 ms does not count as user intent', async () => {
    const h = await setup();
    h.adapter.emit(adSnapshot());
    userInput();
    vi.advanceTimersByTime(600);
    h.video.setMuted(false);
    await flushMicrotasks();
    expect(h.video.muted).toBe(true);
  });
});

describe('force-restore triggers (§3.1)', () => {
  async function boosted(options?: Parameters<typeof setup>[0]): Promise<Harness> {
    const h = await setup(options);
    h.adapter.emit(adSnapshot());
    expect(phase(h)).toBe('BOOSTING');
    return h;
  }

  const expectRestored = (h: Harness) => {
    expect(phase(h)).toBe('IDLE');
    expect(h.video.playbackRate).toBe(1.5);
    expect(h.video.muted).toBe(false);
  };

  it('navigation restores, then evaluates the new page', async () => {
    const h = await boosted();
    h.adapter.navigate('https://www.youtube.com/watch?v=next');
    // The fake still reports an ad, so a pre-roll on the new page boosts again.
    expect(phase(h)).toBe('BOOSTING');
    h.adapter.emit(IDLE_SNAPSHOT);
    vi.advanceTimersByTime(300);
    expectRestored(h);
    expect(h.video.rateWrites).toEqual([16, 1.5, 16, 1.5]);
  });

  it('navigation to a non-watch page restores and stays idle', async () => {
    const h = await boosted();
    h.adapter.watchContext = false;
    h.adapter.navigate('https://www.youtube.com/');
    expectRestored(h);
  });

  it('pagehide restores', async () => {
    const h = await boosted();
    window.dispatchEvent(new Event('pagehide'));
    expectRestored(h);
  });

  it('pageshow from the back/forward cache re-evaluates', async () => {
    const h = await boosted();
    window.dispatchEvent(new Event('pagehide'));
    const event = new Event('pageshow');
    Object.defineProperty(event, 'persisted', { value: true });
    window.dispatchEvent(event);
    expect(phase(h)).toBe('BOOSTING');
  });

  it('the user toggling off restores', async () => {
    const h = await boosted();
    h.controller.updateSettings(applyPatch(defaultSettings(), { enabled: false }));
    expectRestored(h);
  });

  it('disabling the platform restores', async () => {
    const h = await boosted();
    h.controller.updateSettings(applyPatch(defaultSettings(), { platforms: { youtube: false } }));
    expectRestored(h);
  });

  it('a settings change mid-ad re-applies the boost at the new speed', async () => {
    const h = await boosted();
    h.controller.updateSettings(applyPatch(defaultSettings(), { speed: 4 }));
    expect(phase(h)).toBe('BOOSTING');
    expect(h.video.playbackRate).toBe(4);
  });

  it('destroy (signal abort) restores and removes every listener', async () => {
    const h = await boosted();
    h.lifetime.abort();
    expectRestored(h);
    expect(h.adapter.destroyed).toBe(true);
    expect(h.adapter.listenerCount).toBe(0);
    h.adapter.emit(adSnapshot());
    h.video.loadNewSource();
    window.dispatchEvent(new Event('pagehide'));
    expect(h.video.playbackRate).toBe(1);
    h.controller.destroy(); // idempotent
  });

  it('an orphaned extension context restores and tears down within 5 s', async () => {
    const h = await boosted();
    h.setAlive(false);
    vi.advanceTimersByTime(ORPHAN_CHECK_MS);
    expectRestored(h);
    expect(h.adapter.destroyed).toBe(true);
    expect(h.log.warn).toHaveBeenCalledWith(expect.stringContaining('orphaned'));
  });

  it('a newly injected instance restores a leftover crash marker before anything else', async () => {
    const video = new FakeVideo({ playbackRate: 1.25 });
    new VideoEngine(new RateProbe(), silentLogger()).boost(video.el, { rate: 16, mute: true });
    expect(video.el.hasAttribute(BOOST_MARKER_ATTR)).toBe(true);
    await setup();
    expect(video.playbackRate).toBe(1.25);
    expect(video.muted).toBe(false);
    expect(video.el.hasAttribute(BOOST_MARKER_ATTR)).toBe(false);
  });

  it('a detached element is restored without throwing', async () => {
    const h = await boosted();
    h.video.detach();
    expect(() => {
      h.adapter.navigate('https://www.youtube.com/');
    }).not.toThrow();
  });
});

describe('media node tracking (§3.6)', () => {
  it('a video replaced mid-pod transfers the snapshot to the new node', async () => {
    const h = await setup();
    h.adapter.emit(adSnapshot({ pod: { index: 1, total: 2 } }));
    const replacement = new FakeVideo();
    h.adapter.setVideo(replacement.el);
    expect(h.video.playbackRate).toBe(1.5); // old node restored (still connected)
    expect(replacement.playbackRate).toBe(16);
    expect(replacement.muted).toBe(true);
    h.adapter.emit(IDLE_SNAPSHOT);
    vi.advanceTimersByTime(1000);
    expect(replacement.playbackRate).toBe(1.5); // the user's rate, from the moved snapshot
    expect(replacement.muted).toBe(false);
  });
});

describe('capabilities and segment kinds', () => {
  it('a live stream gets mute only', async () => {
    const h = await setup({
      configure: (a) => {
        a.capabilities = { allowRateBoost: false, allowMute: true, rateEnforcement: 'guard' };
      },
    });
    h.adapter.emit(adSnapshot());
    expect(phase(h)).toBe('BOOSTING');
    expect(h.video.rateWrites).toEqual([]);
    expect(h.video.muted).toBe(true);
  });

  it('a live stream with mute disabled is left alone', async () => {
    const h = await setup({
      settings: { mute: false },
      configure: (a) => {
        a.capabilities = { allowRateBoost: false, allowMute: true, rateEnforcement: 'none' };
      },
    });
    h.adapter.emit(adSnapshot());
    expect(phase(h)).toBe('IDLE');
  });

  it('ignores intro/recap/promo by default and speeds them when chosen', async () => {
    const ignored = await setup();
    ignored.adapter.emit(adSnapshot({ kind: 'intro' }));
    expect(phase(ignored)).toBe('IDLE');

    const sped = await setup({ settings: { promoActions: { intro: 'speed' } } });
    sped.adapter.emit(adSnapshot({ kind: 'intro' }));
    expect(phase(sped)).toBe('BOOSTING');
    // Switching the kind back to ignore ends the segment.
    sped.controller.updateSettings(applyPatch(defaultSettings(), {}));
    vi.advanceTimersByTime(300);
    expect(phase(sped)).toBe('IDLE');
  });
});

describe('stats batching (§3.7, D6)', () => {
  /** Plays `seconds` of wall time at `rate`, firing timeupdate every 250 ms. */
  function play(h: Harness, seconds: number, rate: number): void {
    for (let t = 0; t < seconds * 4; t++) {
      vi.advanceTimersByTime(250);
      h.video.advance(rate / 4);
    }
  }

  it('sends a batch when the segment ends', async () => {
    const h = await setup();
    h.adapter.emit(adSnapshot());
    play(h, 2, 16);
    h.adapter.emit(IDLE_SNAPSHOT);
    vi.advanceTimersByTime(300);
    expect(h.sendStats).toHaveBeenCalledOnce();
    const batch = h.sendStats.mock.calls[0]?.[0];
    expect(batch?.platform).toBe('youtube');
    expect(batch?.adsSeen).toBe(1);
    // 2 s wall at 16x → 30 s saved; the 300 ms debounce at 16x adds nothing (no timeupdate).
    expect(batch?.secondsSaved).toBeCloseTo(30, 5);
  });

  it('sends a batch every 10 s during a long segment, counting pod ads', async () => {
    const h = await setup();
    h.adapter.emit(adSnapshot({ pod: { index: 1, total: 2 } }));
    play(h, 5, 16);
    h.adapter.emit(adSnapshot({ pod: { index: 2, total: 2 } }));
    play(h, 5, 16);
    // The 10 s flush fires just before the last 250 ms sample, which lands in the next batch.
    expect(h.sendStats).toHaveBeenCalledOnce();
    expect(h.sendStats.mock.calls[0]?.[0]).toMatchObject({ adsSeen: 2 });
    expect(h.sendStats.mock.calls[0]?.[0].secondsSaved).toBeCloseTo(150 - 3.75, 5);
    vi.advanceTimersByTime(STATS_FLUSH_MS);
    expect(h.sendStats).toHaveBeenCalledTimes(2);
    expect(h.sendStats.mock.calls[1]?.[0]).toMatchObject({ adsSeen: 0, secondsSaved: 3.75 });
    vi.advanceTimersByTime(STATS_FLUSH_MS);
    expect(h.sendStats).toHaveBeenCalledTimes(2); // nothing new accrued, nothing sent
  });

  it('a failed send is logged, not thrown', async () => {
    const h = await setup({
      controller: { sendStats: () => Promise.reject(new Error('no receiver')) },
    });
    h.adapter.emit(adSnapshot());
    h.adapter.emit(IDLE_SNAPSHOT);
    vi.advanceTimersByTime(300);
    await flushMicrotasks();
    expect(h.log.debug).toHaveBeenCalledWith('stats batch not delivered', expect.any(Error));
  });
});

describe('status reporting', () => {
  it('reports watching → boosting at the applied rate → watching', async () => {
    const h = await setup({ video: { maxRate: 8 } });
    h.adapter.emit(adSnapshot({ pod: { index: 1, total: 2 } }));
    h.adapter.emit(IDLE_SNAPSHOT);
    vi.advanceTimersByTime(1000);
    expect(h.statuses.map((s) => [s.phase, s.rate])).toEqual([
      ['watching', null],
      ['boosting', 8],
      ['boosting', 8],
      ['watching', null],
    ]);
    expect(h.statuses[1]?.pod).toEqual({ index: 1, total: 2 });
  });
});

describe('hysteresis owned by the engine (D8)', () => {
  it("enters only at confidence ≥ enterThreshold, whatever the adapter's active flag says", async () => {
    const h = await setup();
    h.adapter.emit({ ...confidenceSnapshot(0.5), active: true });
    expect(phase(h)).toBe('IDLE');
    h.adapter.emit(confidenceSnapshot(0.6));
    expect(phase(h)).toBe('BOOSTING');
  });

  it('holds the boost inside the 0.2–0.6 band and exits only at ≤ exitThreshold', async () => {
    const h = await setup();
    h.adapter.emit(adSnapshot());
    h.adapter.emit(confidenceSnapshot(0.3));
    vi.advanceTimersByTime(5000);
    expect(phase(h)).toBe('BOOSTING');
    h.adapter.emit(confidenceSnapshot(0.2));
    expect(phase(h)).toBe('EXIT_PENDING');
    vi.advanceTimersByTime(300);
    expect(phase(h)).toBe('IDLE');
  });
});

describe('segment caps (D9)', () => {
  const expectCap = (h: Harness, cap: 'boosted' | 'muted-only') => {
    expect(h.log.warn).toHaveBeenCalledWith(
      'detection-lost',
      expect.objectContaining({ platform: 'youtube', cap }),
    );
  };

  async function fightUntilContested(h: Harness): Promise<void> {
    h.video.el.addEventListener('ratechange', () => {
      if (h.video.playbackRate !== 1) h.video.siteSetsRate(1);
    });
    h.video.siteSetsRate(1);
    for (let i = 0; i < 30 && phase(h) !== 'CONTESTED'; i++) {
      await flushMicrotasks();
      await vi.advanceTimersToNextTimerAsync();
    }
    expect(phase(h)).toBe('CONTESTED');
  }

  it('caps a rate-boosted segment at 90 s, then waits until the segment is over', async () => {
    const h = await setup();
    h.adapter.emit(adSnapshot());
    vi.advanceTimersByTime(MAX_BOOSTED_MS - 1);
    expect(phase(h)).toBe('BOOSTING');
    vi.advanceTimersByTime(1);
    expect(phase(h)).toBe('IDLE');
    expect(h.video.playbackRate).toBe(1.5);
    expect(h.video.muted).toBe(false);
    expectCap(h, 'boosted');

    h.adapter.emit(adSnapshot()); // still detected: no re-boost
    expect(phase(h)).toBe('IDLE');
    h.adapter.emit(flickerSnapshot()); // a drop shorter than the exit debounce…
    vi.advanceTimersByTime(299);
    h.adapter.emit(adSnapshot()); // …is not "segment over"
    expect(phase(h)).toBe('IDLE');
    h.adapter.emit(IDLE_SNAPSHOT); // ≤ exitThreshold for the full 300 ms is
    vi.advanceTimersByTime(300);
    h.adapter.emit(adSnapshot());
    expect(phase(h)).toBe('BOOSTING');
  });

  it('caps a mute-only segment at 300 s, not 90 s', async () => {
    const h = await setup({
      configure: (a) => {
        a.capabilities = { allowRateBoost: false, allowMute: true, rateEnforcement: 'none' };
      },
    });
    h.adapter.emit(adSnapshot());
    vi.advanceTimersByTime(MAX_BOOSTED_MS);
    expect(phase(h)).toBe('BOOSTING');
    vi.advanceTimersByTime(MAX_MUTED_ONLY_MS - MAX_BOOSTED_MS);
    expect(phase(h)).toBe('IDLE');
    expect(h.video.muted).toBe(false);
    expectCap(h, 'muted-only');
  });

  it('switches to the 300 s cap when the segment becomes CONTESTED, keeping time spent', async () => {
    const h = await setup();
    const start = Date.now();
    h.adapter.emit(adSnapshot());
    await fightUntilContested(h);
    vi.advanceTimersByTime(MAX_MUTED_ONLY_MS - (Date.now() - start) - 1);
    expect(phase(h)).toBe('CONTESTED');
    vi.advanceTimersByTime(1);
    expect(phase(h)).toBe('IDLE');
    expectCap(h, 'muted-only');
  });

  it('a user speed change moves the segment to the 300 s cap', async () => {
    const h = await setup();
    h.adapter.emit(adSnapshot());
    userInput();
    h.video.siteSetsRate(2);
    await flushMicrotasks();
    vi.advanceTimersByTime(MAX_BOOSTED_MS);
    expect(phase(h)).toBe('BOOSTING');
    vi.advanceTimersByTime(MAX_MUTED_ONLY_MS - MAX_BOOSTED_MS);
    expect(phase(h)).toBe('IDLE');
    expectCap(h, 'muted-only');
  });
});

describe('trusted input scope (D14)', () => {
  function trustedInputOn(target: EventTarget, type = 'pointerdown'): void {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, 'isTrusted', { value: true });
    target.dispatchEvent(event);
  }

  function editableChild(): HTMLElement {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', '');
    const child = document.createElement('span');
    div.append(child);
    document.body.append(div);
    return child;
  }

  it.each([
    ['input', () => document.body.appendChild(document.createElement('input'))],
    ['textarea', () => document.body.appendChild(document.createElement('textarea'))],
    ['contenteditable', editableChild],
  ])('ignores trusted input in %s', async (_name, make) => {
    const h = await setup();
    h.adapter.emit(adSnapshot());
    trustedInputOn(make(), 'keydown');
    h.video.setMuted(false);
    await flushMicrotasks();
    expect(h.video.muted).toBe(true); // treated as a site unmute and undone
  });

  it('counts only input inside the interaction root when the adapter has one', async () => {
    const root = document.createElement('div');
    const control = document.createElement('button');
    root.append(control);
    const outside = document.createElement('button');
    document.body.append(root, outside);
    const h = await setup({
      configure: (a) => {
        a.getInteractionRoot = () => root;
      },
    });
    h.adapter.emit(adSnapshot());

    trustedInputOn(outside);
    h.video.setMuted(false);
    await flushMicrotasks();
    expect(h.video.muted).toBe(true);

    trustedInputOn(control);
    h.video.setMuted(false);
    await flushMicrotasks();
    expect(h.video.muted).toBe(false);
  });

  it('falls back to the whole document when the root is null', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const h = await setup({
      configure: (a) => {
        a.getInteractionRoot = () => null;
      },
    });
    h.adapter.emit(adSnapshot());
    trustedInputOn(outside);
    h.video.setMuted(false);
    await flushMicrotasks();
    expect(h.video.muted).toBe(false);
  });
});

describe('diagnostics in logs', () => {
  it('attaches selector diagnostics to rate-contested and detection-lost', async () => {
    const diagnostics = { selectorsVersion: '7', chainIndices: { playerRoot: 0, adModule: 1 } };
    const h = await setup({
      configure: (a) => {
        a.getDiagnostics = () => diagnostics;
      },
    });
    h.adapter.emit(adSnapshot());
    h.video.el.addEventListener('ratechange', () => {
      if (h.video.playbackRate !== 1) h.video.siteSetsRate(1);
    });
    h.video.siteSetsRate(1);
    for (let i = 0; i < 30 && phase(h) !== 'CONTESTED'; i++) {
      await flushMicrotasks();
      await vi.advanceTimersToNextTimerAsync();
    }
    expect(h.log.warn).toHaveBeenCalledWith('rate-contested', {
      platform: 'youtube',
      ...diagnostics,
    });
    vi.advanceTimersByTime(MAX_MUTED_ONLY_MS);
    expect(h.log.warn).toHaveBeenCalledWith(
      'detection-lost',
      expect.objectContaining({ selectorsVersion: '7', chainIndices: diagnostics.chainIndices }),
    );
  });

  it('logs selector-drift once after 3 consecutive drifting watch pages', async () => {
    expect(SELECTOR_DRIFT_PAGES).toBe(3);
    let chainIndices: Record<string, number> = { playerRoot: 1 };
    const h = await setup({
      configure: (a) => {
        a.getDiagnostics = () => ({ selectorsVersion: '7', chainIndices });
      },
    });
    const driftLogs = () => h.log.warn.mock.calls.filter(([msg]) => msg === 'selector-drift');
    const leavePage = () => {
      h.adapter.navigate('https://www.youtube.com/watch?v=x');
    };

    leavePage();
    leavePage();
    expect(driftLogs()).toHaveLength(0);
    leavePage();
    expect(driftLogs()).toEqual([
      ['selector-drift', { platform: 'youtube', selectorsVersion: '7', chainIndices }],
    ]);
    leavePage();
    expect(driftLogs()).toHaveLength(1);

    chainIndices = { playerRoot: 0 }; // a clean page resets the streak
    leavePage();
    chainIndices = { playerRoot: 2 };
    leavePage();
    leavePage();
    expect(driftLogs()).toHaveLength(1);
    leavePage();
    expect(driftLogs()).toHaveLength(2);
  });

  it('does not count non-watch pages', async () => {
    const h = await setup({
      configure: (a) => {
        a.watchContext = false;
        a.getDiagnostics = () => ({ selectorsVersion: '7', chainIndices: { playerRoot: 1 } });
      },
    });
    for (let i = 0; i < 4; i++) h.adapter.navigate('https://www.youtube.com/');
    expect(h.log.warn).not.toHaveBeenCalledWith('selector-drift', expect.anything());
  });
});

describe('page-wide media shortcuts (D15)', () => {
  const SHORTCUTS = ['m', 'M', '<', '>'];

  function trustedKey(target: EventTarget, key: string): void {
    const event = new KeyboardEvent('keydown', { key, bubbles: true });
    Object.defineProperty(event, 'isTrusted', { value: true });
    target.dispatchEvent(event);
  }

  async function scopedHarness(keys?: readonly string[]): Promise<Harness> {
    const root = document.createElement('div');
    document.body.append(root);
    const h = await setup({
      configure: (a) => {
        a.getInteractionRoot = () => root;
        if (keys) a.getMediaShortcutKeys = () => keys;
      },
    });
    h.adapter.emit(adSnapshot());
    return h;
  }

  /** Presses `key` on `target`, then unmutes; returns whether the unmute was kept as the user's. */
  async function unmuteKeptAfter(h: Harness, target: EventTarget, key: string): Promise<boolean> {
    trustedKey(target, key);
    h.video.setMuted(false);
    await flushMicrotasks();
    const kept = !h.video.muted;
    vi.advanceTimersByTime(600); // let the trusted-input window lapse before the next case
    return kept;
  }

  it.each([' ', 'k'])('%j on <body> does not count as user input', async (key) => {
    const h = await scopedHarness(SHORTCUTS);
    expect(await unmuteKeptAfter(h, document.body, key)).toBe(false);
  });

  it.each(SHORTCUTS)('%j on <body> or <html> counts as user input', async (key) => {
    const h = await scopedHarness(SHORTCUTS);
    expect(await unmuteKeptAfter(h, document.body, key)).toBe(true);
    h.adapter.emit(IDLE_SNAPSHOT);
    vi.advanceTimersByTime(300);
    h.adapter.emit(adSnapshot());
    expect(await unmuteKeptAfter(h, document.documentElement, key)).toBe(true);
  });

  it('a shortcut key on a focused element outside the root does not count', async () => {
    const h = await scopedHarness(SHORTCUTS);
    const outside = document.body.appendChild(document.createElement('button'));
    expect(await unmuteKeptAfter(h, outside, 'm')).toBe(false);
  });

  it('any key counts inside the interaction root', async () => {
    const h = await scopedHarness(SHORTCUTS);
    const root = h.adapter.getInteractionRoot?.();
    expect(root).toBeTruthy();
    if (!root) return;
    expect(await unmuteKeptAfter(h, root, 'k')).toBe(true);
  });

  it('without getMediaShortcutKeys, no key on <body> counts (default: none)', async () => {
    const h = await scopedHarness();
    expect(await unmuteKeptAfter(h, document.body, 'm')).toBe(false);
  });
});

describe('cap check when timers are throttled (D19)', () => {
  /** A clock that moves independently of timers, as in a throttled background tab. */
  async function throttledHarness() {
    let clock = 0;
    const h = await setup({ controller: { now: () => clock } });
    h.adapter.emit(adSnapshot());
    return {
      h,
      skip: (ms: number) => {
        clock += ms;
      },
    };
  }

  it('a timeupdate past the cap restores even though the cap timer never fired', async () => {
    const { h, skip } = await throttledHarness();
    skip(MAX_BOOSTED_MS - 1);
    h.video.advance(1);
    expect(phase(h)).toBe('BOOSTING');
    skip(1);
    h.video.advance(1);
    expect(phase(h)).toBe('IDLE');
    expect(h.video.playbackRate).toBe(1.5);
    expect(h.log.warn).toHaveBeenCalledWith(
      'detection-lost',
      expect.objectContaining({ cap: 'boosted' }),
    );
  });

  it('visibilitychange past the cap restores too', async () => {
    const { h, skip } = await throttledHarness();
    skip(MAX_BOOSTED_MS);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(phase(h)).toBe('IDLE');
  });
});
