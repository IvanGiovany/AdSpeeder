import { describe, expect, it } from 'vitest';
import {
  EMPTY_SNAPSHOT,
  sameSnapshot,
  scoreSignals,
  type AdSignal,
} from '../../src/platforms/signals';

const sig = (source: string, weight: number, extra: Partial<AdSignal> = {}): AdSignal => ({
  source,
  active: true,
  weight,
  kind: 'ad',
  at: 0,
  ...extra,
});

describe('scoreSignals (§2.1)', () => {
  it('sums active weights, capped at 1', () => {
    expect(scoreSignals([sig('a', 0.6), sig('b', 0.3)]).confidence).toBe(0.9);
    expect(scoreSignals([sig('a', 0.6), sig('b', 0.6)]).confidence).toBe(1);
    expect(scoreSignals([sig('a', 0.6, { active: false }), sig('b', 0.3)]).confidence).toBe(0.3);
    expect(scoreSignals([]).confidence).toBe(0);
  });

  it('rounds away float noise so thresholds compare cleanly', () => {
    expect(scoreSignals([sig('a', 0.1), sig('b', 0.2)]).confidence).toBe(0.3);
  });

  it('reports the sources that fired and the first pod', () => {
    const score = scoreSignals([
      sig('off', 0.5, { active: false, pod: { index: 9, total: 9 } }),
      sig('a', 0.3, { pod: { index: 1, total: 2 } }),
      sig('b', 0.1, { pod: { index: 2, total: 2 } }),
    ]);
    expect(score.reasons).toEqual(['a', 'b']);
    expect(score.pod).toEqual({ index: 1, total: 2 });
  });

  it('picks the kind with the most weight; an ad wins ties', () => {
    expect(scoreSignals([sig('i', 0.6, { kind: 'intro' }), sig('a', 0.3)]).kind).toBe('intro');
    expect(scoreSignals([sig('i', 0.3, { kind: 'intro' }), sig('a', 0.3)]).kind).toBe('ad');
    expect(scoreSignals([sig('z', 0, { kind: 'promo' })]).kind).toBeNull();
  });
});

describe('sameSnapshot', () => {
  it('compares every reported field', () => {
    const base = { ...EMPTY_SNAPSHOT, reasons: ['x'] };
    expect(sameSnapshot(base, { ...base, reasons: ['x'] })).toBe(true);
    expect(sameSnapshot(base, { ...base, confidence: 0.3 })).toBe(false);
    expect(sameSnapshot(base, { ...base, pod: { index: 1, total: 2 } })).toBe(false);
    expect(sameSnapshot(base, { ...base, ssaiSuspected: true })).toBe(false);
    expect(sameSnapshot(base, { ...base, reasons: ['y'] })).toBe(false);
  });
});
