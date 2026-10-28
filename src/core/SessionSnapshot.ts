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
export function captureSnapshot(v: HTMLVideoElement, takenAt = Date.now()): MediaSnapshot {
  // Not every engine implements preservesPitch; its default is true.
  const pitch: unknown = v.preservesPitch;
  return {
    playbackRate: v.playbackRate,
    defaultPlaybackRate: v.defaultPlaybackRate,
    muted: v.muted,
    volume: v.volume,
    preservesPitch: typeof pitch === 'boolean' ? pitch : true,
    takenAt,
  };
}

const isPositive = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

/** Parses a crash marker; returns null for missing or malformed markers. */
export function parseMarker(raw: string | undefined): MediaSnapshot | null {
  if (raw === undefined) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const s = value as Partial<Record<keyof MediaSnapshot, unknown>>;
  if (
    !isPositive(s.playbackRate) ||
    !isPositive(s.defaultPlaybackRate) ||
    typeof s.muted !== 'boolean' ||
    typeof s.volume !== 'number' ||
    !(s.volume >= 0 && s.volume <= 1) ||
    typeof s.preservesPitch !== 'boolean' ||
    typeof s.takenAt !== 'number'
  ) {
    return null;
  }
  return {
    playbackRate: s.playbackRate,
    defaultPlaybackRate: s.defaultPlaybackRate,
    muted: s.muted,
    volume: s.volume,
    preservesPitch: s.preservesPitch,
    takenAt: s.takenAt,
  };
}

/**
 * Per-element snapshot store: a WeakMap, mirrored to the element's dataset as a crash marker
 * so a re-injected content script can still restore the user's state (§3.6).
 */
export class SnapshotStore {
  private readonly snapshots = new WeakMap<HTMLVideoElement, MediaSnapshot>();

  get(v: HTMLVideoElement): MediaSnapshot | null {
    return this.snapshots.get(v) ?? parseMarker(v.dataset.adspeederBoosted);
  }

  set(v: HTMLVideoElement, snapshot: MediaSnapshot): void {
    this.snapshots.set(v, snapshot);
    try {
      v.dataset.adspeederBoosted = JSON.stringify(snapshot);
    } catch {
      // The WeakMap copy still works; only crash recovery is lost.
    }
  }

  delete(v: HTMLVideoElement): void {
    this.snapshots.delete(v);
    try {
      v.removeAttribute(BOOST_MARKER_ATTR);
    } catch {
      // Nothing else to clean up.
    }
  }
}
