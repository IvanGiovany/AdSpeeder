import { describe, expect, it } from 'vitest';
import {
  INITIAL_STATE,
  isBoostedPhase,
  reduce,
  type MachineEvent,
  type MachineState,
} from '../../../src/core/AdStateMachine';

const engaged: MachineEvent = { type: 'detection', engaged: true, ended: false, exitDelayMs: 300 };
const ended: MachineEvent = { type: 'detection', engaged: false, ended: true, exitDelayMs: 300 };
const s = (phase: MachineState['phase'], contested = false): MachineState => ({ phase, contested });

describe('AdStateMachine.reduce', () => {
  it('IDLE → BOOSTING on an engaged detection, taking the only snapshot', () => {
    expect(reduce(INITIAL_STATE, engaged)).toEqual([
      s('BOOSTING'),
      [{ type: 'boost' }, { type: 'arm-guard' }, { type: 'arm-cap' }],
    ]);
  });

  it('stays IDLE without engagement or on stray events', () => {
    for (const event of [
      ended,
      { type: 'exit-debounce-elapsed' },
      { type: 'guard-exhausted' },
    ] as const) {
      expect(reduce(INITIAL_STATE, event)).toEqual([INITIAL_STATE, []]);
    }
  });

  it('BOOSTING → EXIT_PENDING with the event’s debounce; recovery returns without re-boosting', () => {
    const [pending, effects] = reduce(s('BOOSTING'), { ...ended, exitDelayMs: 1000 });
    expect(pending).toEqual(s('EXIT_PENDING'));
    expect(effects).toEqual([{ type: 'start-exit-timer', ms: 1000 }]);
    expect(reduce(pending, engaged)).toEqual([s('BOOSTING'), [{ type: 'cancel-exit-timer' }]]);
  });

  it('BOOSTING ignores detections that have not ended', () => {
    expect(reduce(s('BOOSTING'), engaged)).toEqual([s('BOOSTING'), []]);
  });

  it('EXIT_PENDING → RESTORING when the debounce elapses, then IDLE', () => {
    const [restoring, effects] = reduce(s('EXIT_PENDING'), { type: 'exit-debounce-elapsed' });
    expect(restoring).toEqual(s('RESTORING'));
    expect(effects).toContainEqual({ type: 'restore', reason: 'segment-end' });
    expect(effects).toContainEqual({ type: 'disarm-guard' });
    expect(reduce(restoring, { type: 'restored' })).toEqual([INITIAL_STATE, []]);
    expect(reduce(restoring, engaged)).toEqual([restoring, []]);
  });

  it('BOOSTING → CONTESTED when the guard budget is exhausted', () => {
    expect(reduce(s('BOOSTING'), { type: 'guard-exhausted' })).toEqual([
      s('CONTESTED', true),
      [{ type: 'disarm-guard' }],
    ]);
  });

  it('CONTESTED still follows the exit path and returns to CONTESTED on recovery', () => {
    const [pending] = reduce(s('CONTESTED', true), ended);
    expect(pending).toEqual(s('EXIT_PENDING', true));
    expect(reduce(pending, engaged)[0]).toEqual(s('CONTESTED', true));
    expect(reduce(pending, { type: 'exit-debounce-elapsed' })[0]).toEqual(s('RESTORING'));
    expect(reduce(s('CONTESTED', true), { type: 'guard-exhausted' })).toEqual([
      s('CONTESTED', true),
      [],
    ]);
  });

  it('guard exhaustion during EXIT_PENDING marks the segment contested once', () => {
    const [next, effects] = reduce(s('EXIT_PENDING'), { type: 'guard-exhausted' });
    expect(next).toEqual(s('EXIT_PENDING', true));
    expect(effects).toEqual([{ type: 'disarm-guard' }]);
    expect(reduce(next, { type: 'guard-exhausted' })).toEqual([next, []]);
  });

  it('force-restore from any boosted state funnels into RESTORING with its reason', () => {
    for (const phase of ['BOOSTING', 'EXIT_PENDING', 'CONTESTED'] as const) {
      const [next, effects] = reduce(s(phase), { type: 'force-restore', reason: 'navigation' });
      expect(next).toEqual(s('RESTORING'));
      expect(effects).toEqual([
        { type: 'cancel-exit-timer' },
        { type: 'disarm-guard' },
        { type: 'cancel-cap' },
        { type: 'restore', reason: 'navigation' },
      ]);
    }
  });

  it('force-restore is a no-op in IDLE and RESTORING', () => {
    const event: MachineEvent = { type: 'force-restore', reason: 'pagehide' };
    expect(reduce(INITIAL_STATE, event)).toEqual([INITIAL_STATE, []]);
    expect(reduce(s('RESTORING'), event)).toEqual([s('RESTORING'), []]);
  });

  it('isBoostedPhase covers exactly the states that hold a snapshot', () => {
    expect(
      ['IDLE', 'BOOSTING', 'EXIT_PENDING', 'CONTESTED', 'RESTORING'].filter((p) =>
        isBoostedPhase(p as MachineState['phase']),
      ),
    ).toEqual(['BOOSTING', 'EXIT_PENDING', 'CONTESTED']);
  });
});
