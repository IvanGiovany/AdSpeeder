/** Descending rates tried per media element (§3.2). */
export const RATE_LADDER: readonly number[] = [16, 8, 4, 2];

/**
 * Pure per-element ceiling cache (D5). It never writes to the element: VideoEngine does the
 * write-and-read-back and calls `lowerCeiling` when the browser rejects or caps a rate.
 */
export class RateProbe {
  private readonly ceilings = new WeakMap<HTMLVideoElement, number>();

  constructor(readonly ladder: readonly number[] = RATE_LADDER) {
    if (ladder.length === 0) throw new Error('RateProbe needs a non-empty ladder');
  }

  /** Highest rate this element is known (or, until a rejection, assumed) to accept. */
  maxFor(v: HTMLVideoElement): number {
    return this.ceilings.get(v) ?? this.top();
  }

  /** Steps this element's ceiling down one rung; returns the new ceiling, or null at the bottom. */
  lowerCeiling(v: HTMLVideoElement): number | null {
    const current = this.maxFor(v);
    const next = this.ladder.find((rate) => rate < current);
    if (next === undefined) return null;
    this.ceilings.set(v, next);
    return next;
  }

  private top(): number {
    return Math.max(...this.ladder);
  }
}
