import type { Logger } from '../shared/logger';
import type { PlatformId, Settings } from '../shared/settings';
import type { AdSignal, AdStateSnapshot } from './signals';

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
 * debounce, which the engine owns per D8), coalesced re-evaluation and subscriber bookkeeping. Subclasses supply signals, the video element and
 * their watchers, and call `invalidate()` when something they watch changes.
 */
export abstract class BaseAdapter implements PlatformAdapter {
  abstract readonly id: PlatformId;
  abstract readonly displayName: string;

  abstract isWatchContext(url: URL): boolean;
  abstract getCapabilities(): AdapterCapabilities;

  protected abstract collectSignals(): AdSignal[];
  protected abstract findVideo(): HTMLVideoElement | null;
  protected abstract installWatchers(ctx: AdapterContext): void;

  init(_ctx: AdapterContext): Promise<void> {
    throw new Error('not implemented');
  }

  getVideoElement(): HTMLVideoElement | null {
    throw new Error('not implemented');
  }

  evaluateNow(): AdStateSnapshot {
    throw new Error('not implemented');
  }

  onSnapshot(_cb: (s: AdStateSnapshot) => void): () => void {
    throw new Error('not implemented');
  }

  onVideoElementChange(_cb: (v: HTMLVideoElement | null) => void): () => void {
    throw new Error('not implemented');
  }

  onNavigation(_cb: (url: URL) => void): () => void {
    throw new Error('not implemented');
  }

  destroy(): void {
    throw new Error('not implemented');
  }

  /** Schedules one `queueMicrotask` re-score, however many times it is called before then. */
  protected invalidate(): void {
    throw new Error('not implemented');
  }
}
