import type { PlatformAdapter } from '../platforms/PlatformAdapter';

/** The minimal adapter surface MediaTracker depends on (§3.6). */
export type VideoSource = Pick<PlatformAdapter, 'getVideoElement' | 'onVideoElementChange'>;

export type VideoChangeListener = (
  next: HTMLVideoElement | null,
  prev: HTMLVideoElement | null,
) => void;

/**
 * Of several candidates, picks the connected element with the largest on-screen area and
 * readyState ≥ 2, preferring one inside `preferredRoot`.
 */
export function pickActiveVideo(
  _candidates: readonly HTMLVideoElement[],
  _preferredRoot?: Element | null,
): HTMLVideoElement | null {
  throw new Error('not implemented');
}

export class MediaTracker {
  constructor(
    private readonly source: VideoSource,
    private readonly signal: AbortSignal,
  ) {}

  get current(): HTMLVideoElement | null {
    throw new Error('not implemented');
  }

  /** Signal aborted when the current binding changes; use it for per-element listeners. */
  get bindingSignal(): AbortSignal {
    throw new Error('not implemented');
  }

  onChange(_listener: VideoChangeListener): () => void {
    throw new Error('not implemented');
  }

  start(): void {
    throw new Error('not implemented');
  }
}
