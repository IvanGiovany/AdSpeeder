/** The user's media state captured before a boost (§3.2). */
export interface MediaSnapshot {
  playbackRate: number;
  defaultPlaybackRate: number;
  muted: boolean;
  volume: number; // recorded for verification only; never written
  preservesPitch: boolean;
  takenAt: number;
}

/** Crash marker attribute (`v.dataset.adspeederBoosted`) for orphan recovery (§3.6). */
export const BOOST_MARKER_ATTR = 'data-adspeeder-boosted';

/** Reads the element's current state; never writes to it. */
export function captureSnapshot(_v: HTMLVideoElement): MediaSnapshot {
  throw new Error('not implemented');
}

/** Parses a crash marker; returns null for missing or malformed markers. */
export function parseMarker(_raw: string | undefined): MediaSnapshot | null {
  throw new Error('not implemented');
}

/** Per-element snapshot store: WeakMap first, dataset crash marker as the fallback. */
export class SnapshotStore {
  get(_v: HTMLVideoElement): MediaSnapshot | null {
    throw new Error('not implemented');
  }

  set(_v: HTMLVideoElement, _snapshot: MediaSnapshot): void {
    throw new Error('not implemented');
  }

  delete(_v: HTMLVideoElement): void {
    throw new Error('not implemented');
  }
}
