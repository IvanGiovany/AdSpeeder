import type { AdapterCapabilities } from '../platforms/PlatformAdapter';
import type { AdStateSnapshot } from '../platforms/signals';

/** The five engine states of §3.1. */
export type EngineState = 'IDLE' | 'BOOSTING' | 'EXIT_PENDING' | 'CONTESTED' | 'RESTORING';

/** Force-restore triggers, valid from any state (§3.1). */
export type ForceRestoreReason =
  | 'navigation'
  | 'destroy'
  | 'pagehide'
  | 'user-disabled'
  | 'platform-disabled'
  | 'max-boosted'
  | 'orphaned';

export type MachineEvent =
  | { type: 'snapshot'; snapshot: AdStateSnapshot; capabilities: AdapterCapabilities }
  | { type: 'exit-debounce-elapsed' }
  | { type: 'guard-exhausted' }
  | { type: 'restore-verified' }
  | { type: 'force-restore'; reason: ForceRestoreReason };

/** Side effects the Controller performs; the reducer itself owns no timers (Phase 2). */
export type MachineEffect =
  | { type: 'take-snapshot' }
  | { type: 'apply-boost' }
  | { type: 'arm-guard' }
  | { type: 'disarm-guard' }
  | { type: 'start-exit-timer'; ms: number }
  | { type: 'cancel-exit-timer' }
  | { type: 'restore' }
  | { type: 'schedule-verify'; ms: number };

/** Pure reducer: `(state, event) => [nextState, effects[]]`. */
export function reduce(_state: EngineState, _event: MachineEvent): [EngineState, MachineEffect[]] {
  throw new Error('not implemented');
}
