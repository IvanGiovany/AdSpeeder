/** Budget and backoff for re-asserting the target rate against site resets (§3.5). */
export interface RateGuardOptions {
  budget: number;
  windowMs: number;
  backoffMs: readonly number[];
  trustedInputWindowMs: number;
}

export const DEFAULT_RATE_GUARD_OPTIONS: Readonly<RateGuardOptions> = {
  budget: 10,
  windowMs: 5000,
  backoffMs: [0, 50, 100, 200, 400],
  trustedInputWindowMs: 500,
};

export interface RateGuardHooks {
  /** Asks the engine to rewrite the rate; the guard never writes it itself. */
  reassert: (v: HTMLVideoElement) => void;
  onContested: () => void;
  onUserOverride: () => void;
}

export class RateGuard {
  constructor(
    private readonly hooks: RateGuardHooks,
    private readonly options: RateGuardOptions = DEFAULT_RATE_GUARD_OPTIONS,
  ) {}

  /** Starts watching `ratechange` on `v`; listeners are removed when `signal` aborts. */
  arm(_v: HTMLVideoElement, _target: number, _signal: AbortSignal): void {
    throw new Error('not implemented');
  }

  disarm(): void {
    throw new Error('not implemented');
  }

  /** Records a trusted pointerdown/keydown time (§3.3). */
  noteTrustedInput(_at: number): void {
    throw new Error('not implemented');
  }
}
