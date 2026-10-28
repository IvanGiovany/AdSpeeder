/**
 * @vitest-environment-options {"url": "https://www.youtube.com/watch?v=abc", "settings": {"disableJavaScriptFileLoading": true, "disableJavaScriptEvaluation": true, "handleDisabledFileLoadingAsSuccess": true}}
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { bootstrap } from '../../../src/bootstrap';
import { setSettings } from '../../../src/shared/settings';
import { loadFixture, runSteps, settle } from '../helpers/fixture';

let lifetime: AbortController;

beforeEach(() => {
  fakeBrowser.reset();
  lifetime = new AbortController();
});

afterEach(() => {
  lifetime.abort();
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Real YouTubeAdapter + Controller on the local pod fixture (happy-dom, no network). */
describe('bootstrap(youtube) on the ad-pod fixture', () => {
  it('boosts the pod with one snapshot and restores the user’s 1.5x after the last ad', async () => {
    const fixture = loadFixture('youtube-ad-pod');
    const v = document.querySelector('video');
    if (!v) throw new Error('no video');
    let i = await runSteps(fixture, (action) => action === 'adStart');
    await bootstrap('youtube', lifetime);
    expect(v.playbackRate).toBe(1.5);

    await fixture.step(i++); // Ad 1 of 2
    await settle();
    expect(v.playbackRate).toBe(16);
    expect(v.muted).toBe(true);
    const marker = v.getAttribute('data-adspeeder-boosted');
    expect(marker).toContain('"playbackRate":1.5');

    await fixture.step(i++); // flicker
    await fixture.step(i++); // src ad2
    await wait(150);
    await fixture.step(i++); // Ad 2 of 2
    await settle();
    expect(v.getAttribute('data-adspeeder-boosted')).toBe(marker); // same snapshot
    expect(v.playbackRate).toBe(16);

    await fixture.step(i); // ad end
    await settle();
    await wait(350);
    expect(v.playbackRate).toBe(1.5);
    expect(v.muted).toBe(false);
    expect(v.hasAttribute('data-adspeeder-boosted')).toBe(false);
  });

  it('follows settings live: switching off restores without a reload', async () => {
    const fixture = loadFixture('youtube-ad-pod');
    const v = document.querySelector('video');
    if (!v) throw new Error('no video');
    await runSteps(fixture, (action) => action === 'flicker');
    await bootstrap('youtube', lifetime);
    await settle();
    expect(v.playbackRate).toBe(16);
    await setSettings({ enabled: false });
    await settle();
    expect(v.playbackRate).toBe(1.5);
  });

  it('does nothing once its signal has aborted', async () => {
    loadFixture('youtube-ad-pod');
    lifetime.abort();
    await expect(bootstrap('youtube', lifetime)).resolves.toBeUndefined();
  });
});
