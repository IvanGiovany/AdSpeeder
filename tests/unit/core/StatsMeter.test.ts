import { describe, expect, it } from 'vitest';
import { StatsMeter } from '../../../src/core/StatsMeter';

function meterWithClock() {
  let now = 0;
  const meter = new StatsMeter(() => now);
  return {
    meter,
    tick: (ms: number) => {
      now += ms;
    },
  };
}

describe('StatsMeter time-saved arithmetic', () => {
  it('saves media seconds minus wall seconds (16x for 1 s → 15 s)', () => {
    const { meter, tick } = meterWithClock();
    meter.startSegment({ currentTime: 10, rate: 16 });
    for (let i = 1; i <= 4; i++) {
      tick(250);
      meter.sample(10 + 4 * i); // 4 media seconds per 250 ms
    }
    meter.endSegment();
    expect(meter.takeBatch()).toEqual({ adsSeen: 1, secondsSaved: 15 });
  });

  it('counts nothing while paused or rewinding, and nothing outside a segment', () => {
    const { meter, tick } = meterWithClock();
    meter.sample(5);
    meter.startSegment({ currentTime: 0, rate: 16 });
    tick(1000);
    meter.sample(0); // paused
    tick(1000);
    meter.sample(-3); // went backwards
    expect(meter.takeBatch()).toEqual({ adsSeen: 1, secondsSaved: 0 });
  });

  it('ignores jumps faster than the boost could play (seek / src swap)', () => {
    const { meter, tick } = meterWithClock();
    meter.startSegment({ currentTime: 0, rate: 2 });
    tick(1000);
    meter.sample(60);
    expect(meter.takeBatch()?.secondsSaved).toBe(0);
  });

  it('resync() drops the baseline so the next interval starts fresh', () => {
    const { meter, tick } = meterWithClock();
    meter.startSegment({ currentTime: 0, rate: 16 });
    meter.resync();
    tick(1000);
    meter.sample(100); // becomes the new baseline only
    tick(1000);
    meter.sample(116);
    expect(meter.takeBatch()?.secondsSaved).toBe(15);
  });

  it('endSegment(currentTime) takes a final sample', () => {
    const { meter, tick } = meterWithClock();
    meter.startSegment({ currentTime: 0, rate: 4 });
    tick(1000);
    meter.endSegment(4);
    expect(meter.measuring).toBe(false);
    expect(meter.takeBatch()?.secondsSaved).toBe(3);
  });

  it('a mute-only segment (rate null) saves nothing but counts the ad', () => {
    const { meter, tick } = meterWithClock();
    meter.startSegment({ currentTime: 0, rate: null });
    tick(1000);
    meter.sample(1);
    expect(meter.takeBatch()).toEqual({ adsSeen: 1, secondsSaved: 0 });
  });
});

describe('StatsMeter ad counting', () => {
  it('counts each pod index increment as a new ad', () => {
    const { meter } = meterWithClock();
    meter.startSegment({ currentTime: 0, rate: 16, pod: { index: 1, total: 3 } });
    meter.observePod({ index: 1, total: 3 });
    meter.observePod({ index: 2, total: 3 });
    meter.observePod(undefined);
    meter.observePod({ index: 3, total: 3 });
    expect(meter.takeBatch()?.adsSeen).toBe(3);
  });

  it('counts skipped indexes, and adopts pod info that appears mid-segment without counting', () => {
    const { meter } = meterWithClock();
    meter.startSegment({ currentTime: 0, rate: 16 });
    meter.observePod({ index: 1, total: 4 });
    meter.observePod({ index: 3, total: 4 });
    expect(meter.takeBatch()?.adsSeen).toBe(3);
  });

  it('ignores pod info outside a segment', () => {
    const { meter } = meterWithClock();
    meter.observePod({ index: 2, total: 2 });
    expect(meter.takeBatch()).toBeNull();
  });
});

describe('StatsMeter batching', () => {
  it('takeBatch() returns and clears, then null until something new accrues', () => {
    const { meter, tick } = meterWithClock();
    meter.startSegment({ currentTime: 0, rate: 8 });
    tick(1000);
    meter.sample(8);
    expect(meter.takeBatch()).toEqual({ adsSeen: 1, secondsSaved: 7 });
    expect(meter.takeBatch()).toBeNull();
    tick(1000);
    meter.sample(16);
    expect(meter.takeBatch()).toEqual({ adsSeen: 0, secondsSaved: 7 });
  });
});
