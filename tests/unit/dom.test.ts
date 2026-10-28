import { afterEach, describe, expect, it } from 'vitest';
import { childController, pickActiveVideo } from '../../src/shared/dom';
import { FakeVideo } from './helpers/FakeVideo';

afterEach(() => {
  document.body.replaceChildren();
});

function sized(video: FakeVideo, width: number, height: number): HTMLVideoElement {
  video.el.getBoundingClientRect = () => new DOMRect(0, 0, width, height);
  return video.el;
}

describe('childController', () => {
  it('aborts with its parent, and alone', () => {
    const parent = new AbortController();
    const a = childController(parent.signal);
    const b = childController(parent.signal);
    b.abort();
    expect(parent.signal.aborted).toBe(false);
    parent.abort('bye');
    expect(a.signal.aborted).toBe(true);
    expect(a.signal.reason).toBe('bye');
  });

  it('is born aborted under an aborted parent', () => {
    const parent = new AbortController();
    parent.abort();
    expect(childController(parent.signal).signal.aborted).toBe(true);
  });
});

describe('pickActiveVideo (§3.6)', () => {
  it('picks the largest connected video with readyState ≥ 2', () => {
    const small = sized(new FakeVideo(), 100, 100);
    const large = sized(new FakeVideo(), 1280, 720);
    const loading = sized(new FakeVideo({ readyState: 1 }), 1920, 1080);
    const detached = sized(new FakeVideo({ connected: false }), 4000, 4000);
    expect(pickActiveVideo([small, large, loading, detached])).toBe(large);
  });

  it('prefers videos inside the preferred root', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const inside = sized(new FakeVideo(), 640, 360);
    root.append(inside);
    const outside = sized(new FakeVideo(), 1280, 720);
    expect(pickActiveVideo([outside, inside], root)).toBe(inside);
    expect(pickActiveVideo([outside], root)).toBe(outside);
  });

  it('falls back to connected videos that are still loading', () => {
    const loading = sized(new FakeVideo({ readyState: 0 }), 640, 360);
    expect(pickActiveVideo([loading])).toBe(loading);
    expect(pickActiveVideo([])).toBeNull();
  });
});
