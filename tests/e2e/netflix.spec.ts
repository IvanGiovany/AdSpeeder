import { test, expect } from './harness';

test('captured Netflix ad label: opt-in, boost to 16, exact restore and promo defaults', async ({
  context,
}) => {
  const worker = context.serviceWorkers()[0];
  if (!worker) throw new Error('Missing worker');
  const options = await context.newPage();
  await options.goto(new URL('/options.html', worker.url()).href);
  await options.evaluate(async () => {
    const browser = (globalThis as unknown as { chrome: typeof import('wxt/browser').browser })
      .chrome;
    const { settings } = await browser.storage.local.get('settings');
    await browser.storage.local.set({
      settings: {
        ...(settings as Record<string, unknown>),
        platforms: { youtube: true, netflix: true },
      },
    });
  });
  const page = await context.newPage();
  await page.goto('https://www.netflix.com/watch/123');
  await page.waitForTimeout(400);
  await page.locator('video').evaluate((v) => {
    (v as HTMLVideoElement).playbackRate = 1.5;
  });
  await page.locator('[data-uia="ads-info-text"]').evaluate((el) => {
    el.textContent = 'Ad';
  });
  await expect
    .poll(() => page.locator('video').evaluate((v) => (v as HTMLVideoElement).playbackRate))
    .toBe(16);
  await expect
    .poll(() => page.locator('video').evaluate((v) => (v as HTMLVideoElement).muted))
    .toBe(true);
  await page.locator('[data-uia="ads-info-text"]').evaluate((el) => {
    el.textContent = 'Episode';
  });
  await expect
    .poll(() =>
      page
        .locator('video')
        .evaluate((v) => [(v as HTMLVideoElement).playbackRate, (v as HTMLVideoElement).muted]),
    )
    .toEqual([1.5, false]);
  for (const key of ['player-skip-intro', 'player-skip-recap', 'next-episode-seamless-button']) {
    await page.locator(`[data-uia="${key}"]`).evaluate((el) => {
      el.removeAttribute('hidden');
    });
    await page.waitForTimeout(350);
    expect(await page.locator('video').evaluate((v) => (v as HTMLVideoElement).playbackRate)).toBe(
      1.5,
    );
    await page.locator(`[data-uia="${key}"]`).evaluate((el) => {
      el.setAttribute('hidden', '');
    });
  }
});
