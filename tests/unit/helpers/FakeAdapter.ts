import type {
  AdapterCapabilities,
  AdapterContext,
  PlatformAdapter,
} from '../../../src/platforms/PlatformAdapter';
import type { AdStateSnapshot, PodInfo, SegmentKind } from '../../../src/platforms/signals';

export const IDLE_SNAPSHOT: AdStateSnapshot = {
  active: false,
  kind: null,
  confidence: 0,
  reasons: [],
};

export function adSnapshot(
  options: { pod?: PodInfo; kind?: SegmentKind; ssaiSuspected?: boolean } = {},
): AdStateSnapshot {
  return {
    active: true,
    kind: options.kind ?? 'ad',
    confidence: 0.9,
    reasons: ['fake.ad'],
    ...(options.pod && { pod: options.pod }),
    ...(options.ssaiSuspected !== undefined && { ssaiSuspected: options.ssaiSuspected }),
  };
}

/**
 * Adapter's own hysteresis still says "active" but confidence has dropped: the class flicker
 * between pod ads (§2.1, §3.4).
 */
export function flickerSnapshot(): AdStateSnapshot {
  return { active: true, kind: 'ad', confidence: 0, reasons: [] };
}

/** A scriptable PlatformAdapter: tests push snapshots, videos and navigations into it. */
export class FakeAdapter implements PlatformAdapter {
  readonly id = 'youtube';
  readonly displayName = 'Fake';
  capabilities: AdapterCapabilities = {
    allowRateBoost: true,
    allowMute: true,
    rateEnforcement: 'guard',
  };
  watchContext = true;
  ctx: AdapterContext | null = null;
  destroyed = false;
  private snapshot: AdStateSnapshot = IDLE_SNAPSHOT;
  private video: HTMLVideoElement | null;
  private readonly snapshotListeners = new Set<(s: AdStateSnapshot) => void>();
  private readonly videoListeners = new Set<(v: HTMLVideoElement | null) => void>();
  private readonly navigationListeners = new Set<(url: URL) => void>();

  constructor(video: HTMLVideoElement | null = null) {
    this.video = video;
  }

  init(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    return Promise.resolve();
  }

  isWatchContext(): boolean {
    return this.watchContext;
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.video;
  }

  getCapabilities(): AdapterCapabilities {
    return this.capabilities;
  }

  evaluateNow(): AdStateSnapshot {
    return this.snapshot;
  }

  onSnapshot(cb: (s: AdStateSnapshot) => void): () => void {
    return subscribe(this.snapshotListeners, cb);
  }

  onVideoElementChange(cb: (v: HTMLVideoElement | null) => void): () => void {
    return subscribe(this.videoListeners, cb);
  }

  onNavigation(cb: (url: URL) => void): () => void {
    return subscribe(this.navigationListeners, cb);
  }

  destroy(): void {
    this.destroyed = true;
  }

  get listenerCount(): number {
    return this.snapshotListeners.size + this.videoListeners.size + this.navigationListeners.size;
  }

  emit(snapshot: AdStateSnapshot): void {
    this.snapshot = snapshot;
    for (const cb of [...this.snapshotListeners]) cb(snapshot);
  }

  setVideo(video: HTMLVideoElement | null): void {
    this.video = video;
    for (const cb of [...this.videoListeners]) cb(video);
  }

  navigate(url: string): void {
    for (const cb of [...this.navigationListeners]) cb(new URL(url));
  }
}

function subscribe<T>(set: Set<T>, cb: T): () => void {
  set.add(cb);
  return () => {
    set.delete(cb);
  };
}
