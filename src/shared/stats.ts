import { browser } from './browser';
import type { PlatformId } from './settings';

/** One content-script batch, sent every 10 s and on segment end (§3.7). */
export interface StatsBatch {
  platform: PlatformId;
  adsSeen: number;
  secondsSaved: number;
}

export interface StatsTotals {
  adsSeen: number;
  secondsSaved: number;
}

export interface DailyBucket extends StatsTotals {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
}

export interface StoredStats {
  days: DailyBucket[];
  /** Kept separately so pruning old buckets never shrinks the all-time numbers. */
  allTime: StatsTotals;
}

export interface StatsSummary {
  today: StatsTotals;
  allTime: StatsTotals;
}

export const STATS_KEY = 'stats';

/** Buckets kept: today and the 29 days before it. */
export const STATS_RETENTION_DAYS = 30;

const MS_PER_DAY = 86_400_000;

const zero = (): StatsTotals => ({ adsSeen: 0, secondsSaved: 0 });

export function emptyStats(): StoredStats {
  return { days: [], allTime: zero() };
}

/** Local calendar day of `date` as `YYYY-MM-DD`. */
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Whole days since the epoch for a `YYYY-MM-DD` key; DST-proof because it uses UTC. */
function dayNumber(key: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const [, y, m, d] = match;
  return Date.UTC(Number(y), Number(m) - 1, Number(d)) / MS_PER_DAY;
}

/** Drops buckets older than the retention window (and any with a malformed day). */
export function pruneBuckets(
  days: readonly DailyBucket[],
  today: string,
  retentionDays = STATS_RETENTION_DAYS,
): DailyBucket[] {
  const todayNumber = dayNumber(today);
  if (todayNumber === null) return [...days];
  return days.filter((bucket) => {
    const n = dayNumber(bucket.day);
    return n !== null && todayNumber - n < retentionDays;
  });
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

function readTotals(value: unknown): StatsTotals | null {
  if (typeof value !== 'object' || value === null) return null;
  const t = value as Partial<Record<keyof StatsTotals, unknown>>;
  return isCount(t.adsSeen) && isCount(t.secondsSaved)
    ? { adsSeen: t.adsSeen, secondsSaved: t.secondsSaved }
    : null;
}

/** Validates stored data; anything unreadable is dropped rather than throwing. */
export function parseStats(value: unknown): StoredStats {
  if (typeof value !== 'object' || value === null) return emptyStats();
  const raw = value as Partial<Record<keyof StoredStats, unknown>>;
  const days: DailyBucket[] = [];
  if (Array.isArray(raw.days)) {
    for (const entry of raw.days as unknown[]) {
      const totals = readTotals(entry);
      if (!totals) continue;
      const day = (entry as { day?: unknown }).day;
      if (typeof day === 'string' && dayNumber(day) !== null) days.push({ day, ...totals });
    }
  }
  return { days, allTime: readTotals(raw.allTime) ?? zero() };
}

/** Pure: adds a batch to today's bucket and the all-time totals, then prunes. */
export function addBatch(stats: StoredStats, batch: StatsTotals, today: string): StoredStats {
  const adsSeen = isCount(batch.adsSeen) ? Math.round(batch.adsSeen) : 0;
  const secondsSaved = isCount(batch.secondsSaved) ? batch.secondsSaved : 0;
  const days = stats.days.map((b) => ({ ...b }));
  let bucket = days.find((b) => b.day === today);
  if (!bucket) {
    bucket = { day: today, ...zero() };
    days.push(bucket);
  }
  bucket.adsSeen += adsSeen;
  bucket.secondsSaved += secondsSaved;
  return {
    days: pruneBuckets(days, today),
    allTime: {
      adsSeen: stats.allTime.adsSeen + adsSeen,
      secondsSaved: stats.allTime.secondsSaved + secondsSaved,
    },
  };
}

export function summarize(stats: StoredStats, today: string): StatsSummary {
  const bucket = stats.days.find((b) => b.day === today);
  return {
    today: bucket ? { adsSeen: bucket.adsSeen, secondsSaved: bucket.secondsSaved } : zero(),
    allTime: { ...stats.allTime },
  };
}

// Batches can arrive from several tabs at once; serialising the read-modify-write cycles
// keeps one from overwriting another.
let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function readStats(): Promise<StoredStats> {
  const result = await browser.storage.local.get(STATS_KEY);
  return parseStats(result[STATS_KEY]);
}

/** Adds a batch to `storage.local` daily buckets, pruning buckets older than 30 days. */
export function recordStatsBatch(batch: StatsBatch, now: Date = new Date()): Promise<void> {
  return serialized(async () => {
    const next = addBatch(await readStats(), batch, dayKey(now));
    await browser.storage.local.set({ [STATS_KEY]: next });
  });
}

export function getStatsSummary(now: Date = new Date()): Promise<StatsSummary> {
  return serialized(async () => summarize(await readStats(), dayKey(now)));
}

export function resetStats(): Promise<void> {
  return serialized(async () => {
    await browser.storage.local.set({ [STATS_KEY]: emptyStats() });
  });
}
