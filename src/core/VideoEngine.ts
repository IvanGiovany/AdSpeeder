import type { Logger } from '../shared/logger';
import type { RateProbe } from './RateProbe';
import { captureSnapshot, SnapshotStore, type MediaSnapshot } from './SessionSnapshot';

export type { MediaSnapshot } from './SessionSnapshot';

export interface BoostOptions {
  /** Requested rate before the probe ceiling is applied; null leaves the rate alone (live). */
  rate: number | null;
  mute: boolean;
}

/** What the user changed during the current segment; the engine stops fighting it (§3.3). */
export type OverrideKind = 'rate' | 'mute';

interface ActiveBoost {
  requestedRate: number | null;
  appliedRate: number | null;
  /** The last boost rate that stuck this segment, kept after restoreRate() for verification. */
  boostedRate: number | null;
  mute: boolean;
  overrides: Set<OverrideKind>;
}

export const VERIFY_DELAY_MS = 500;

const RATE_EPSILON = 1e-3;

export function sameRate(a: number, b: number): boolean {
  return Math.abs(a - b) < RATE_EPSILON;
}

/**
 * The only module that writes `playbackRate` or `muted` (CLAUDE.md, §3.2). Every write sits in
 * its own try/catch, so a detached or misbehaving element can never throw out of here.
 */
export class VideoEngine {
  private readonly snapshots = new SnapshotStore();
  private readonly boosts = new WeakMap<HTMLVideoElement, ActiveBoost>();
  private readonly verifications = new WeakMap<HTMLVideoElement, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly probe: RateProbe,
    private readonly log: Logger,
  ) {}

  /**
   * Applies (or updates) a boost and returns the rate that stuck, or null when the rate was
   * left alone. The user's state is snapshotted only if no snapshot exists yet, so a pod or a
   * repeated call can never record a boosted state as the user's.
   */
  boost(v: HTMLVideoElement, opts: BoostOptions): number | null {
    this.cancelVerification(v);
    let snapshot = this.snapshots.get(v);
    if (!snapshot) {
      snapshot = captureSnapshot(v);
      this.snapshots.set(v, snapshot);
    }
    const prev = this.boosts.get(v);
    const boost: ActiveBoost = {
      requestedRate: opts.rate,
      appliedRate: null,
      boostedRate: prev?.boostedRate ?? null,
      mute: opts.mute,
      overrides: prev?.overrides ?? new Set(),
    };
    this.boosts.set(v, boost);
    // Settings changed mid-segment: give back what is no longer requested.
    if (prev?.mute && !opts.mute && !boost.overrides.has('mute')) {
      this.writeMuted(v, snapshot.muted);
    }
    if (prev?.appliedRate != null && opts.rate === null && !boost.overrides.has('rate')) {
      this.writeRate(v, snapshot.playbackRate);
    }
    this.applyMute(v, boost);
    this.applyRate(v, boost);
    return boost.appliedRate;
  }

  /**
   * Re-applies the current boost after load events or a site reset (§3.2, §3.5). Writes only
   * what drifted. `rate: false` re-mutes without touching the rate (CONTESTED).
   */
  reassert(v: HTMLVideoElement, options: { rate?: boolean } = {}): void {
    const boost = this.boosts.get(v);
    if (!boost) return;
    this.applyMute(v, boost);
    if (options.rate !== false) this.applyRate(v, boost);
  }

  /**
   * D25 first exit stage: gives back the rate fields (playbackRate, defaultPlaybackRate,
   * preservesPitch) from the snapshot and stops re-applying the boost rate, but keeps the
   * mute, the snapshot and the crash marker. A later boost() re-boosts from the same snapshot.
   * Returns whether there was a boost to step down.
   */
  restoreRate(v: HTMLVideoElement | null): boolean {
    if (!v) return false;
    const snapshot = this.snapshots.get(v);
    const boost = this.boosts.get(v);
    if (!snapshot || !boost) return false;
    boost.requestedRate = null;
    boost.appliedRate = null;
    this.writeRateFields(v, snapshot, !boost.overrides.has('rate'));
    return true;
  }

  /** Full restore: rate fields, mute, snapshot and marker. Idempotent, safe on detached nodes. */
  restore(v: HTMLVideoElement | null): boolean {
    return v ? this.restoreElement(v, true) : false;
  }

  /** Node swap mid-ad (§3.6): restore `from` if still connected, move the snapshot, boost `to`. */
  transfer(from: HTMLVideoElement, to: HTMLVideoElement): void {
    if (from === to) return;
    const snapshot = this.snapshots.get(from);
    const boost = this.boosts.get(from);
    if (!snapshot || !boost) return;
    if (from.isConnected) {
      this.restoreElement(from, false);
    } else {
      this.snapshots.delete(from);
      this.boosts.delete(from);
    }
    this.cancelVerification(to);
    // The new node inherits the user's snapshot, not its own (likely default) state.
    this.snapshots.set(to, snapshot);
    const moved: ActiveBoost = { ...boost, appliedRate: null, overrides: new Set(boost.overrides) };
    this.boosts.set(to, moved);
    this.applyMute(to, moved);
    this.applyRate(to, moved);
  }

  isBoosted(v: HTMLVideoElement): boolean {
    return this.boosts.has(v);
  }

  /** The rate that stuck on `v`, or null when the rate isn't being boosted. */
  appliedRate(v: HTMLVideoElement): number | null {
    return this.boosts.get(v)?.appliedRate ?? null;
  }

  /** Records a user change for this segment: stop re-applying it, and leave it on restore. */
  markUserOverride(v: HTMLVideoElement, kind: OverrideKind): void {
    const boost = this.boosts.get(v);
    if (!boost || boost.overrides.has(kind)) return;
    boost.overrides.add(kind);
    if (kind === 'rate') boost.appliedRate = null;
    this.log.info(`user override: ${kind}`);
  }

  hasUserOverride(v: HTMLVideoElement, kind: OverrideKind): boolean {
    return this.boosts.get(v)?.overrides.has(kind) ?? false;
  }

  private restoreElement(v: HTMLVideoElement, verify: boolean): boolean {
    this.cancelVerification(v);
    const snapshot = this.snapshots.get(v);
    const boost = this.boosts.get(v);
    this.boosts.delete(v);
    if (!snapshot) {
      this.snapshots.delete(v); // drops an unreadable crash marker too (D12)
      return false;
    }
    const keepRate = boost?.overrides.has('rate') ?? false;
    const keepMute = boost?.overrides.has('mute') ?? false;
    // Rewritten even after restoreRate(): a load reset during EXIT_PENDING leaves 1.0 (D25).
    this.writeRateFields(v, snapshot, !keepRate);
    if (!keepMute) this.writeMuted(v, snapshot.muted);
    // D12: the marker goes even if every write above failed; it must never outlive the boost.
    // Dropping the boost entry above also clears this segment's user overrides (D11).
    this.snapshots.delete(v);
    if (verify && !keepRate) this.scheduleVerification(v, snapshot, boost?.boostedRate ?? null);
    return true;
  }

  private writeRateFields(v: HTMLVideoElement, snapshot: MediaSnapshot, rate: boolean): void {
    if (rate && !sameRate(v.playbackRate, snapshot.playbackRate)) {
      this.writeRate(v, snapshot.playbackRate);
    }
    this.attempt(() => {
      v.defaultPlaybackRate = snapshot.defaultPlaybackRate;
    });
    if ('preservesPitch' in v) {
      this.attempt(() => {
        v.preservesPitch = snapshot.preservesPitch;
      });
    }
  }

  /**
   * §3.2 restore step 4: YouTube re-applies its own saved speed when content resumes. A rate
   * that differs from the snapshot and from 1.0 is the site's (user's) preference and is kept;
   * 1.0 (a load-algorithm reset) or our own boost rate leaking back is rewritten once.
   */
  private scheduleVerification(
    v: HTMLVideoElement,
    snapshot: MediaSnapshot,
    boostedRate: number | null,
  ): void {
    const timer = setTimeout(() => {
      this.verifications.delete(v);
      if (!v.isConnected || this.boosts.has(v)) return;
      const current = v.playbackRate;
      if (sameRate(current, snapshot.playbackRate)) return;
      const leaked = boostedRate !== null && sameRate(current, boostedRate);
      if (leaked || sameRate(current, 1)) {
        this.log.info(
          `restore verification: rate ${String(current)} → ${String(snapshot.playbackRate)}`,
        );
        this.writeRate(v, snapshot.playbackRate);
      } else {
        this.log.info(`restore verification: keeping site rate ${String(current)}`);
      }
    }, VERIFY_DELAY_MS);
    this.verifications.set(v, timer);
  }

  private cancelVerification(v: HTMLVideoElement): void {
    const timer = this.verifications.get(v);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.verifications.delete(v);
  }

  private applyMute(v: HTMLVideoElement, boost: ActiveBoost): void {
    if (boost.mute && !boost.overrides.has('mute') && !v.muted) this.writeMuted(v, true);
  }

  /**
   * §3.2 step 4 with D5: write, read back, and treat a throw or a silently capped value as a
   * rejection. Lower the probe ceiling below the rejected rate and retry until a write sticks.
   */
  private applyRate(v: HTMLVideoElement, boost: ActiveBoost): void {
    const requested = boost.requestedRate;
    if (requested === null || boost.overrides.has('rate')) {
      boost.appliedRate = null;
      return;
    }
    let rate = Math.min(requested, this.probe.maxFor(v));
    for (;;) {
      if (this.tryRate(v, rate)) {
        boost.appliedRate = rate;
        boost.boostedRate = rate;
        return;
      }
      const ceiling = this.lowerBelow(v, rate);
      if (ceiling === null) {
        this.log.warn(`no playbackRate ≤ ${String(requested)} was accepted; leaving rate alone`);
        boost.appliedRate = null;
        return;
      }
      rate = Math.min(requested, ceiling);
    }
  }

  private tryRate(v: HTMLVideoElement, rate: number): boolean {
    if (sameRate(v.playbackRate, rate)) return true;
    try {
      v.playbackRate = rate;
    } catch (error) {
      this.log.debug(`playbackRate ${String(rate)} rejected`, error);
      return false;
    }
    return sameRate(v.playbackRate, rate);
  }

  private lowerBelow(v: HTMLVideoElement, rejected: number): number | null {
    while (this.probe.maxFor(v) >= rejected) {
      if (this.probe.lowerCeiling(v) === null) return null;
    }
    return this.probe.maxFor(v);
  }

  private writeRate(v: HTMLVideoElement, rate: number): void {
    this.attempt(() => {
      v.playbackRate = rate;
    });
  }

  private writeMuted(v: HTMLVideoElement, muted: boolean): void {
    this.attempt(() => {
      v.muted = muted;
    });
  }

  private attempt(write: () => void): void {
    try {
      write();
    } catch (error) {
      this.log.debug('media write failed', error);
    }
  }
}
