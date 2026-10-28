export interface FakeVideoOptions {
  playbackRate?: number;
  defaultPlaybackRate?: number;
  muted?: boolean;
  volume?: number;
  preservesPitch?: boolean;
  readyState?: number;
  /** Rates above this throw NotSupportedError (like the HTML spec allows). */
  maxRate?: number;
  /** Rates above this are silently capped to it (the read-back differs). */
  capRate?: number;
  /** Append to document.body (default true). */
  connected?: boolean;
}

/**
 * A real <video> element whose media properties are replaced with a scripted model:
 * playbackRate can throw or silently cap, and ratechange/volumechange fire asynchronously
 * (on a microtask) only when the value actually changes, like browsers do.
 */
export class FakeVideo {
  readonly el: HTMLVideoElement;
  /** Every playbackRate assignment, including rejected ones. */
  readonly rateWrites: number[] = [];
  readonly mutedWrites: boolean[] = [];
  maxRate: number;
  capRate: number;
  private state: {
    playbackRate: number;
    defaultPlaybackRate: number;
    muted: boolean;
    volume: number;
    preservesPitch: boolean;
    currentTime: number;
    readyState: number;
  };

  constructor(options: FakeVideoOptions = {}) {
    this.maxRate = options.maxRate ?? Number.POSITIVE_INFINITY;
    this.capRate = options.capRate ?? Number.POSITIVE_INFINITY;
    this.state = {
      playbackRate: options.playbackRate ?? 1,
      defaultPlaybackRate: options.defaultPlaybackRate ?? 1,
      muted: options.muted ?? false,
      volume: options.volume ?? 1,
      preservesPitch: options.preservesPitch ?? true,
      currentTime: 0,
      readyState: options.readyState ?? 4,
    };
    const el = document.createElement('video');
    const state = this.state;
    const fire = (type: string) => {
      queueMicrotask(() => el.dispatchEvent(new Event(type)));
    };
    Object.defineProperties(el, {
      playbackRate: {
        configurable: true,
        get: () => state.playbackRate,
        set: (rate: number) => {
          this.rateWrites.push(rate);
          if (rate > this.maxRate) {
            throw new DOMException(`rate ${String(rate)} unsupported`, 'NotSupportedError');
          }
          const applied = Math.min(rate, this.capRate);
          if (applied !== state.playbackRate) {
            state.playbackRate = applied;
            fire('ratechange');
          }
        },
      },
      defaultPlaybackRate: {
        configurable: true,
        get: () => state.defaultPlaybackRate,
        set: (rate: number) => {
          state.defaultPlaybackRate = rate;
        },
      },
      muted: {
        configurable: true,
        get: () => state.muted,
        set: (muted: boolean) => {
          this.mutedWrites.push(muted);
          if (muted !== state.muted) {
            state.muted = muted;
            fire('volumechange');
          }
        },
      },
      volume: {
        configurable: true,
        get: () => state.volume,
        set: () => {
          throw new Error('volume must never be written');
        },
      },
      preservesPitch: {
        configurable: true,
        get: () => state.preservesPitch,
        set: (value: boolean) => {
          state.preservesPitch = value;
        },
      },
      currentTime: {
        configurable: true,
        get: () => state.currentTime,
        set: (t: number) => {
          state.currentTime = t;
        },
      },
      readyState: { configurable: true, get: () => state.readyState },
    });
    this.el = el;
    if (options.connected !== false) document.body.append(el);
  }

  get playbackRate(): number {
    return this.state.playbackRate;
  }

  get muted(): boolean {
    return this.state.muted;
  }

  /** The site (not the engine) changes the rate, e.g. YouTube resetting it. */
  siteSetsRate(rate: number): void {
    this.el.playbackRate = rate;
  }

  /** Simulates the media load algorithm: rate drops to defaultPlaybackRate. */
  loadNewSource(): void {
    this.el.playbackRate = this.state.defaultPlaybackRate;
    this.el.dispatchEvent(new Event('loadedmetadata'));
  }

  setMuted(muted: boolean): void {
    this.el.muted = muted;
  }

  /** Advances media time and fires timeupdate synchronously. */
  advance(seconds: number): void {
    this.state.currentTime += seconds;
    this.el.dispatchEvent(new Event('timeupdate'));
  }

  detach(): void {
    this.el.remove();
  }
}

/** Lets queued microtasks (async media events) run. */
export async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
