import type { Logger } from '../shared/logger';
import type { PlatformId, Settings } from '../shared/settings';
import {
  DEFAULT_THRESHOLDS,
  EMPTY_SNAPSHOT,
  sameSnapshot,
  scoreSignals,
  type AdSignal,
  type AdStateSnapshot,
} from './signals';

export type { PlatformId };

/** Ordered fallback list of CSS selectors; only `platforms/<id>/selectors.ts` defines them. */
export type SelectorChain = readonly string[];

export interface AdapterCapabilities {
  allowRateBoost: boolean; // false for live streams
  allowMute: boolean;
  rateEnforcement: 'none' | 'guard';
  maxRateHint?: number; // platform-known ceiling below the browser's
}

export interface AdapterContext {
  settings: Readonly<Settings>;
  log: Logger;
  signal: AbortSignal; // aborted on teardown; all listeners use it
}

/** Selector health for logs (rate-contested, detection-lost, selector-drift). */
export interface AdapterDiagnostics {
  selectorsVersion: string;
  /** Chain name → index of the selector that last matched; > 0 means a fallback was used. */
  chainIndices: Record<string, number>;
}

export interface PlatformAdapter {
  readonly id: PlatformId;
  readonly displayName: string;
  init(ctx: AdapterContext): Promise<void>;
  isWatchContext(url: URL): boolean; // false on home/search/shorts etc.
  getVideoElement(): HTMLVideoElement | null;
  getCapabilities(): AdapterCapabilities;
  evaluateNow(): AdStateSnapshot; // synchronous re-score
  onSnapshot(cb: (s: AdStateSnapshot) => void): () => void;
  onVideoElementChange(cb: (v: HTMLVideoElement | null) => void): () => void;
  onNavigation(cb: (url: URL) => void): () => void;
  destroy(): void;
  /** D14: element that scopes trusted-input detection (e.g. the player root); null → document. */
  getInteractionRoot?(): Element | null;
  /**
   * Keys (`KeyboardEvent.key`) that are page-wide media shortcuts: a trusted keydown on
   * <body>/<html> with one of these counts as user input even outside the interaction root.
   * Default: none.
   */
  getMediaShortcutKeys?(): readonly string[];
  getDiagnostics?(): AdapterDiagnostics;
}

/**
 * Implements everything except platform facts (§2.1): raw scoring (no hysteresis or exit
 * debounce, which the engine owns per D8), coalesced re-evaluation and subscriber bookkeeping.
 * Subclasses supply signals, the video element and their watchers, and call `invalidate()`
 * when something they watch changes, and `reportNavigation()` when the URL may have changed.
 */
export abstract class BaseAdapter implements PlatformAdapter {
  abstract readonly id: PlatformId;
  abstract readonly displayName: string;

  abstract isWatchContext(url: URL): boolean;
  abstract getCapabilities(): AdapterCapabilities;

  protected abstract collectSignals(): AdSignal[];
  protected abstract findVideo(): HTMLVideoElement | null;
  protected abstract installWatchers(ctx: AdapterContext): void;

  protected ctx: AdapterContext | null = null;
  /** Counts re-scores, so tests can check that bursts are coalesced (Phase 6). */
  protected evaluations = 0;
  private readonly snapshotListeners = new Set<(s: AdStateSnapshot) => void>();
  private readonly videoListeners = new Set<(v: HTMLVideoElement | null) => void>();
  private readonly navigationListeners = new Set<(url: URL) => void>();
  private video: HTMLVideoElement | null = null;
  private last: AdStateSnapshot = EMPTY_SNAPSHOT;
  private scheduled = false;
  private lastUrl: string | null = null;
  private destroyed = false;

  init(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    this.lastUrl = location.href;
    this.installWatchers(ctx);
    this.refreshVideo();
    this.last = this.score();
    return Promise.resolve();
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.video;
  }

  /** Synchronous re-score; also becomes the baseline for change detection. */
  evaluateNow(): AdStateSnapshot {
    this.last = this.score();
    return this.last;
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
    this.snapshotListeners.clear();
    this.videoListeners.clear();
    this.navigationListeners.clear();
  }

  /**
   * Schedules one `queueMicrotask` re-score however many times it is called before then, so a
   * burst of mutations costs one evaluation. Emits only when the snapshot actually changed.
   */
  protected invalidate(): void {
    if (this.scheduled || this.destroyed) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.destroyed || this.ctx?.signal.aborted) return;
      this.refreshVideo();
      const next = this.score();
      if (sameSnapshot(next, this.last)) return;
      this.last = next;
      for (const cb of [...this.snapshotListeners]) cb(next);
    });
  }

  /** Emits onNavigation once per distinct URL (§2.3). */
  protected reportNavigation(): void {
    if (this.destroyed || location.href === this.lastUrl) return;
    this.lastUrl = location.href;
    const url = new URL(location.href);
    for (const cb of [...this.navigationListeners]) cb(url);
    this.invalidate();
  }

  /** Hook for subclasses to add platform fields (e.g. ssaiSuspected) or rewrite the score. */
  protected decorate(snapshot: AdStateSnapshot, _signals: readonly AdSignal[]): AdStateSnapshot {
    return snapshot;
  }

  /** Hook for subclasses to bind per-element listeners when the video changes. */
  protected onVideoChanged(_video: HTMLVideoElement | null): void {
    // default: nothing to bind
  }

  protected refreshVideo(): void {
    const video = this.findVideo();
    if (video === this.video) return;
    this.video = video;
    this.onVideoChanged(video);
    for (const cb of [...this.videoListeners]) cb(video);
  }

  private score(): AdStateSnapshot {
    this.evaluations += 1;
    const signals = this.collectSignals();
    const { confidence, kind, pod, reasons } = scoreSignals(signals);
    const snapshot: AdStateSnapshot = {
      // Informational only; the engine applies its own thresholds (D8).
      active: confidence >= DEFAULT_THRESHOLDS.enterThreshold,
      kind,
      confidence,
      reasons,
      ...(pod && { pod }),
    };
    return this.decorate(snapshot, signals);
  }
}

function subscribe<T>(set: Set<T>, cb: T): () => void {
  set.add(cb);
  return () => {
    set.delete(cb);
  };
}
