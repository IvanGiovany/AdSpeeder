import type { PodInfo } from '../platforms/signals';

export interface MeterBatch {
  adsSeen: number;
  secondsSaved: number;
}

/** Slack for timer jitter when deciding whether a currentTime jump was playback or a seek. */
const PLAUSIBLE_RATE_FACTOR = 1.5;
const PLAUSIBLE_SLACK_S = 0.5;

/**
 * Time-saved accounting while boosted (§3.7, D6): media seconds advanced minus wall-clock
 * seconds elapsed, from `currentTime` and clock deltas on each `timeupdate`. The first ad of a
 * segment and each pod index increment count as one ad.
 */
export class StatsMeter {
  private adsSeen = 0;
  private secondsSaved = 0;
  private active = false;
  private rate = 1;
  private podIndex: number | null = null;
  private last: { media: number; wall: number } | null = null;
  /** D25: EXIT_PENDING plays at the user's rate, so no time is being saved. */
  private paused = false;

  constructor(private readonly now: () => number = () => performance.now()) {}

  get measuring(): boolean {
    return this.active;
  }

  startSegment(opts: { currentTime: number; rate: number | null; pod?: PodInfo }): void {
    this.active = true;
    this.adsSeen += 1;
    this.podIndex = opts.pod?.index ?? null;
    this.rate = opts.rate ?? 1;
    this.last = { media: opts.currentTime, wall: this.now() };
  }

  /** Counts pod index increments as new ads. */
  observePod(pod: PodInfo | undefined): void {
    if (!this.active || !pod) return;
    if (this.podIndex !== null && pod.index > this.podIndex)
      this.adsSeen += pod.index - this.podIndex;
    if (this.podIndex === null || pod.index > this.podIndex) this.podIndex = pod.index;
  }

  setRate(rate: number | null): void {
    this.rate = rate ?? 1;
  }

  sample(currentTime: number): void {
    if (!this.active || this.paused) return;
    const wall = this.now();
    const last = this.last;
    this.last = { media: currentTime, wall };
    if (!last) return;
    const media = currentTime - last.media;
    const elapsed = (wall - last.wall) / 1000;
    if (media <= 0 || elapsed <= 0) return;
    // A jump faster than the boost could play is a seek or src swap, not time saved.
    if (media > elapsed * this.rate * PLAUSIBLE_RATE_FACTOR + PLAUSIBLE_SLACK_S) return;
    this.secondsSaved += Math.max(0, media - elapsed);
  }

  /** D25: stops accumulating (rate restored, segment kept) after counting up to `currentTime`. */
  pause(currentTime: number): void {
    if (!this.active || this.paused) return;
    this.sample(currentTime);
    this.paused = true;
  }

  /** D25: the pod continued and the rate is boosted again; counting restarts from here. */
  resume(currentTime: number): void {
    if (!this.active || !this.paused) return;
    this.paused = false;
    this.last = { media: currentTime, wall: this.now() };
  }

  /** Drops the baseline after a seek or node swap; the next sample starts a new interval. */
  resync(): void {
    this.last = null;
  }

  endSegment(currentTime?: number): void {
    if (currentTime !== undefined) this.sample(currentTime);
    this.active = false;
    this.paused = false;
    this.last = null;
    this.podIndex = null;
  }

  /** Returns and clears what has accumulated, or null when there is nothing to send. */
  takeBatch(): MeterBatch | null {
    if (this.adsSeen === 0 && this.secondsSaved === 0) return null;
    const batch = { adsSeen: this.adsSeen, secondsSaved: this.secondsSaved };
    this.adsSeen = 0;
    this.secondsSaved = 0;
    return batch;
  }
}
