import { test, expect } from './harness';
test('minimal settings UI: keyboard opt-in works in an existing Netflix tab, speed/mute restore live', async ({
  context,
}) => {
  const worker = context.serviceWorkers()[0];
  if (!worker) throw new Error('Missing worker');
  const page = await context.newPage();
  await page.goto('https://www.netflix.com/watch/123');
  await page.locator('[data-uia="ads-info-text"]').evaluate((el) => {
    el.textContent = 'Ad';
  });
  const options = await context.newPage();
  await options.goto(new URL('/options.html', worker.url()).href);
  const toggle = options.getByLabel('Netflix · Experimental');
  await expect(toggle).not.toBeChecked();
  await toggle.focus();
  await options.keyboard.press('Space');
  await expect(toggle).toBeChecked();
  await expect
    .poll(() => page.locator('video').evaluate((el) => (el as HTMLVideoElement).playbackRate), {
      timeout: 1000,
    })
    .toBe(16);
  await expect(toggle).toBeFocused();
  await options.reload();
  await expect(options.getByLabel('Netflix · Experimental')).toBeChecked();
  await options.getByLabel('Netflix · Experimental').uncheck();
  await expect
    .poll(
      () =>
        page
          .locator('video')
          .evaluate((el) => [
            (el as HTMLVideoElement).playbackRate,
            (el as HTMLVideoElement).muted,
          ]),
      { timeout: 1000 },
    )
    .toEqual([1, false]);
  const popup = await context.newPage();
  await popup.goto(new URL('/popup.html', worker.url()).href);
  await expect(popup.getByLabel('AdSpeeder on')).toBeChecked();
  await popup.getByLabel('Ad speed').selectOption('2');
  await popup.getByLabel('Mute during ads').uncheck();
  await popup.reload();
  await expect(popup.getByLabel('Ad speed')).toHaveValue('2');
  await expect(popup.getByLabel('Mute during ads')).not.toBeChecked();
  await popup.screenshot({
    path: 'test-results/popup-light.png',
    animations: 'disabled',
    clip: { x: 0, y: 0, width: 320, height: 520 },
  });
  await options.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await options.screenshot({ path: 'test-results/options-dark.png', fullPage: true });
});
