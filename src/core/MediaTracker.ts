import type { PlatformAdapter } from '../platforms/PlatformAdapter';
import { childController } from '../shared/dom';

/** The minimal adapter surface MediaTracker depends on (§3.6). */
export type VideoSource = Pick<PlatformAdapter, 'getVideoElement' | 'onVideoElementChange'>;

export type VideoChangeListener = (
  next: HTMLVideoElement | null,
  prev: HTMLVideoElement | null,
) => void;

/**
 * Follows the adapter's current `<video>`. Each binding gets its own AbortController, so
 * per-element listeners registered with `bindingSignal` are torn down when the node changes.
 */
export class MediaTracker {
  private video: HTMLVideoElement | null = null;
  private binding: AbortController;
  private readonly listeners = new Set<VideoChangeListener>();
  private started = false;

  constructor(
    private readonly source: VideoSource,
    private readonly signal: AbortSignal,
  ) {
    this.binding = childController(signal);
  }

  get current(): HTMLVideoElement | null {
    return this.video;
  }

  /** Aborted when the current binding changes or the tracker's signal aborts. */
  get bindingSignal(): AbortSignal {
    return this.binding.signal;
  }

  onChange(listener: VideoChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    if (this.started || this.signal.aborted) return;
    this.started = true;
    const unsubscribe = this.source.onVideoElementChange((v) => {
      this.update(v);
    });
    this.signal.addEventListener(
      'abort',
      () => {
        unsubscribe();
        this.listeners.clear();
      },
      { once: true },
    );
    this.update(this.source.getVideoElement());
  }

  private update(next: HTMLVideoElement | null): void {
    if (next === this.video || this.signal.aborted) return;
    const prev = this.video;
    this.binding.abort();
    this.binding = childController(this.signal);
    this.video = next;
    for (const listener of [...this.listeners]) listener(next, prev);
  }
}
