import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateProbe } from '../../../src/core/RateProbe';
import { BOOST_MARKER_ATTR } from '../../../src/core/SessionSnapshot';
import { VERIFY_DELAY_MS, VideoEngine } from '../../../src/core/VideoEngine';
import { FakeVideo } from '../helpers/FakeVideo';
import { silentLogger } from '../helpers/logger';

let probe: RateProbe;
let engine: VideoEngine;

beforeEach(() => {
  vi.useFakeTimers();
  probe = new RateProbe();
  engine = new VideoEngine(probe, silentLogger());
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('boost', () => {
  it('mutes and applies the highest accepted rate', () => {
    const video = new FakeVideo();
    expect(engine.boost(video.el, { rate: 16, mute: true })).toBe(16);
    expect(video.playbackRate).toBe(16);
    expect(video.muted).toBe(true);
    expect(engine.isBoosted(video.el)).toBe(true);
    expect(video.el.hasAttribute(BOOST_MARKER_ATTR)).toBe(true);
  });

  it('honours a requested rate below the ceiling', () => {
    const video = new FakeVideo();
    expect(engine.boost(video.el, { rate: 4, mute: false })).toBe(4);
    expect(video.muted).toBe(false);
  });

  it('steps down the ladder on NotSupportedError', () => {
    const video = new FakeVideo({ maxRate: 5 });
    expect(engine.boost(video.el, { rate: 16, mute: true })).toBe(4);
    expect(video.rateWrites).toEqual([16, 8, 4]);
    expect(probe.maxFor(video.el)).toBe(4);
  });

  it('treats a silently capped read-back as a rejection and retries until it sticks (D5)', () => {
    const video = new FakeVideo({ capRate: 10 });
    expect(engine.boost(video.el, { rate: 16, mute: true })).toBe(8);
    expect(video.playbackRate).toBe(8);
    expect(probe.maxFor(video.el)).toBe(8);
  });

  it('lowers below a rejected non-ladder rate', () => {
    const video = new FakeVideo({ maxRate: 2.5 });
    expect(engine.boost(video.el, { rate: 3, mute: false })).toBe(2);
  });

  it('leaves the rate alone when nothing on the ladder is accepted', () => {
    const video = new FakeVideo({ maxRate: 1.5 });
    expect(engine.boost(video.el, { rate: 16, mute: true })).toBeNull();
    expect(video.muted).toBe(true);
    expect(engine.appliedRate(video.el)).toBeNull();
  });

  it('mute-only boost (rate null) never writes the rate', () => {
    const video = new FakeVideo({ playbackRate: 1.25 });
    expect(engine.boost(video.el, { rate: null, mute: true })).toBeNull();
    expect(video.rateWrites).toEqual([]);
    expect(video.muted).toBe(true);
  });

  it('never takes a snapshot while already boosted', () => {
    const video = new FakeVideo({ playbackRate: 1.5 });
    engine.boost(video.el, { rate: 16, mute: true });
    engine.boost(video.el, { rate: 8, mute: true });
    engine.restore(video.el);
    expect(video.playbackRate).toBe(1.5);
    expect(video.muted).toBe(false);
  });

  it('gives back mute and rate when settings drop them mid-segment', () => {
    const video = new FakeVideo({ playbackRate: 1.5 });
    engine.boost(video.el, { rate: 16, mute: true });
    engine.boost(video.el, { rate: null, mute: false });
    expect(video.muted).toBe(false);
    expect(video.playbackRate).toBe(1.5);
  });
});

describe('reassert', () => {
  it('re-applies the rate after the load algorithm resets it', () => {
    const video = new FakeVideo();
    engine.boost(video.el, { rate: 16, mute: true });
    video.loadNewSource();
    expect(video.playbackRate).toBe(1);
    engine.reassert(video.el);
    expect(video.playbackRate).toBe(16);
  });

  it('can re-mute without touching the rate', () => {
    const video = new FakeVideo();
    engine.boost(video.el, { rate: 16, mute: true });
    video.siteSetsRate(1);
    video.setMuted(false);
    engine.reassert(video.el, { rate: false });
    expect(video.muted).toBe(true);
    expect(video.playbackRate).toBe(1);
  });

  it('does nothing for an element that is not boosted', () => {
    const video = new FakeVideo();
    engine.reassert(video.el);
    expect(video.rateWrites).toEqual([]);
  });
});

describe('restore', () => {
  it('returns to 1.5x when the user was at 1.5x', () => {
    const video = new FakeVideo({ playbackRate: 1.5 });
    engine.boost(video.el, { rate: 16, mute: true });
    expect(engine.restore(video.el)).toBe(true);
    expect(video.playbackRate).toBe(1.5);
    expect(video.muted).toBe(false);
    expect(engine.isBoosted(video.el)).toBe(false);
    expect(video.el.hasAttribute(BOOST_MARKER_ATTR)).toBe(false);
  });

  it('keeps a user who was already muted muted', () => {
    const video = new FakeVideo({ muted: true });
    engine.boost(video.el, { rate: 16, mute: true });
    engine.restore(video.el);
    expect(video.muted).toBe(true);
  });

  it('is idempotent and accepts null', () => {
    const video = new FakeVideo({ playbackRate: 1.5 });
    engine.boost(video.el, { rate: 16, mute: true });
    expect(engine.restore(video.el)).toBe(true);
    expect(engine.restore(video.el)).toBe(false);
    expect(engine.restore(null)).toBe(false);
    expect(video.playbackRate).toBe(1.5);
  });

  it('does not throw on a detached element', () => {
    const video = new FakeVideo({ playbackRate: 1.5 });
    engine.boost(video.el, { rate: 16, mute: true });
    video.detach();
    expect(() => engine.restore(video.el)).not.toThrow();
    expect(video.playbackRate).toBe(1.5);
  });

  it('does not throw when every write throws', () => {
    const video = new FakeVideo();
    engine.boost(video.el, { rate: 16, mute: true });
    for (const prop of ['playbackRate', 'defaultPlaybackRate', 'muted', 'preservesPitch']) {
      Object.defineProperty(video.el, prop, {
        get: () => 1,
        set: () => {
          throw new Error('boom');
        },
      });
    }
    expect(() => engine.restore(video.el)).not.toThrow();
    expect(video.el.hasAttribute(BOOST_MARKER_ATTR)).toBe(false); // D12
  });

  it('drops an unreadable crash marker (D12)', () => {
    const video = new FakeVideo();
    video.el.setAttribute(BOOST_MARKER_ATTR, '{not json');
    expect(engine.restore(video.el)).toBe(false);
    expect(video.el.hasAttribute(BOOST_MARKER_ATTR)).toBe(false);
    expect(video.rateWrites).toEqual([]);
  });

  it('clears user overrides on restore, so the next segment is muted again (D11)', () => {
    const video = new FakeVideo();
    engine.boost(video.el, { rate: 16, mute: true });
    video.setMuted(false);
    engine.markUserOverride(video.el, 'mute');
    engine.restore(video.el);
    engine.boost(video.el, { rate: 16, mute: true });
    expect(engine.hasUserOverride(video.el, 'mute')).toBe(false);
    expect(video.muted).toBe(true);
  });

  it('restores from the crash marker alone (new engine instance)', () => {
    const video = new FakeVideo({ playbackRate: 1.25 });
    engine.boost(video.el, { rate: 16, mute: true });
    const fresh = new VideoEngine(new RateProbe(), silentLogger());
    expect(fresh.restore(video.el)).toBe(true);
    expect(video.playbackRate).toBe(1.25);
    expect(video.muted).toBe(false);
  });

  it('leaves a user unmute and speed change as the user set them (§3.3)', () => {
    const video = new FakeVideo({ playbackRate: 1.5 });
    engine.boost(video.el, { rate: 16, mute: true });
    video.setMuted(false);
    engine.markUserOverride(video.el, 'mute');
    video.siteSetsRate(2);
    engine.markUserOverride(video.el, 'rate');
    expect(engine.hasUserOverride(video.el, 'rate')).toBe(true);
    engine.reassert(video.el);
    expect(video.muted).toBe(false);
    expect(video.playbackRate).toBe(2);
    engine.restore(video.el);
    expect(video.muted).toBe(false);
    expect(video.playbackRate).toBe(2);
  });
});

describe('restore verification (500 ms)', () => {
  function boostAndRestore(userRate: number) {
    const video = new FakeVideo({ playbackRate: userRate });
    engine.boost(video.el, { rate: 16, mute: true });
    engine.restore(video.el);
    return video;
  }

  it('rewrites the snapshot rate when the site reset it to 1.0', () => {
    const video = boostAndRestore(1.5);
    video.siteSetsRate(1);
    vi.advanceTimersByTime(VERIFY_DELAY_MS);
    expect(video.playbackRate).toBe(1.5);
  });

  it("accepts the site's own saved speed when it differs from the snapshot and 1.0", () => {
    const video = boostAndRestore(1.5);
    video.siteSetsRate(1.75);
    vi.advanceTimersByTime(VERIFY_DELAY_MS);
    expect(video.playbackRate).toBe(1.75);
  });

  it('rewrites the snapshot rate if our boost rate leaked back', () => {
    const video = boostAndRestore(1.5);
    video.siteSetsRate(16);
    vi.advanceTimersByTime(VERIFY_DELAY_MS);
    expect(video.playbackRate).toBe(1.5);
  });

  it('is cancelled by a new boost on the same element', () => {
    const video = boostAndRestore(1.5);
    engine.boost(video.el, { rate: 16, mute: true });
    vi.advanceTimersByTime(VERIFY_DELAY_MS);
    expect(video.playbackRate).toBe(16);
  });
});

describe('transfer', () => {
  it('restores the old node, moves the snapshot and boosts the new node', () => {
    const oldVideo = new FakeVideo({ playbackRate: 1.5 });
    const newVideo = new FakeVideo();
    engine.boost(oldVideo.el, { rate: 16, mute: true });
    engine.transfer(oldVideo.el, newVideo.el);
    expect(oldVideo.playbackRate).toBe(1.5);
    expect(oldVideo.muted).toBe(false);
    expect(engine.isBoosted(oldVideo.el)).toBe(false);
    expect(newVideo.playbackRate).toBe(16);
    expect(newVideo.muted).toBe(true);
    engine.restore(newVideo.el);
    expect(newVideo.playbackRate).toBe(1.5); // the user's state, not the new node's default
  });

  it('skips restoring a detached old node', () => {
    const oldVideo = new FakeVideo({ playbackRate: 1.5 });
    const newVideo = new FakeVideo();
    engine.boost(oldVideo.el, { rate: 16, mute: true });
    oldVideo.detach();
    engine.transfer(oldVideo.el, newVideo.el);
    expect(oldVideo.playbackRate).toBe(16);
    expect(engine.isBoosted(newVideo.el)).toBe(true);
  });

  it('is a no-op for an unboosted or identical source', () => {
    const a = new FakeVideo();
    const b = new FakeVideo();
    engine.transfer(a.el, b.el);
    expect(engine.isBoosted(b.el)).toBe(false);
    engine.boost(a.el, { rate: 16, mute: true });
    engine.transfer(a.el, a.el);
    expect(engine.isBoosted(a.el)).toBe(true);
  });
});
