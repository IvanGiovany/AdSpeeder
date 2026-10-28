import type { PlatformId } from './settings';

/** One content-script batch, sent every 10 s and on segment end (§3.7). */
export interface StatsBatch {
  platform: PlatformId;
  adsSeen: number;
  secondsSaved: number;
}

export interface DailyBucket {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  adsSeen: number;
  secondsSaved: number;
}

export interface StatsSummary {
  today: { adsSeen: number; secondsSaved: number };
  allTime: { adsSeen: number; secondsSaved: number };
}

export const STATS_RETENTION_DAYS = 30;

/** Adds a batch to `storage.local` daily buckets, pruning buckets older than 30 days. */
export function recordStatsBatch(_batch: StatsBatch): Promise<void> {
  throw new Error('not implemented');
}

export function getStatsSummary(): Promise<StatsSummary> {
  throw new Error('not implemented');
}

export function resetStats(): Promise<void> {
  throw new Error('not implemented');
}
