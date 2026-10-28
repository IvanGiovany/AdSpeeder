/** Descending rates tried per media element; the highest accepted one is cached (§3.2). */
export const RATE_LADDER = [16, 8, 4, 2] as const;

export class RateProbe {
  /** Highest rate this element is known (or assumed) to accept. */
  maxFor(_v: HTMLVideoElement): number {
    throw new Error('not implemented');
  }

  /** Steps this element's ceiling down one ladder rung; returns the new ceiling or null. */
  lowerCeiling(_v: HTMLVideoElement): number | null {
    throw new Error('not implemented');
  }
}
