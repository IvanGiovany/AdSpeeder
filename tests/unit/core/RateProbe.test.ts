import { describe, expect, it } from 'vitest';
import { RATE_LADDER, RateProbe } from '../../../src/core/RateProbe';
import { FakeVideo } from '../helpers/FakeVideo';

describe('RateProbe', () => {
  it('exposes the ladder [16, 8, 4, 2] and seeds every element at its top', () => {
    const probe = new RateProbe();
    expect(probe.ladder).toEqual([16, 8, 4, 2]);
    expect(probe.maxFor(new FakeVideo().el)).toBe(RATE_LADDER[0]);
  });

  it('steps down one rung per lowerCeiling() and returns null at the bottom', () => {
    const probe = new RateProbe();
    const v = new FakeVideo().el;
    expect([1, 2, 3].map(() => probe.lowerCeiling(v))).toEqual([8, 4, 2]);
    expect(probe.lowerCeiling(v)).toBeNull();
    expect(probe.maxFor(v)).toBe(2);
  });

  it('keeps ceilings per element', () => {
    const probe = new RateProbe();
    const a = new FakeVideo().el;
    const b = new FakeVideo().el;
    probe.lowerCeiling(a);
    expect(probe.maxFor(a)).toBe(8);
    expect(probe.maxFor(b)).toBe(16);
  });

  it('never writes to the element (D5)', () => {
    const probe = new RateProbe();
    const video = new FakeVideo();
    probe.maxFor(video.el);
    probe.lowerCeiling(video.el);
    expect(video.rateWrites).toEqual([]);
  });

  it('rejects an empty ladder', () => {
    expect(() => new RateProbe([])).toThrow();
  });
});
