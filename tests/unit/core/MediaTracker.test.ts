import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaTracker } from '../../../src/core/MediaTracker';
import { FakeAdapter } from '../helpers/FakeAdapter';
import { FakeVideo } from '../helpers/FakeVideo';

afterEach(() => {
  document.body.replaceChildren();
});

describe('MediaTracker', () => {
  it('binds the initial video on start and reports it', () => {
    const video = new FakeVideo();
    const tracker = new MediaTracker(new FakeAdapter(video.el), new AbortController().signal);
    const listener = vi.fn();
    tracker.onChange(listener);
    tracker.start();
    expect(tracker.current).toBe(video.el);
    expect(listener).toHaveBeenCalledWith(video.el, null);
  });

  it('aborts the old binding and notifies on a node change', () => {
    const a = new FakeVideo();
    const b = new FakeVideo();
    const adapter = new FakeAdapter(a.el);
    const tracker = new MediaTracker(adapter, new AbortController().signal);
    const listener = vi.fn();
    tracker.onChange(listener);
    tracker.start();
    const first = tracker.bindingSignal;
    adapter.setVideo(b.el);
    expect(first.aborted).toBe(true);
    expect(tracker.bindingSignal.aborted).toBe(false);
    expect(tracker.current).toBe(b.el);
    expect(listener).toHaveBeenLastCalledWith(b.el, a.el);
    adapter.setVideo(b.el); // same node: nothing happens
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('tears everything down when its signal aborts', () => {
    const adapter = new FakeAdapter(new FakeVideo().el);
    const lifetime = new AbortController();
    const tracker = new MediaTracker(adapter, lifetime.signal);
    const listener = vi.fn();
    const off = tracker.onChange(listener);
    tracker.start();
    tracker.start(); // idempotent
    lifetime.abort();
    expect(tracker.bindingSignal.aborted).toBe(true);
    expect(adapter.listenerCount).toBe(0);
    adapter.setVideo(new FakeVideo().el);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it('does not start on an aborted signal', () => {
    const lifetime = new AbortController();
    lifetime.abort();
    const tracker = new MediaTracker(new FakeAdapter(new FakeVideo().el), lifetime.signal);
    tracker.start();
    expect(tracker.current).toBeNull();
  });
});
