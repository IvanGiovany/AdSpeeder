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

/**
 * Raw detection state (D8): no hysteresis or delay. The engine owns enter/exit thresholds and
 * exit debouncing.
 */
export interface AdStateSnapshot {
  active: boolean; // confidence ≥ DEFAULT_THRESHOLDS.enterThreshold, informational (D8)
  kind: SegmentKind | null;
  confidence: number; // summed weight of active signals, capped at 1
  pod?: PodInfo;
  reasons: string[]; // sources that fired, for debug overlay + logs
  /** §2.3 SSAI rule: the engine shortens its exit debounce to 100 ms (§3.4, D7). */
  ssaiSuspected?: boolean;
}

/**
 * Hysteresis constants, owned by the engine (D8) and overridable from the options debug panel.
 * Adapters only use `enterThreshold` to fill the informational `active` flag.
 */
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

/** Tie-break order when two kinds carry the same weight: an ad always wins. */
const KIND_PRIORITY: readonly SegmentKind[] = ['ad', 'promo', 'recap', 'intro'];

/**
 * `confidence = min(1, Σ weight of active signals)` (§2.1), plus the kind with the most active
 * weight, the first pod info and the sources that fired. Raw: no hysteresis (D8).
 */
export function scoreSignals(signals: readonly AdSignal[]): SignalScore {
  const active = signals.filter((s) => s.active && s.weight > 0);
  const total = active.reduce((sum, s) => sum + s.weight, 0);
  // Rounded so 0.1 + 0.2 style float noise can't flip a threshold comparison.
  const confidence = Math.min(1, Math.round(total * 1e6) / 1e6);
  const byKind = new Map<SegmentKind, number>();
  for (const s of active) byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + s.weight);
  let kind: SegmentKind | null = null;
  for (const candidate of KIND_PRIORITY) {
    const weight = byKind.get(candidate) ?? 0;
    if (weight > 0 && (kind === null || weight > (byKind.get(kind) ?? 0))) kind = candidate;
  }
  const pod = active.find((s) => s.pod)?.pod;
  return { confidence, kind, reasons: active.map((s) => s.source), ...(pod && { pod }) };
}

export const EMPTY_SNAPSHOT: AdStateSnapshot = {
  active: false,
  kind: null,
  confidence: 0,
  reasons: [],
};

export function sameSnapshot(a: AdStateSnapshot, b: AdStateSnapshot): boolean {
  return (
    a.active === b.active &&
    a.kind === b.kind &&
    a.confidence === b.confidence &&
    a.pod?.index === b.pod?.index &&
    a.pod?.total === b.pod?.total &&
    a.ssaiSuspected === b.ssaiSuspected &&
    a.reasons.join() === b.reasons.join()
  );
}
