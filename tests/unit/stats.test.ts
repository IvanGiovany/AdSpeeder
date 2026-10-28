import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  addBatch,
  dayKey,
  emptyStats,
  getStatsSummary,
  parseStats,
  pruneBuckets,
  recordStatsBatch,
  resetStats,
  STATS_KEY,
  summarize,
  type DailyBucket,
} from '../../src/shared/stats';

beforeEach(() => {
  fakeBrowser.reset();
});

const bucket = (day: string, adsSeen = 1, secondsSaved = 10): DailyBucket => ({
  day,
  adsSeen,
  secondsSaved,
});

describe('dayKey', () => {
  it('formats the local calendar day', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('pruneBuckets', () => {
  it('keeps today and the 29 days before it, deleting older buckets', () => {
    const days = [
      bucket('2026-10-28'),
      bucket('2026-09-29'), // 29 days old: kept
      bucket('2026-09-28'), // 30 days old: deleted
      bucket('2025-01-01'),
    ];
    expect(pruneBuckets(days, '2026-10-28').map((b) => b.day)).toEqual([
      '2026-10-28',
      '2026-09-29',
    ]);
  });

  it('counts calendar days across a DST change and month ends', () => {
    expect(pruneBuckets([bucket('2026-03-01')], '2026-03-30')).toHaveLength(1);
    expect(pruneBuckets([bucket('2026-03-01')], '2026-03-31')).toHaveLength(0);
  });

  it('drops malformed days', () => {
    expect(pruneBuckets([bucket('yesterday')], '2026-10-28')).toEqual([]);
  });
});

describe('addBatch / summarize', () => {
  it('sums into today’s bucket and all-time, without mutating the input', () => {
    const start = addBatch(emptyStats(), { adsSeen: 2, secondsSaved: 30 }, '2026-10-27');
    const next = addBatch(start, { adsSeen: 1, secondsSaved: 15.5 }, '2026-10-28');
    const again = addBatch(next, { adsSeen: 3, secondsSaved: 4.5 }, '2026-10-28');
    expect(start.days).toEqual([bucket('2026-10-27', 2, 30)]);
    expect(summarize(again, '2026-10-28')).toEqual({
      today: { adsSeen: 4, secondsSaved: 20 },
      allTime: { adsSeen: 6, secondsSaved: 50 },
    });
  });

  it('pruning old buckets never shrinks the all-time totals', () => {
    const old = addBatch(emptyStats(), { adsSeen: 5, secondsSaved: 100 }, '2026-01-01');
    const now = addBatch(old, { adsSeen: 1, secondsSaved: 1 }, '2026-10-28');
    expect(now.days.map((b) => b.day)).toEqual(['2026-10-28']);
    expect(now.allTime).toEqual({ adsSeen: 6, secondsSaved: 101 });
  });

  it('ignores invalid batch numbers', () => {
    const next = addBatch(emptyStats(), { adsSeen: -1, secondsSaved: Number.NaN }, '2026-10-28');
    expect(next.allTime).toEqual({ adsSeen: 0, secondsSaved: 0 });
  });

  it('summarize() reports zeros for a day without a bucket', () => {
    expect(summarize(emptyStats(), '2026-10-28').today).toEqual({ adsSeen: 0, secondsSaved: 0 });
  });
});

describe('parseStats', () => {
  it.each([undefined, null, 'x', { days: 'no' }])('returns empty stats for %j', (raw) => {
    expect(parseStats(raw)).toEqual(emptyStats());
  });

  it('keeps valid buckets and drops invalid ones', () => {
    const raw = {
      days: [bucket('2026-10-28'), { day: 'bad', adsSeen: 1, secondsSaved: 1 }, null, 5],
      allTime: { adsSeen: 1, secondsSaved: 10 },
    };
    expect(parseStats(raw)).toEqual({
      days: [bucket('2026-10-28')],
      allTime: { adsSeen: 1, secondsSaved: 10 },
    });
  });
});

describe('storage', () => {
  const oct28 = new Date(2026, 9, 28, 12);

  it('records batches into storage.local and summarises them', async () => {
    await recordStatsBatch({ platform: 'youtube', adsSeen: 1, secondsSaved: 15 }, oct28);
    await recordStatsBatch({ platform: 'netflix', adsSeen: 2, secondsSaved: 5 }, oct28);
    await expect(getStatsSummary(oct28)).resolves.toEqual({
      today: { adsSeen: 3, secondsSaved: 20 },
      allTime: { adsSeen: 3, secondsSaved: 20 },
    });
    const stored = (await fakeBrowser.storage.local.get(STATS_KEY))[STATS_KEY];
    expect(parseStats(stored).days).toEqual([bucket('2026-10-28', 3, 20)]);
  });

  it('serialises concurrent batches so none is lost', async () => {
    await Promise.all(
      Array.from({ length: 20 }, () =>
        recordStatsBatch({ platform: 'youtube', adsSeen: 1, secondsSaved: 1 }, oct28),
      ),
    );
    expect((await getStatsSummary(oct28)).allTime).toEqual({ adsSeen: 20, secondsSaved: 20 });
  });

  it('prunes buckets older than 30 days on write', async () => {
    await recordStatsBatch(
      { platform: 'youtube', adsSeen: 1, secondsSaved: 1 },
      new Date(2026, 8, 1, 12),
    );
    await recordStatsBatch({ platform: 'youtube', adsSeen: 1, secondsSaved: 1 }, oct28);
    const stored = parseStats((await fakeBrowser.storage.local.get(STATS_KEY))[STATS_KEY]);
    expect(stored.days.map((b) => b.day)).toEqual(['2026-10-28']);
    expect(stored.allTime.adsSeen).toBe(2);
  });

  it('resetStats() clears everything', async () => {
    await recordStatsBatch({ platform: 'youtube', adsSeen: 1, secondsSaved: 1 }, oct28);
    await resetStats();
    await expect(getStatsSummary(oct28)).resolves.toEqual(summarize(emptyStats(), '2026-10-28'));
  });
});
