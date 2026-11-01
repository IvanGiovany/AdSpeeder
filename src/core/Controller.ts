import type { PlatformAdapter } from '../platforms/PlatformAdapter';
import {
  DEFAULT_THRESHOLDS,
  type AdStateSnapshot,
  type SegmentKind,
  type Thresholds,
} from '../platforms/signals';
import { browser } from '../shared/browser';
import { childController } from '../shared/dom';
import type { Logger } from '../shared/logger';
import { sendMessage, type TabStatus } from '../shared/messaging';
import type { Settings } from '../shared/settings';
import type { StatsBatch } from '../shared/stats';
import {
  INITIAL_STATE,
  isBoostedPhase,
  reduce,
  type ForceRestoreReason,
  type MachineEffect,
  type MachineEvent,
  type MachineState,
} from './AdStateMachine';
import { MediaTracker } from './MediaTracker';
import { RateGuard } from './RateGuard';
import { RateProbe } from './RateProbe';
import { BOOST_MARKER_ATTR } from './SessionSnapshot';
import { StatsMeter } from './StatsMeter';
import { sameRate, VideoEngine } from './VideoEngine';

/** D9: per-segment wall-clock caps, by mode. */
export const MAX_BOOSTED_MS = 90_000;
export const MAX_MUTED_ONLY_MS = 300_000;
export const ORPHAN_CHECK_MS = 5_000;
export const STATS_FLUSH_MS = 10_000;
export const TRUSTED_INPUT_WINDOW_MS = 500;
export const POD_EXIT_DEBOUNCE_MS = 1_000;
export const SSAI_EXIT_DEBOUNCE_MS = 100;
/** D34: stall back-off never goes below this rate, and ignores stalls this early in the ad. */
export const STALL_MIN_RATE = 2;
export const STALL_GRACE_MEDIA_S = 1;
/** §2.3: consecutive watch pages with a fallback selector before "selector drift" is logged. */
export const SELECTOR_DRIFT_PAGES = 3;

/** D14: trusted input in these targets is typing, not a player control. */
const EDITABLE_TARGET = 'input, textarea, [contenteditable]:not([contenteditable="false"])';

type CapMode = 'boosted' | 'muted-only';

export interface ControllerOptions {
  adapter: PlatformAdapter;
  settings: Readonly<Settings>;
  log: Logger;
  /** Aborted when the content script unloads; every listener and timer hangs off it. */
  signal: AbortSignal;
  thresholds?: Readonly<Thresholds>;
  maxBoostedMs?: number;
  maxMutedOnlyMs?: number;
  /** Clock for trusted-input timing and stats; defaults to performance.now(). */
  now?: () => number;
  /** Orphan detection (§3.6); defaults to checking browser.runtime.id. */
  isRuntimeAlive?: () => boolean;
  sendStats?: (batch: StatsBatch) => Promise<void>;
  reportStatus?: (status: TabStatus) => void;
}

function runtimeAlive(): boolean {
  try {
    const runtime = browser.runtime as { id?: string } | undefined;
    return typeof runtime?.id === 'string';
  } catch {
    return false;
  }
}

/**
 * Wires adapter snapshots → AdStateMachine → VideoEngine (§3). Owns every timer, runs every
 * force-restore trigger, detects orphaned contexts, and sends stats batches.
 */
export class Controller {
  private readonly adapter: PlatformAdapter;
  private readonly log: Logger;
  private readonly lifetime: AbortController;
  private thresholds: Readonly<Thresholds>;
  private readonly maxBoostedMs: number;
  private readonly maxMutedOnlyMs: number;
  private readonly now: () => number;
  private readonly isRuntimeAlive: () => boolean;
  private readonly sendStats: (batch: StatsBatch) => Promise<void>;
  private readonly reportStatus: (status: TabStatus) => void;

  private readonly engine: VideoEngine;
  private readonly probe = new RateProbe();
  private readonly guard: RateGuard;
  private readonly meter: StatsMeter;
  private tracker: MediaTracker | null = null;

  private settings: Readonly<Settings>;
  private machine: MachineState = INITIAL_STATE;
  private boostedVideo: HTMLVideoElement | null = null;
  private latest: AdStateSnapshot | null = null;
  /** The last snapshot at or above the enter threshold; picks the exit debounce (§3.4). */
  private lastActive: AdStateSnapshot | null = null;
  /** D9: after a cap fires, no re-boost until the segment is over. */
  private suppressed = false;
  private segmentOverTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTrustedInputAt = Number.NEGATIVE_INFINITY;
  private exitTimer: ReturnType<typeof setTimeout> | null = null;
  private segmentStartedAt: number | null = null;
  /** D34: per-segment rate ceiling lowered by buffering stalls; null = no stall seen. */
  private stallCeiling: number | null = null;
  /** D34: media time when the segment's boost began, for the stall grace period. */
  private boostStartedAt = 0;
  private capTimer: ReturnType<typeof setTimeout> | null = null;
  private capMode: CapMode | null = null;
  private pageIsWatch = false;
  private driftStreak = 0;
  private readonly unsubscribers: (() => void)[] = [];
  private destroyed = false;

  constructor(options: ControllerOptions) {
    this.adapter = options.adapter;
    this.settings = options.settings;
    this.log = options.log;
    this.thresholds = options.thresholds ?? options.settings.thresholds ?? DEFAULT_THRESHOLDS;
    this.maxBoostedMs = options.maxBoostedMs ?? MAX_BOOSTED_MS;
    this.maxMutedOnlyMs = options.maxMutedOnlyMs ?? MAX_MUTED_ONLY_MS;
    this.now = options.now ?? (() => performance.now());
    this.isRuntimeAlive = options.isRuntimeAlive ?? runtimeAlive;
    this.sendStats = options.sendStats ?? ((batch) => sendMessage({ type: 'stats-batch', batch }));
    this.reportStatus =
      options.reportStatus ??
      ((status) => {
        sendMessage({ type: 'tab-status', status }).catch(() => undefined);
      });

    this.lifetime = childController(options.signal);
    options.signal.addEventListener(
      'abort',
      () => {
        this.destroy();
      },
      { once: true, signal: this.lifetime.signal },
    );

    this.engine = new VideoEngine(this.probe, this.log, this.lifetime.signal);
    this.meter = new StatsMeter(this.now);
    this.guard = new RateGuard(
      {
        target: (v) => this.engine.appliedRate(v),
        reassert: (v) => {
          this.engine.reassert(v);
        },
        isRecentUserInput: () => this.isRecentUserInput(),
        onUserOverride: (v) => {
          this.onUserRateOverride(v);
        },
        onContested: () => {
          this.log.warn('rate-contested', this.diagnostics());
          this.dispatch({ type: 'guard-exhausted' });
        },
      },
      undefined,
      this.now,
    );
  }

  get state(): MachineState {
    return this.machine;
  }

  async start(): Promise<void> {
    // §3.6: a re-injected instance restores leftover crash markers before anything else.
    this.recoverCrashMarkers();
    const { signal } = this.lifetime;
    if (this.isDestroyed()) return;
    await this.adapter.init({ settings: this.settings, log: this.log, signal });
    if (this.isDestroyed()) return; // torn down while the adapter was initialising

    const tracker = new MediaTracker(this.adapter, signal);
    this.tracker = tracker;
    tracker.onChange((next, prev) => {
      this.onVideoChange(next, prev);
    });
    tracker.start();

    this.unsubscribers.push(
      this.adapter.onSnapshot((s) => {
        this.onSnapshot(s);
      }),
      this.adapter.onNavigation((url) => {
        this.onNavigation(url);
      }),
    );

    // D14: scoped to the adapter's interaction root when it has one. Filtering on document
    // (rather than listening on the root) keeps working when the root appears late or is replaced.
    const noteInput = (event: Event) => {
      if (event.isTrusted && this.isPlayerInteraction(event)) {
        this.lastTrustedInputAt = this.now();
      }
    };
    document.addEventListener('pointerdown', noteInput, { capture: true, signal });
    document.addEventListener('keydown', noteInput, { capture: true, signal });
    // D19: background tabs throttle timers, so the cap is also checked here.
    document.addEventListener(
      'visibilitychange',
      () => {
        this.checkCapDeadline();
      },
      { signal },
    );
    window.addEventListener(
      'pagehide',
      () => {
        this.forceRestore('pagehide');
      },
      { signal },
    );
    window.addEventListener(
      'pageshow',
      (event) => {
        if (event.persisted) this.onSnapshot(this.adapter.evaluateNow());
      },
      { signal },
    );

    const orphanTimer = setInterval(() => {
      this.checkOrphan();
    }, ORPHAN_CHECK_MS);
    const statsTimer = setInterval(() => {
      this.flushStats();
    }, STATS_FLUSH_MS);
    signal.addEventListener(
      'abort',
      () => {
        clearInterval(orphanTimer);
        clearInterval(statsTimer);
      },
      { once: true },
    );

    this.pageIsWatch = this.adapter.isWatchContext(new URL(location.href));
    this.onSnapshot(this.adapter.evaluateNow());
    this.report();
  }

  updateSettings(settings: Readonly<Settings>): void {
    this.settings = settings;
    this.thresholds = settings.thresholds ?? DEFAULT_THRESHOLDS;
    if (!settings.enabled) {
      this.forceRestore('user-disabled');
    } else if (!settings.platforms[this.adapter.id]) {
      this.forceRestore('platform-disabled');
    } else if (isBoostedPhase(this.machine.phase) && this.boostedVideo) {
      // Speed or mute changed mid-segment; EXIT_PENDING keeps the rate restored (D25).
      this.applyBoost(this.boostedVideo, this.machine.phase !== 'EXIT_PENDING');
      this.syncCap();
    }
    if (this.latest) this.onSnapshot(this.latest);
    this.report();
  }

  /** Restores, flushes stats and removes every listener and timer. Safe to call twice. */
  destroy(): void {
    if (this.destroyed) return;
    // Flag first: the restore below changes state, which would otherwise re-enter via checkOrphan.
    this.destroyed = true;
    this.forceRestore('destroy');
    this.flushStats();
    this.clearExitTimer();
    this.clearCapTimer();
    this.clearSegmentOverTimer();
    this.guard.disarm();
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.lifetime.abort();
    try {
      this.adapter.destroy();
    } catch (error) {
      this.log.debug('adapter destroy failed', error);
    }
  }

  // A method rather than a field read, so TypeScript doesn't carry narrowing across `await`.
  private isDestroyed(): boolean {
    return this.destroyed;
  }

  private forceRestore(reason: ForceRestoreReason): void {
    this.dispatch({ type: 'force-restore', reason });
  }

  /**
   * D8: the engine is the single owner of hysteresis. Adapters report raw confidence; entering
   * needs confidence ≥ enterThreshold, leaving needs confidence ≤ exitThreshold for the whole
   * exit debounce (EXIT_PENDING), and anything in between keeps the current state.
   */
  private onSnapshot(snapshot: AdStateSnapshot): void {
    if (this.destroyed) return;
    this.latest = snapshot;
    const aboveEnter = snapshot.confidence >= this.thresholds.enterThreshold;
    const belowExit = snapshot.confidence <= this.thresholds.exitThreshold;
    if (aboveEnter) this.lastActive = snapshot;
    this.trackSegmentOver(snapshot, belowExit);

    const relevant = snapshot.kind !== null && this.wants(snapshot.kind);
    const caps = this.adapter.getCapabilities();
    const canAct = caps.allowRateBoost || (caps.allowMute && this.settings.mute);
    const enabled = this.settings.enabled && this.settings.platforms[this.adapter.id];
    const engaged =
      enabled &&
      aboveEnter &&
      relevant &&
      canAct &&
      !this.suppressed &&
      this.tracker?.current != null &&
      this.adapter.isWatchContext(new URL(location.href));
    const ended = !enabled || !relevant || belowExit;

    if (isBoostedPhase(this.machine.phase)) this.meter.observePod(snapshot.pod);
    this.dispatch({ type: 'detection', engaged, ended, exitDelayMs: this.exitDelayFor(snapshot) });
  }

  private wants(kind: SegmentKind): boolean {
    return kind === 'ad' || this.settings.promoActions[kind] === 'speed';
  }

  /**
   * D9: "segment over" means confidence ≤ exitThreshold for the full exit debounce. Only
   * tracked while suppressed after a cap; it is what lifts the suppression.
   */
  private trackSegmentOver(snapshot: AdStateSnapshot, belowExit: boolean): void {
    if (!this.suppressed || !belowExit) {
      this.clearSegmentOverTimer();
      return;
    }
    if (this.segmentOverTimer !== null) return;
    this.segmentOverTimer = setTimeout(() => {
      this.segmentOverTimer = null;
      this.suppressed = false;
      this.lastActive = null;
      this.log.debug('segment over; boosting allowed again');
    }, this.exitDelayFor(snapshot));
  }

  /** §3.4: 100 ms when SSAI is suspected, 1,000 ms when the pod has more ads, else default. */
  private exitDelayFor(snapshot: AdStateSnapshot): number {
    const aboveEnter = snapshot.confidence >= this.thresholds.enterThreshold;
    const reference = aboveEnter ? snapshot : (this.lastActive ?? snapshot);
    if (reference.ssaiSuspected) return SSAI_EXIT_DEBOUNCE_MS;
    const pod = reference.pod;
    if (pod && pod.index < pod.total) return POD_EXIT_DEBOUNCE_MS;
    return this.thresholds.exitDebounceMs;
  }

  private onNavigation(url: URL): void {
    this.forceRestore('navigation');
    this.closePage();
    this.pageIsWatch = this.adapter.isWatchContext(url);
    this.suppressed = false;
    this.clearSegmentOverTimer();
    this.lastActive = null;
    if (this.adapter.isWatchContext(url)) this.onSnapshot(this.adapter.evaluateNow());
    this.report();
  }

  private onVideoChange(next: HTMLVideoElement | null, _prev: HTMLVideoElement | null): void {
    if (next) this.bindVideo(next);
    const boosted = this.boostedVideo;
    if (boosted && next && next !== boosted && isBoostedPhase(this.machine.phase)) {
      this.log.debug('video node replaced mid-segment; transferring');
      const guardWasArmed = this.guard.armed;
      this.guard.disarm();
      this.engine.transfer(boosted, next);
      this.boostedVideo = next;
      if (this.machine.phase === 'EXIT_PENDING') this.engine.restoreRate(next);
      this.meter.resync();
      if (guardWasArmed) this.armGuard();
      this.syncCap();
    } else if (!isBoostedPhase(this.machine.phase) && next && this.latest) {
      // A video showing up can be what makes an already-active segment actionable.
      this.onSnapshot(this.latest);
    }
  }

  /** Per-element listeners; MediaTracker aborts them when the node changes. */
  private bindVideo(v: HTMLVideoElement): void {
    const signal = this.tracker?.bindingSignal ?? this.lifetime.signal;
    const isBoosted = () => v === this.boostedVideo && isBoostedPhase(this.machine.phase);

    // §3.2: the media load algorithm resets playbackRate on a new source.
    const onLoad = () => {
      // The rate only while BOOSTING: not when CONTESTED, nor in EXIT_PENDING (D25).
      if (isBoosted()) this.engine.reassert(v, { rate: this.machine.phase === 'BOOSTING' });
    };
    for (const type of ['loadedmetadata', 'playing', 'seeked']) {
      v.addEventListener(type, onLoad, { signal });
    }
    v.addEventListener(
      'seeking',
      () => {
        this.meter.resync();
      },
      { signal },
    );
    v.addEventListener(
      'waiting',
      () => {
        if (isBoosted()) this.onStall(v);
      },
      { signal },
    );
    v.addEventListener(
      'timeupdate',
      () => {
        if (!isBoosted()) return;
        this.meter.sample(v.currentTime);
        this.checkCapDeadline();
      },
      { signal },
    );
    // §3.3: a user unmute is respected for the rest of the segment; a site unmute is undone.
    v.addEventListener(
      'volumechange',
      () => {
        if (!isBoosted() || v.muted) return;
        if (this.isRecentUserInput()) {
          this.engine.markUserOverride(v, 'mute');
        } else {
          this.engine.reassert(v, { rate: false });
        }
      },
      { signal },
    );
    // §3.3: a user speed change stands the guard down (also covers rateEnforcement 'none').
    v.addEventListener(
      'ratechange',
      () => {
        if (!isBoosted()) return;
        const target = this.engine.appliedRate(v);
        if (target === null || sameRate(v.playbackRate, target)) return;
        if (this.isRecentUserInput()) {
          this.guard.disarm();
          this.onUserRateOverride(v);
        }
      },
      { signal },
    );
  }

  /**
   * D34: playback ran out of buffered media while boosted. On adapters that opt in, halve the
   * rate for the rest of the segment so the download can keep up; the stall at a high rate is
   * also what left content rebuffering right after the ad.
   */
  private onStall(v: HTMLVideoElement): void {
    if (this.machine.phase !== 'BOOSTING' || !this.adapter.getCapabilities().lowerRateOnStall)
      return;
    const applied = this.engine.appliedRate(v);
    if (applied === null || applied <= STALL_MIN_RATE) return;
    if (v.currentTime - this.boostStartedAt < STALL_GRACE_MEDIA_S) return; // ad still loading
    this.stallCeiling = Math.max(STALL_MIN_RATE, applied / 2);
    this.log.info(`stalled at ${String(applied)}x; lowering to ${String(this.stallCeiling)}x`);
    this.applyBoost(v);
    this.syncCap();
    this.report();
  }

  private onUserRateOverride(v: HTMLVideoElement): void {
    this.engine.markUserOverride(v, 'rate');
    this.meter.setRate(null);
    this.syncCap(); // the rate is no longer boosted: the muted-only cap applies (D9)
  }

  private isRecentUserInput(): boolean {
    return this.now() - this.lastTrustedInputAt <= TRUSTED_INPUT_WINDOW_MS;
  }

  /**
   * D14: ignore typing in editable fields, and input outside the adapter's interaction root.
   * D15: with a root, a keydown on <body>/<html> (nothing focused) still counts when its key is
   * one of the adapter's page-wide media shortcuts.
   */
  private isPlayerInteraction(event: Event): boolean {
    const target = event.target;
    if (!(target instanceof Element)) return true;
    if (target.closest(EDITABLE_TARGET)) return false;
    const root = this.adapter.getInteractionRoot?.() ?? null;
    if (root === null || root.contains(target)) return true;
    const unfocused = target === document.body || target === document.documentElement;
    if (!unfocused || !(event instanceof KeyboardEvent)) return false;
    return this.adapter.getMediaShortcutKeys?.().includes(event.key) ?? false;
  }

  private dispatch(event: MachineEvent): void {
    const before = this.machine;
    const [next, effects] = reduce(before, event);
    this.machine = next;
    if (next.phase !== before.phase) {
      this.log.debug(`${before.phase} → ${next.phase}`, event.type);
    }
    for (const effect of effects) this.run(effect);
    if (next.phase === 'RESTORING') {
      this.dispatch({ type: 'restored' });
      return;
    }
    this.syncCap();
    if (next.phase !== before.phase) {
      this.report();
      this.checkOrphan();
    }
  }

  private run(effect: MachineEffect): void {
    switch (effect.type) {
      case 'boost': {
        const v = this.tracker?.current;
        if (!v) return;
        this.boostedVideo = v;
        this.stallCeiling = null;
        this.boostStartedAt = v.currentTime;
        const rate = this.applyBoost(v);
        this.meter.startSegment({ currentTime: v.currentTime, rate, pod: this.latest?.pod });
        return;
      }
      case 'restore-rate': {
        const v = this.boostedVideo;
        if (!v) return;
        this.meter.pause(v.currentTime);
        this.engine.restoreRate(v);
        return;
      }
      case 'reboost': {
        const v = this.boostedVideo;
        if (!v) return;
        this.applyBoost(v);
        this.meter.resume(v.currentTime);
        return;
      }
      case 'arm-guard':
        this.armGuard();
        return;
      case 'disarm-guard':
        this.guard.disarm();
        return;
      case 'start-exit-timer':
        this.clearExitTimer();
        this.exitTimer = setTimeout(() => {
          this.exitTimer = null;
          this.dispatch({ type: 'exit-debounce-elapsed' });
        }, effect.ms);
        return;
      case 'cancel-exit-timer':
        this.clearExitTimer();
        return;
      case 'arm-cap':
        this.segmentStartedAt = this.now();
        this.syncCap();
        return;
      case 'cancel-cap':
        this.segmentStartedAt = null;
        this.clearCapTimer();
        return;
      case 'restore': {
        const v = this.boostedVideo;
        this.boostedVideo = null;
        this.meter.endSegment(v?.currentTime);
        this.engine.restore(v);
        this.stallCeiling = null;
        const current = this.tracker?.current ?? null;
        if (current !== v) this.engine.restore(current);
        this.lastActive = null;
        this.log.debug(`restored (${effect.reason})`);
        this.flushStats();
        return;
      }
    }
  }

  /** Applies the boost for the current settings and capabilities; returns the rate that stuck. */
  private applyBoost(v: HTMLVideoElement, allowRate = true): number | null {
    const caps = this.adapter.getCapabilities();
    const rate =
      allowRate && caps.allowRateBoost
        ? Math.min(
            this.settings.speed,
            caps.maxRateHint ?? Number.POSITIVE_INFINITY,
            this.stallCeiling ?? Number.POSITIVE_INFINITY,
          )
        : null;
    const applied = this.engine.boost(v, { rate, mute: caps.allowMute && this.settings.mute });
    this.meter.setRate(applied);
    return applied;
  }

  /**
   * D9: one wall-clock budget per segment, whose limit depends on the current mode: 90 s while
   * the rate is boosted, 300 s when it isn't (mute-only capability, CONTESTED, user override).
   * Re-arming on a mode change keeps the time already spent.
   */
  private syncCap(): void {
    const v = this.boostedVideo;
    if (!isBoostedPhase(this.machine.phase) || this.segmentStartedAt === null || !v) {
      this.clearCapTimer();
      return;
    }
    const rateBoosted = !this.machine.contested && this.engine.appliedRate(v) !== null;
    const mode: CapMode = rateBoosted ? 'boosted' : 'muted-only';
    if (this.capTimer !== null && this.capMode === mode) return;
    this.clearCapTimer();
    const remaining = Math.max(0, this.capLimit(mode) - (this.now() - this.segmentStartedAt));
    this.capMode = mode;
    this.capTimer = setTimeout(() => {
      this.capTimer = null;
      this.fireCap(mode);
    }, remaining);
  }

  private capLimit(mode: CapMode): number {
    return mode === 'boosted' ? this.maxBoostedMs : this.maxMutedOnlyMs;
  }

  /**
   * D19: the timer may be throttled in a background tab, so timeupdate and visibilitychange
   * also compare the clock against the cap. Elapsed time is always clock-based.
   */
  private checkCapDeadline(): void {
    const mode = this.capMode;
    if (mode === null || this.segmentStartedAt === null) return;
    if (this.now() - this.segmentStartedAt >= this.capLimit(mode)) this.fireCap(mode);
  }

  private fireCap(mode: CapMode): void {
    this.log.warn('detection-lost', {
      ...this.diagnostics(),
      cap: mode,
      limitMs: this.capLimit(mode),
    });
    this.suppressed = true;
    this.forceRestore(mode === 'boosted' ? 'max-boosted' : 'max-muted-only');
  }

  private armGuard(): void {
    const v = this.boostedVideo;
    const caps = this.adapter.getCapabilities();
    if (!v || caps.rateEnforcement !== 'guard' || this.engine.appliedRate(v) === null) return;
    this.guard.arm(v, this.lifetime.signal);
  }

  private recoverCrashMarkers(): void {
    for (const v of document.querySelectorAll<HTMLVideoElement>(`video[${BOOST_MARKER_ATTR}]`)) {
      if (this.engine.restore(v))
        this.log.info('restored a crash marker left by a previous instance');
    }
  }

  /** Platform + selector diagnostics for rate-contested, detection-lost and selector-drift. */
  private diagnostics(): Record<string, unknown> {
    const d = this.adapter.getDiagnostics?.();
    return d
      ? {
          platform: this.adapter.id,
          selectorsVersion: d.selectorsVersion,
          chainIndices: d.chainIndices,
        }
      : { platform: this.adapter.id };
  }

  /**
   * §2.3 selector-drift rule, evaluated once per watch page as it is left: a page counts as
   * drifting when any chain matched at a fallback index (> 0).
   */
  private closePage(): void {
    if (!this.pageIsWatch) return;
    const d = this.adapter.getDiagnostics?.();
    if (!d) return;
    const drifting = Object.values(d.chainIndices).some((index) => index > 0);
    this.driftStreak = drifting ? this.driftStreak + 1 : 0;
    if (this.driftStreak === SELECTOR_DRIFT_PAGES) {
      this.log.warn('selector-drift', this.diagnostics());
    }
  }

  private checkOrphan(): void {
    if (this.destroyed || this.isRuntimeAlive()) return;
    this.log.warn('extension context is gone (orphaned); restoring and tearing down');
    this.forceRestore('orphaned');
    this.destroy();
  }

  private flushStats(): void {
    const batch = this.meter.takeBatch();
    if (!batch) return;
    this.sendStats({ platform: this.adapter.id, ...batch }).catch((error: unknown) => {
      this.log.debug('stats batch not delivered', error);
    });
  }

  private report(): void {
    if (this.destroyed) return;
    const { phase, contested } = this.machine;
    const v = this.boostedVideo;
    let tabPhase: TabStatus['phase'] = 'inactive';
    if (isBoostedPhase(phase)) {
      tabPhase = contested ? 'contested' : 'boosting';
    } else if (
      this.settings.enabled &&
      this.settings.platforms[this.adapter.id] &&
      this.adapter.isWatchContext(new URL(location.href))
    ) {
      tabPhase = 'watching';
    }
    this.reportStatus({
      platform: this.adapter.id,
      maxRate: v
        ? Math.min(this.probe.maxFor(v), this.adapter.getCapabilities().maxRateHint ?? Infinity)
        : null,
      phase: tabPhase,
      rate: v && isBoostedPhase(phase) ? this.engine.appliedRate(v) : null,
      pod: isBoostedPhase(phase) ? (this.latest?.pod ?? null) : null,
    });
  }

  private clearExitTimer(): void {
    if (this.exitTimer === null) return;
    clearTimeout(this.exitTimer);
    this.exitTimer = null;
  }

  private clearCapTimer(): void {
    this.capMode = null;
    if (this.capTimer === null) return;
    clearTimeout(this.capTimer);
    this.capTimer = null;
  }

  private clearSegmentOverTimer(): void {
    if (this.segmentOverTimer === null) return;
    clearTimeout(this.segmentOverTimer);
    this.segmentOverTimer = null;
  }
}
