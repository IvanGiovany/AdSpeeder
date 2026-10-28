import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  childController,
  debounce,
  observeAttr,
  pickActiveVideo,
  queryAllChain,
  queryChain,
  throttle,
  waitForElement,
} from '../../src/shared/dom';
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

describe('queryChain / queryAllChain', () => {
  it('returns the first match and its chain index, skipping invalid selectors', () => {
    document.body.innerHTML = '<div class="b"></div><div class="b"></div>';
    expect(queryChain(document, ['.a', '::bad(', '.b'])?.index).toBe(2);
    expect(queryChain(document, ['.a'])).toBeNull();
    expect(queryAllChain(document, ['.a', '[', '.b'])).toMatchObject({ index: 2 });
    expect(queryAllChain(document, ['.b'])?.elements).toHaveLength(2);
    expect(queryAllChain(document, ['.a'])).toBeNull();
  });
});

describe('waitForElement', () => {
  it('resolves at once when present, later when inserted, null on abort', async () => {
    document.body.innerHTML = '<p id="now"></p>';
    const lifetime = new AbortController();
    await expect(waitForElement(['#now'], { signal: lifetime.signal })).resolves.toMatchObject({
      index: 0,
    });
    const later = waitForElement(['#missing', '#later'], { signal: lifetime.signal });
    document.body.append(Object.assign(document.createElement('p'), { id: 'later' }));
    await expect(later).resolves.toMatchObject({ index: 1 });
    const never = waitForElement(['#never'], { signal: lifetime.signal });
    lifetime.abort();
    await expect(never).resolves.toBeNull();
  });
});

describe('observeAttr', () => {
  it('reports watched attribute changes until aborted', async () => {
    const el = document.body.appendChild(document.createElement('div'));
    const seen: string[] = [];
    const lifetime = new AbortController();
    observeAttr(
      el,
      ['class'],
      (records) => seen.push(...records.map((r) => r.attributeName ?? '')),
      lifetime.signal,
    );
    el.className = 'x';
    el.title = 'ignored';
    await new Promise((r) => setTimeout(r, 0));
    lifetime.abort();
    el.className = 'y';
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(['class']);
  });
});

describe('debounce / throttle', () => {
  it('debounce calls once after calls stop, and never after abort', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const lifetime = new AbortController();
    const d = debounce(fn, 100, lifetime.signal);
    d(1);
    d(2);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledExactlyOnceWith(2);
    d(3);
    lifetime.abort();
    vi.advanceTimersByTime(100);
    d(4);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('throttle calls on the leading edge and once on the trailing edge', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const lifetime = new AbortController();
    const t = throttle(fn, 100, lifetime.signal);
    t();
    t();
    t();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    t();
    lifetime.abort();
    vi.advanceTimersByTime(100);
    t();
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
