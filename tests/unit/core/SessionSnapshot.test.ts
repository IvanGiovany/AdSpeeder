import { describe, expect, it } from 'vitest';
import {
  BOOST_MARKER_ATTR,
  captureSnapshot,
  parseMarker,
  SnapshotStore,
  type MediaSnapshot,
} from '../../../src/core/SessionSnapshot';
import { FakeVideo } from '../helpers/FakeVideo';

const snapshot: MediaSnapshot = {
  playbackRate: 1.5,
  defaultPlaybackRate: 1,
  muted: false,
  volume: 0.4,
  preservesPitch: true,
  takenAt: 123,
};

describe('captureSnapshot', () => {
  it('reads state without writing', () => {
    const video = new FakeVideo({ playbackRate: 1.5, muted: true, volume: 0.3 });
    expect(captureSnapshot(video.el, 7)).toEqual({
      playbackRate: 1.5,
      defaultPlaybackRate: 1,
      muted: true,
      volume: 0.3,
      preservesPitch: true,
      takenAt: 7,
    });
    expect(video.rateWrites).toEqual([]);
    expect(video.mutedWrites).toEqual([]);
  });

  it('defaults preservesPitch to true where unsupported', () => {
    const el = document.createElement('video');
    Object.defineProperty(el, 'preservesPitch', { value: undefined });
    expect(captureSnapshot(el).preservesPitch).toBe(true);
  });
});

describe('parseMarker', () => {
  it('round-trips a snapshot', () => {
    expect(parseMarker(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it.each([
    undefined,
    'not json',
    'null',
    '[]',
    JSON.stringify({ ...snapshot, playbackRate: 0 }),
    JSON.stringify({ ...snapshot, muted: 'no' }),
    JSON.stringify({ ...snapshot, volume: 2 }),
    JSON.stringify({ ...snapshot, takenAt: undefined }),
  ])('rejects %j', (raw) => {
    expect(parseMarker(raw)).toBeNull();
  });
});

describe('SnapshotStore', () => {
  it('mirrors snapshots to the crash marker and clears both', () => {
    const store = new SnapshotStore();
    const v = new FakeVideo().el;
    store.set(v, snapshot);
    expect(store.get(v)).toEqual(snapshot);
    expect(v.getAttribute(BOOST_MARKER_ATTR)).toBe(JSON.stringify(snapshot));
    store.delete(v);
    expect(store.get(v)).toBeNull();
    expect(v.hasAttribute(BOOST_MARKER_ATTR)).toBe(false);
  });

  it('falls back to the crash marker written by another instance', () => {
    const v = new FakeVideo().el;
    new SnapshotStore().set(v, snapshot);
    expect(new SnapshotStore().get(v)).toEqual(snapshot);
  });
});
