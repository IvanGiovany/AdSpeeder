import type { PlatformAdapter } from '../platforms/PlatformAdapter';
import type { Logger } from '../shared/logger';
import type { Settings } from '../shared/settings';

export interface ControllerOptions {
  adapter: PlatformAdapter;
  settings: Readonly<Settings>;
  log: Logger;
  /** Aborted when the content script unloads; every listener and timer hangs off it. */
  signal: AbortSignal;
}

/**
 * Wires adapter snapshots → AdStateMachine → VideoEngine, owns the timers, and runs every
 * force-restore trigger plus orphan detection (§3.1, §3.6).
 */
export class Controller {
  constructor(private readonly options: ControllerOptions) {}

  start(): Promise<void> {
    throw new Error('not implemented');
  }

  updateSettings(_settings: Readonly<Settings>): void {
    throw new Error('not implemented');
  }

  destroy(): void {
    throw new Error('not implemented');
  }
}
