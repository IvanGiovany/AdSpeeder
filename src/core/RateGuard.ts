import { childController } from '../shared/dom';

/** Budget and backoff for re-asserting the target rate against site resets (§3.5). */
export interface RateGuardOptions {
  /** Rewrites allowed per window (token bucket). */
  budget: number;
  windowMs: number;
  /** Delay before each successive rewrite; the last value repeats. */
  backoffMs: readonly number[];
}

export const DEFAULT_RATE_GUARD_OPTIONS: Readonly<RateGuardOptions> = {
  budget: 10,
  windowMs: 5000,
  backoffMs: [0, 50, 100, 200, 400],
};

export interface RateGuardHooks {
  /** The rate the engine applied, or null when the rate isn't boosted. */
  target: (v: HTMLVideoElement) => number | null;
  /** Asks the engine to rewrite the rate; the guard never writes it itself. */
  reassert: (v: HTMLVideoElement) => void;
  /** True within the trusted-input window (§3.3). */
  isRecentUserInput: () => boolean;
  onUserOverride: (v: HTMLVideoElement) => void;
  onContested: (v: HTMLVideoElement) => void;
}

const RATE_EPSILON = 1e-3;

export class RateGuard {
  private binding: AbortController | null = null;
  private takes: number[] = [];
  private backoffStep = 0;
  private pending: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly hooks: RateGuardHooks,
    private readonly options: RateGuardOptions = DEFAULT_RATE_GUARD_OPTIONS,
    private readonly now: () => number = () => performance.now(),
  ) {}

  get armed(): boolean {
    return this.binding !== null;
  }

  /** Watches `ratechange` on `v` until disarmed or until `signal` aborts. */
  arm(v: HTMLVideoElement, signal: AbortSignal): void {
    this.disarm();
    if (signal.aborted) return;
    const binding = childController(signal);
    binding.signal.addEventListener(
      'abort',
      () => {
        if (this.binding === binding) this.disarm();
      },
      { once: true },
    );
    this.binding = binding;
    this.takes = [];
    this.backoffStep = 0;
    v.addEventListener(
      'ratechange',
      () => {
        this.onRateChange(v);
      },
      { signal: binding.signal },
    );
  }

  disarm(): void {
    const binding = this.binding;
    this.binding = null;
    if (this.pending !== null) {
      clearTimeout(this.pending);
      this.pending = null;
    }
    binding?.abort();
  }

  private onRateChange(v: HTMLVideoElement): void {
    const target = this.hooks.target(v);
    // Our own write echoing back: compared against the target, not a "writing" flag, because
    // ratechange fires asynchronously.
    if (target === null || Math.abs(v.playbackRate - target) < RATE_EPSILON) return;
    if (this.hooks.isRecentUserInput()) {
      this.disarm();
      this.hooks.onUserOverride(v);
      return;
    }
    if (this.pending !== null) return; // a rewrite is already queued
    if (!this.take()) {
      this.disarm();
      this.hooks.onContested(v);
      return;
    }
    const { backoffMs } = this.options;
    const delay = backoffMs[Math.min(this.backoffStep, backoffMs.length - 1)] ?? 0;
    this.backoffStep += 1;
    this.pending = setTimeout(() => {
      this.pending = null;
      if (this.armed) this.hooks.reassert(v);
    }, delay);
  }

  private take(): boolean {
    const now = this.now();
    this.takes = this.takes.filter((t) => now - t < this.options.windowMs);
    if (this.takes.length >= this.options.budget) return false;
    this.takes.push(now);
    return true;
  }
}
