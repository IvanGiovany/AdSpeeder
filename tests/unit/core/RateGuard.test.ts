import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { RateGuard, type RateGuardHooks } from '../../../src/core/RateGuard';
import { RateProbe } from '../../../src/core/RateProbe';
import { VideoEngine } from '../../../src/core/VideoEngine';
import { FakeVideo, flushMicrotasks } from '../helpers/FakeVideo';
import { silentLogger } from '../helpers/logger';

let engine: VideoEngine;
let video: FakeVideo;
let userInput: boolean;
type VideoHook = Mock<(v: HTMLVideoElement) => void>;
let hooks: RateGuardHooks & {
  onContested: VideoHook;
  onUserOverride: VideoHook;
  reassert: VideoHook;
};
let guard: RateGuard;
let lifetime: AbortController;

beforeEach(() => {
  vi.useFakeTimers();
  engine = new VideoEngine(new RateProbe(), silentLogger());
  video = new FakeVideo();
  userInput = false;
  hooks = {
    target: (v) => engine.appliedRate(v),
    reassert: vi.fn<(v: HTMLVideoElement) => void>((v) => {
      engine.reassert(v);
    }),
    isRecentUserInput: () => userInput,
    onUserOverride: vi.fn<(v: HTMLVideoElement) => void>(),
    onContested: vi.fn<(v: HTMLVideoElement) => void>(),
  };
  guard = new RateGuard(hooks, undefined, () => Date.now());
  lifetime = new AbortController();
  engine.boost(video.el, { rate: 16, mute: true });
  guard.arm(video.el, lifetime.signal);
});

afterEach(() => {
  lifetime.abort();
  vi.useRealTimers();
  document.body.replaceChildren();
});

/** A site that resets the rate to 1 every time it changes away from 1 (a fighting page). */
function makeSiteFight(): void {
  video.el.addEventListener('ratechange', () => {
    if (video.playbackRate !== 1) video.siteSetsRate(1);
  });
}

describe('RateGuard', () => {
  it('ignores the echo of the engine’s own write', async () => {
    video.loadNewSource(); // rate → 1
    await flushMicrotasks();
    vi.advanceTimersByTime(0); // reassert → 16, whose ratechange is an echo
    await flushMicrotasks();
    vi.runAllTimers();
    expect(hooks.reassert).toHaveBeenCalledTimes(1);
    expect(video.playbackRate).toBe(16);
  });

  it('reasserts with backoff 0, 50, 100, 200, 400 ms', async () => {
    makeSiteFight();
    const times: number[] = [];
    hooks.reassert.mockImplementation((v: HTMLVideoElement) => {
      times.push(Date.now());
      engine.reassert(v);
    });
    const start = Date.now();
    video.siteSetsRate(1);
    for (let i = 0; i < 6; i++) {
      await flushMicrotasks();
      await vi.advanceTimersToNextTimerAsync();
    }
    const gaps = times.map((t, i) => t - (i === 0 ? start : (times[i - 1] ?? start)));
    expect(gaps.slice(0, 6)).toEqual([0, 50, 100, 200, 400, 400]);
  });

  it('ends a site reset loop in CONTESTED within the 10-per-5 s budget', async () => {
    makeSiteFight();
    video.siteSetsRate(1);
    for (let i = 0; i < 30 && hooks.onContested.mock.calls.length === 0; i++) {
      await flushMicrotasks();
      await vi.advanceTimersToNextTimerAsync();
    }
    expect(hooks.reassert).toHaveBeenCalledTimes(10);
    expect(hooks.onContested).toHaveBeenCalledOnce();
    expect(guard.armed).toBe(false);
    // Once contested it stops rewriting entirely.
    video.siteSetsRate(1);
    await flushMicrotasks();
    vi.runAllTimers();
    expect(hooks.reassert).toHaveBeenCalledTimes(10);
  });

  it('refills the budget after the 5 s window', async () => {
    let resets = 0;
    const resetOnce = async () => {
      video.siteSetsRate(1);
      resets++;
      await flushMicrotasks();
      await vi.advanceTimersToNextTimerAsync();
      await flushMicrotasks();
    };
    for (let i = 0; i < 10; i++) await resetOnce();
    vi.advanceTimersByTime(5000);
    await resetOnce();
    expect(resets).toBe(11);
    expect(hooks.onContested).not.toHaveBeenCalled();
    expect(hooks.reassert).toHaveBeenCalledTimes(11);
  });

  it('stands down when the user changed the speed', async () => {
    userInput = true;
    video.siteSetsRate(2);
    await flushMicrotasks();
    vi.runAllTimers();
    expect(hooks.onUserOverride).toHaveBeenCalledWith(video.el);
    expect(hooks.reassert).not.toHaveBeenCalled();
    expect(guard.armed).toBe(false);
  });

  it('coalesces resets while a rewrite is queued', async () => {
    video.siteSetsRate(1);
    await flushMicrotasks();
    // First reassert is queued with 0 ms; a second change before it runs adds nothing.
    video.siteSetsRate(2);
    await flushMicrotasks();
    vi.advanceTimersByTime(0);
    expect(hooks.reassert).toHaveBeenCalledTimes(1);
  });

  it('removes its listener on disarm and when the signal aborts', async () => {
    guard.disarm();
    video.siteSetsRate(1);
    await flushMicrotasks();
    vi.runAllTimers();
    expect(hooks.reassert).not.toHaveBeenCalled();

    guard.arm(video.el, lifetime.signal);
    lifetime.abort();
    expect(guard.armed).toBe(false);
    video.siteSetsRate(3);
    await flushMicrotasks();
    vi.runAllTimers();
    expect(hooks.reassert).not.toHaveBeenCalled();
  });

  it('does not arm on an aborted signal', () => {
    lifetime.abort();
    guard.arm(video.el, lifetime.signal);
    expect(guard.armed).toBe(false);
  });
});
