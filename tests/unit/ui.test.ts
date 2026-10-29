import { beforeEach, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { formatDuration, formatCount, formatStatus } from '../../src/ui/format';
import { getSettings, setSettings, validThresholds } from '../../src/shared/settings';
beforeEach(() => {
  fakeBrowser.reset();
});
it('formats short and long durations and counts', () => {
  expect(formatDuration(-1)).toBe('0s');
  expect(formatDuration(185)).toBe('3m 05s');
  expect(formatDuration(3720)).toBe('1h 02m');
  expect(formatCount(1200, 'en-US')).toBe('1,200');
  expect(
    formatStatus({ platform: 'youtube', phase: 'boosting', rate: 4, pod: { index: 1, total: 2 } }),
  ).toBe('Boosting ad 1 of 2 at 4×');
});
it('round-trips all UI settings and rejects unsafe thresholds', async () => {
  const patch = {
    enabled: false,
    mute: false,
    speed: 4 as const,
    platforms: { netflix: true, youtube: false },
    promoActions: { intro: 'speed' as const, recap: 'speed' as const, promo: 'speed' as const },
    debug: true,
    thresholds: { enterThreshold: 0.7, exitThreshold: 0.1, exitDebounceMs: 250 },
  };
  await setSettings(patch);
  expect(await getSettings()).toMatchObject(patch);
  expect(validThresholds({ ...patch.thresholds, exitThreshold: 0.8 })).toBe(false);
  expect(validThresholds({ ...patch.thresholds, exitDebounceMs: 0 })).toBe(false);
});
