import type { Logger } from '../shared/logger';
import type { RateProbe } from './RateProbe';

export type { MediaSnapshot } from './SessionSnapshot';

/** The only module allowed to write `playbackRate` or `muted` (CLAUDE.md, §3.2). */
export class VideoEngine {
  constructor(
    private readonly probe: RateProbe,
    private readonly log: Logger,
  ) {}

  boost(_v: HTMLVideoElement, _opts: { rate: number; mute: boolean }): void {
    throw new Error('not implemented');
  }

  /** After load events / guard. */
  reassert(_v: HTMLVideoElement): void {
    throw new Error('not implemented');
  }

  /** Idempotent, safe on detached nodes. */
  restore(_v: HTMLVideoElement | null): void {
    throw new Error('not implemented');
  }

  /** Node swap mid-ad. */
  transfer(_from: HTMLVideoElement, _to: HTMLVideoElement): void {
    throw new Error('not implemented');
  }

  isBoosted(_v: HTMLVideoElement): boolean {
    throw new Error('not implemented');
  }
}
