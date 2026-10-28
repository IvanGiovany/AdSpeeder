export type SegmentKind = 'ad' | 'promo' | 'recap' | 'intro';

export interface PodInfo {
  index: number;
  total: number;
}

export interface AdSignal {
  source: string; // e.g. 'yt.playerClass.ad-showing'
  active: boolean; // does this source currently indicate a segment?
  weight: number; // 0..1 contribution when active
  kind: SegmentKind;
  pod?: PodInfo;
  skippable?: boolean;
  at: number; // performance.now()
}

export interface AdStateSnapshot {
  active: boolean; // after hysteresis
  kind: SegmentKind | null;
  confidence: number; // summed weight of active signals, capped at 1
  pod?: PodInfo;
  reasons: string[]; // sources that fired, for debug overlay + logs
}

/** Per-adapter hysteresis constants (§2.1); overridable from the options debug panel. */
export interface Thresholds {
  enterThreshold: number;
  exitThreshold: number;
  exitDebounceMs: number;
}

export const DEFAULT_THRESHOLDS: Readonly<Thresholds> = {
  enterThreshold: 0.6,
  exitThreshold: 0.2,
  exitDebounceMs: 300,
};

export interface SignalScore {
  confidence: number;
  kind: SegmentKind | null;
  pod?: PodInfo;
  reasons: string[];
}

/** `confidence = min(1, Σ weight of active signals)` plus the dominant kind and pod info. */
export function scoreSignals(_signals: readonly AdSignal[]): SignalScore {
  throw new Error('not implemented');
}
