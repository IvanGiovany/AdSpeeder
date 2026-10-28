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

export const MAX_BOOSTED_MS = 90_000;
export const ORPHAN_CHECK_MS = 5_000;
export const STATS_FLUSH_MS = 10_000;
export const TRUSTED_INPUT_WINDOW_MS = 500;
export const POD_EXIT_DEBOUNCE_MS = 1_000;
export const SSAI_EXIT_DEBOUNCE_MS = 100;

export interface ControllerOptions {
  adapter: PlatformAdapter;
  settings: Readonly<Settings>;
  log: Logger;
  /** Aborted when the content script unloads; every listener and timer hangs off it. */
  signal: AbortSignal;
  thresholds?: Readonly<Thresholds>;
  maxBoostedMs?: number;
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
  private readonly thresholds: Readonly<Thresholds>;
  private readonly maxBoostedMs: number;
  private readonly now: () => number;
  private readonly isRuntimeAlive: () => boolean;
  private readonly sendStats: (batch: StatsBatch) => Promise<void>;
  private readonly reportStatus: (status: TabStatus) => void;

  private readonly engine: VideoEngine;
  private readonly guard: RateGuard;
  private readonly meter: StatsMeter;
  private tracker: MediaTracker | null = null;

  private settings: Readonly<Settings>;
  private machine: MachineState = INITIAL_STATE;
  private boostedVideo: HTMLVideoElement | null = null;
  private latest: AdStateSnapshot | null = null;
  /** The last active snapshot; its pod/SSAI info picks the exit debounce after the ad UI goes. */
  private lastActive: AdStateSnapshot | null = null;
  /** After maxBoostedMs fires, don't re-boost until the adapter reports the segment over. */
  private suppressUntilInactive = false;
  private lastTrustedInputAt = Number.NEGATIVE_INFINITY;
  private exitTimer: ReturnType<typeof setTimeout> | null = null;
  private capTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubscribers: (() => void)[] = [];
  private destroyed = false;

  constructor(options: ControllerOptions) {
    this.adapter = options.adapter;
    this.settings = options.settings;
    this.log = options.log;
    this.thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
    this.maxBoostedMs = options.maxBoostedMs ?? MAX_BOOSTED_MS;
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

    this.engine = new VideoEngine(new RateProbe(), this.log);
    this.meter = new StatsMeter(this.now);
    this.guard = new RateGuard(
      {
        target: (v) => this.engine.appliedRate(v),
        reassert: (v) => {
          this.engine.reassert(v);
        },
        isRecentUserInput: () => this.isRecentUserInput(),
        onUserOverride: (v) => {
          this.engine.markUserOverride(v, 'rate');
          this.meter.setRate(null);
        },
        onContested: () => {
          this.log.warn('rate-contested', { platform: this.adapter.id });
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

    const noteInput = (event: Event) => {
      if (event.isTrusted) this.lastTrustedInputAt = this.now();
    };
    document.addEventListener('pointerdown', noteInput, { capture: true, signal });
    document.addEventListener('keydown', noteInput, { capture: true, signal });
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

    this.onSnapshot(this.adapter.evaluateNow());
    this.report();
  }

  updateSettings(settings: Readonly<Settings>): void {
    this.settings = settings;
    if (!settings.enabled) {
      this.forceRestore('user-disabled');
    } else if (!settings.platforms[this.adapter.id]) {
      this.forceRestore('platform-disabled');
    } else if (isBoostedPhase(this.machine.phase) && this.boostedVideo) {
      this.applyBoost(this.boostedVideo); // speed or mute changed mid-segment
    }
    if (this.latest) this.onSnapshot(this.latest);
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

  private onSnapshot(snapshot: AdStateSnapshot): void {
    if (this.destroyed) return;
    this.latest = snapshot;
    if (!snapshot.active) this.suppressUntilInactive = false;
    if (snapshot.active) this.lastActive = snapshot;

    const relevant = snapshot.kind !== null && this.wants(snapshot.kind);
    const caps = this.adapter.getCapabilities();
    const canAct = caps.allowRateBoost || (caps.allowMute && this.settings.mute);
    const enabled = this.settings.enabled && this.settings.platforms[this.adapter.id];
    const engaged =
      enabled &&
      snapshot.active &&
      relevant &&
      canAct &&
      !this.suppressUntilInactive &&
      this.tracker?.current != null &&
      this.adapter.isWatchContext(new URL(location.href));
    const ended = !enabled || !relevant || snapshot.confidence <= this.thresholds.exitThreshold;

    if (isBoostedPhase(this.machine.phase)) this.meter.observePod(snapshot.pod);
    this.dispatch({ type: 'detection', engaged, ended, exitDelayMs: this.exitDelayFor(snapshot) });
  }

  private wants(kind: SegmentKind): boolean {
    return kind === 'ad' || this.settings.promoActions[kind] === 'speed';
  }

  /** §3.4: 100 ms when SSAI is suspected, 1,000 ms when the pod has more ads, else default. */
  private exitDelayFor(snapshot: AdStateSnapshot): number {
    const reference = snapshot.active ? snapshot : (this.lastActive ?? snapshot);
    if (reference.ssaiSuspected) return SSAI_EXIT_DEBOUNCE_MS;
    const pod = reference.pod;
    if (pod && pod.index < pod.total) return POD_EXIT_DEBOUNCE_MS;
    return this.thresholds.exitDebounceMs;
  }

  private onNavigation(url: URL): void {
    this.forceRestore('navigation');
    this.suppressUntilInactive = false;
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
      this.meter.resync();
      if (guardWasArmed) this.armGuard();
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
      if (isBoosted()) this.engine.reassert(v, { rate: this.machine.phase !== 'CONTESTED' });
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
      'timeupdate',
      () => {
        if (isBoosted()) this.meter.sample(v.currentTime);
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
          this.engine.markUserOverride(v, 'rate');
          this.meter.setRate(null);
        }
      },
      { signal },
    );
  }

  private isRecentUserInput(): boolean {
    return this.now() - this.lastTrustedInputAt <= TRUSTED_INPUT_WINDOW_MS;
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
        const rate = this.applyBoost(v);
        this.meter.startSegment({ currentTime: v.currentTime, rate, pod: this.latest?.pod });
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
        this.clearCapTimer();
        this.capTimer = setTimeout(() => {
          this.capTimer = null;
          this.log.warn('detection-lost: maxBoostedMs reached; restoring', {
            platform: this.adapter.id,
          });
          this.suppressUntilInactive = true;
          this.forceRestore('max-boosted');
        }, this.maxBoostedMs);
        return;
      case 'cancel-cap':
        this.clearCapTimer();
        return;
      case 'restore': {
        const v = this.boostedVideo;
        this.boostedVideo = null;
        this.meter.endSegment(v?.currentTime);
        this.engine.restore(v);
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
  private applyBoost(v: HTMLVideoElement): number | null {
    const caps = this.adapter.getCapabilities();
    const rate = caps.allowRateBoost
      ? Math.min(this.settings.speed, caps.maxRateHint ?? Number.POSITIVE_INFINITY)
      : null;
    const applied = this.engine.boost(v, { rate, mute: caps.allowMute && this.settings.mute });
    this.meter.setRate(applied);
    return applied;
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
    if (this.capTimer === null) return;
    clearTimeout(this.capTimer);
    this.capTimer = null;
  }
}
