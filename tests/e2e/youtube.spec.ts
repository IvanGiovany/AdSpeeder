import { at, expect, openScenario, runScenario, test, type LogEntry } from './harness';

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
    const restored = at(log, 'rate', 1.5, adEnd);
    expect(measured('pod restore', restored - adEnd)).toBeLessThanOrEqual(RESTORE_WITHIN_MS);
    expect(at(log, 'muted', false, adEnd) - adEnd).toBeLessThanOrEqual(RESTORE_WITHIN_MS);

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
    const restored = at(log, 'rate', 1.25, zero);
    expect(measured('ssai restore after 0:00', restored - zero)).toBeLessThanOrEqual(
      BOOST_WITHIN_MS,
    );
    expect(restored).toBeLessThan(at(log, 'ad-end'));
    expect(markers(log)).toEqual([true, false]);
  });

  test('stitched pre-roll with the bridge: 100 ms SSAI exit after the countdown reaches 0', async ({
    context,
  }) => {
    const page = await openScenario(context, 'ssai-preroll');
    const log = await runScenario(page);

    const zero = at(log, 'countdown', '0:00');
    const restored = at(log, 'rate', 1.25, zero);
    expect(
      measured('stitched pre-roll restore after 0:00', restored - zero),
    ).toBeGreaterThanOrEqual(SSAI_EXIT_DEBOUNCE_MS);
    expect(restored - zero).toBeLessThan(EXIT_DEBOUNCE_MS);
    expect(restored).toBeLessThan(at(log, 'ad-end'));
    expect(markers(log)).toEqual([true, false]);
  });

  test('stitched pre-roll without the bridge: normal 300 ms exit after ad-showing clears', async ({
    context,
  }) => {
    const page = await openScenario(context, 'ssai-preroll-nobridge');
    const log = await runScenario(page);

    const adEnd = at(log, 'ad-end');
    const restored = at(log, 'rate', 1.25, at(log, 'countdown', '0:00'));
    expect(restored).toBeGreaterThan(adEnd); // countdown 0 alone did not end it
    expect(
      measured('no-bridge pre-roll restore after ad-end', restored - adEnd),
    ).toBeGreaterThanOrEqual(EXIT_DEBOUNCE_MS);
    expect(restored - adEnd).toBeLessThanOrEqual(RESTORE_WITHIN_MS);
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
