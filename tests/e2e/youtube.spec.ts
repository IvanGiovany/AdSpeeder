import {
  at,
  expect,
  mediaAdvanced,
  openScenario,
  runScenario,
  test,
  type LogEntry,
} from './harness';

/** §5 Phase 3 "Done when" budgets. */
const BOOST_WITHIN_MS = 250;
const RESTORE_WITHIN_MS = 400;
/** §3.4 exit debounces: default and SSAI. */
const EXIT_DEBOUNCE_MS = 300;
const SSAI_EXIT_DEBOUNCE_MS = 100;

const rates = (log: LogEntry[]) =>
  log.filter((e) => e.what === 'rate').map((e) => e.value as number);
const markers = (log: LogEntry[]) =>
  log.filter((e) => e.what === 'marker').map((e) => e.value as boolean);

/** D25: the speed comes back at once; only the unmute waits for the exit debounce. */
const RATE_BACK_WITHIN_MS = 50;
/** D25: content may advance at most debounce × 1.0 between the exit and the full restore. */
const OVERRUN_TOLERANCE_S = 0.05;
/**
 * D25: after a rate drop from 16x, Chromium's media clock stalls ~30 ms and then jumps
 * 0.55–0.83 s of media (queued 16x audio draining). AdSpeeder writes the rate within ~2 ms
 * and cannot remove this. Used only where the rate drops on a playing source (SSAI); the old
 * single-stage exit would advance ~2.4 s there, so the check still catches a regression.
 */
const CHROMIUM_RATE_DROP_DRAIN_S = 1.0;

/** Prints a measured latency so runs can be compared against the budgets. */
function measured(label: string, ms: number): number {
  console.log(`[timing] ${label}: ${ms.toFixed(1)} ms`);
  return ms;
}

test.describe('YouTube fixtures (Chromium build, local only)', () => {
  test('ad pod: boost ≤ 250 ms, one snapshot across the pod, restore ≤ 400 ms', async ({
    context,
    blocked,
  }) => {
    const page = await openScenario(context, 'ad-pod');
    const log = await runScenario(page);

    const adShowing = at(log, 'ad-showing');
    const boosted = at(log, 'rate', 16, adShowing);
    expect(measured('pod boost', boosted - adShowing)).toBeLessThanOrEqual(BOOST_WITHIN_MS);
    expect(at(log, 'muted', true, adShowing) - adShowing).toBeLessThanOrEqual(BOOST_WITHIN_MS);

    // One snapshot for the whole pod: the crash marker is written once and removed once.
    expect(markers(log)).toEqual([true, false]);
    const ad2 = log.find(
      (e) => e.what === 'ad-showing' && (e.value as { index: number }).index === 2,
    );
    expect(ad2).toBeDefined();
    expect(at(log, 'marker', false)).toBeGreaterThan(ad2?.t ?? Infinity);

    const adEnd = at(log, 'ad-end');
    const rateBack = at(log, 'rate', 1.5, adEnd);
    expect(measured('pod rate back', rateBack - adEnd)).toBeLessThanOrEqual(RATE_BACK_WITHIN_MS);
    const unmuted = at(log, 'muted', false, adEnd);
    expect(measured('pod unmute', unmuted - adEnd)).toBeGreaterThanOrEqual(EXIT_DEBOUNCE_MS);
    expect(unmuted - adEnd).toBeLessThanOrEqual(RESTORE_WITHIN_MS);

    // D25: no boost rate between ad-showing clearing and the full restore, and content
    // advances at most debounce × 1.0 (+ tolerance) in that window. The content src must
    // really start playing inside the window, or the measurement would prove nothing.
    const fullRestore = at(log, 'marker', false, adEnd);
    const boostedAfterEnd = log.filter(
      (e) => e.what === 'rate' && e.t > adEnd && e.t <= fullRestore && (e.value as number) > 1.5,
    );
    expect(boostedAfterEnd).toEqual([]);
    const advanced = mediaAdvanced(log, adEnd, fullRestore);
    console.log(`[timing] pod content advanced in EXIT_PENDING: ${advanced.toFixed(3)} s`);
    expect(at(log, 'playing', undefined, adEnd)).toBeLessThan(fullRestore);
    expect(advanced).toBeGreaterThan(0);
    expect(advanced).toBeLessThanOrEqual(EXIT_DEBOUNCE_MS / 1000 + OVERRUN_TOLERANCE_S);

    const final = await page.evaluate(() => {
      const v = document.querySelector('video');
      return { rate: v?.playbackRate, muted: v?.muted };
    });
    expect(final).toEqual({ rate: 1.5, muted: false });
    expect(blocked).toEqual([]);
  });

  test('SSAI: restores when the countdown reaches 0, before ad-showing clears', async ({
    context,
  }) => {
    const page = await openScenario(context, 'ssai');
    const log = await runScenario(page);

    const adShowing = at(log, 'ad-showing');
    expect(measured('ssai boost', at(log, 'rate', 16, adShowing) - adShowing)).toBeLessThanOrEqual(
      BOOST_WITHIN_MS,
    );

    const zero = at(log, 'countdown', '0:00');
    const rateBack = at(log, 'rate', 1.25, zero);
    expect(measured('ssai rate back after 0:00', rateBack - zero)).toBeLessThanOrEqual(
      RATE_BACK_WITHIN_MS,
    );
    const fullRestore = at(log, 'marker', false, zero);
    expect(measured('ssai unmute after 0:00', fullRestore - zero)).toBeGreaterThanOrEqual(
      SSAI_EXIT_DEBOUNCE_MS,
    );
    expect(fullRestore).toBeLessThan(at(log, 'ad-end'));
    expect(markers(log)).toEqual([true, false]);

    // D25, measured from the exit (countdown 0:00): on SSAI the restore precedes ad-showing
    // clearing, so the window that matters starts at the exit trigger.
    const advanced = mediaAdvanced(log, zero, fullRestore);
    console.log(`[timing] ssai content advanced in EXIT_PENDING: ${advanced.toFixed(3)} s`);
    expect(advanced).toBeGreaterThan(0);
    expect(advanced).toBeLessThanOrEqual(
      SSAI_EXIT_DEBOUNCE_MS / 1000 + OVERRUN_TOLERANCE_S + CHROMIUM_RATE_DROP_DRAIN_S,
    );
  });

  test('stitched pre-roll with the bridge: 100 ms SSAI exit after the countdown reaches 0', async ({
    context,
  }) => {
    const page = await openScenario(context, 'ssai-preroll');
    const log = await runScenario(page);

    const zero = at(log, 'countdown', '0:00');
    expect(at(log, 'rate', 1.25, zero) - zero).toBeLessThanOrEqual(RATE_BACK_WITHIN_MS);
    const unmuted = at(log, 'muted', false, zero);
    expect(measured('stitched pre-roll unmute after 0:00', unmuted - zero)).toBeGreaterThanOrEqual(
      SSAI_EXIT_DEBOUNCE_MS,
    );
    expect(unmuted - zero).toBeLessThan(EXIT_DEBOUNCE_MS);
    expect(unmuted).toBeLessThan(at(log, 'ad-end'));
    expect(markers(log)).toEqual([true, false]);
  });

  test('stitched pre-roll without the bridge: normal 300 ms exit after ad-showing clears', async ({
    context,
  }) => {
    const page = await openScenario(context, 'ssai-preroll-nobridge');
    const log = await runScenario(page);

    const adEnd = at(log, 'ad-end');
    const rateBack = at(log, 'rate', 1.25, at(log, 'countdown', '0:00'));
    expect(rateBack).toBeGreaterThan(adEnd); // countdown 0 alone did not end it
    expect(rateBack - adEnd).toBeLessThanOrEqual(RATE_BACK_WITHIN_MS);
    const unmuted = at(log, 'muted', false, adEnd);
    expect(
      measured('no-bridge pre-roll unmute after ad-end', unmuted - adEnd),
    ).toBeGreaterThanOrEqual(EXIT_DEBOUNCE_MS);
    expect(unmuted - adEnd).toBeLessThanOrEqual(RESTORE_WITHIN_MS);
    expect(markers(log)).toEqual([true, false]);
  });

  test('live: mutes the ad but never boosts the rate', async ({ context }) => {
    const page = await openScenario(context, 'live');
    const log = await runScenario(page);

    expect(rates(log).filter((r) => r > 1)).toEqual([]);
    const adShowing = at(log, 'ad-showing');
    expect(at(log, 'muted', true, adShowing) - adShowing).toBeLessThanOrEqual(BOOST_WITHIN_MS);
    const adEnd = at(log, 'ad-end');
    expect(at(log, 'muted', false, adEnd) - adEnd).toBeLessThanOrEqual(RESTORE_WITHIN_MS);
    expect(await page.evaluate(() => document.querySelector('video')?.playbackRate)).toBe(1);
  });
});
