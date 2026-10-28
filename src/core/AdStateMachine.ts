/** The five engine states of §3.1 (D3). */
export type EngineState = 'IDLE' | 'BOOSTING' | 'EXIT_PENDING' | 'CONTESTED' | 'RESTORING';

export interface MachineState {
  phase: EngineState;
  /**
   * Whether RateGuard gave up during this segment. EXIT_PENDING returns to CONTESTED rather
   * than BOOSTING when set, so the guard is never re-armed mid-segment.
   */
  contested: boolean;
}

export const INITIAL_STATE: MachineState = { phase: 'IDLE', contested: false };

/** Force-restore triggers, valid from any state (§3.1). */
export type ForceRestoreReason =
  | 'navigation'
  | 'destroy'
  | 'pagehide'
  | 'user-disabled'
  | 'platform-disabled'
  | 'max-boosted'
  | 'orphaned';

export type RestoreReason = ForceRestoreReason | 'segment-end';

export type MachineEvent =
  /**
   * A digested adapter snapshot. `engaged`: a segment we act on is active (enter).
   * `ended`: confidence is at or below the exit threshold, or the segment no longer applies.
   * `exitDelayMs`: debounce to use if this event starts EXIT_PENDING (§3.4).
   */
  | { type: 'detection'; engaged: boolean; ended: boolean; exitDelayMs: number }
  | { type: 'exit-debounce-elapsed' }
  | { type: 'guard-exhausted' }
  | { type: 'force-restore'; reason: ForceRestoreReason }
  | { type: 'restored' };

/** Side effects the Controller performs. The reducer owns no timers. */
export type MachineEffect =
  | { type: 'boost' }
  | { type: 'arm-guard' }
  | { type: 'disarm-guard' }
  | { type: 'start-exit-timer'; ms: number }
  | { type: 'cancel-exit-timer' }
  | { type: 'arm-cap' }
  | { type: 'cancel-cap' }
  | { type: 'restore'; reason: RestoreReason };

type Transition = [MachineState, MachineEffect[]];

const state = (phase: EngineState, contested = false): MachineState => ({ phase, contested });

function restoring(reason: RestoreReason): Transition {
  return [
    state('RESTORING'),
    [
      { type: 'cancel-exit-timer' },
      { type: 'disarm-guard' },
      { type: 'cancel-cap' },
      { type: 'restore', reason },
    ],
  ];
}

/** Pure reducer: `(state, event) => [nextState, effects[]]` (§3.1). */
export function reduce(current: MachineState, event: MachineEvent): Transition {
  const unchanged: Transition = [current, []];
  const { phase, contested } = current;

  if (event.type === 'force-restore') {
    return phase === 'IDLE' || phase === 'RESTORING' ? unchanged : restoring(event.reason);
  }

  switch (phase) {
    case 'IDLE':
      if (event.type === 'detection' && event.engaged) {
        // The only place a snapshot is taken: the boost effect from IDLE.
        return [state('BOOSTING'), [{ type: 'boost' }, { type: 'arm-guard' }, { type: 'arm-cap' }]];
      }
      return unchanged;

    case 'BOOSTING':
    case 'CONTESTED':
      if (event.type === 'detection' && event.ended) {
        return [
          state('EXIT_PENDING', contested),
          [{ type: 'start-exit-timer', ms: event.exitDelayMs }],
        ];
      }
      if (event.type === 'guard-exhausted' && phase === 'BOOSTING') {
        return [state('CONTESTED', true), [{ type: 'disarm-guard' }]];
      }
      return unchanged;

    case 'EXIT_PENDING':
      if (event.type === 'detection' && !event.ended) {
        // Pod transition: same snapshot, boost kept.
        return [
          state(contested ? 'CONTESTED' : 'BOOSTING', contested),
          [{ type: 'cancel-exit-timer' }],
        ];
      }
      if (event.type === 'exit-debounce-elapsed') return restoring('segment-end');
      if (event.type === 'guard-exhausted' && !contested) {
        return [state('EXIT_PENDING', true), [{ type: 'disarm-guard' }]];
      }
      return unchanged;

    case 'RESTORING':
      return event.type === 'restored' ? [INITIAL_STATE, []] : unchanged;
  }
}

/** States in which a boost (snapshot + rate/mute) is held. */
export function isBoostedPhase(phase: EngineState): boolean {
  return phase === 'BOOSTING' || phase === 'EXIT_PENDING' || phase === 'CONTESTED';
}
