# Selector & rate log

Manual checks against real sites and browsers (§5 Phase 3, Appendix "Selector maintenance").
Automated tests never touch the real sites; this file is where the hand-run results go.

## 1. YouTube selector chains (manual, real site)

**Setup.** Load the unpacked build (`npm run build`, then `.output/chrome-mv3` or
`.output/firefox-mv3`). Turn on debug logging from the extension's background console:

- Chrome/Edge: `chrome://extensions` → AdSpeeder → "service worker" → Console.
- Firefox: `about:debugging#/runtime/this-firefox` → AdSpeeder → Inspect → Console.

```js
const api = globalThis.browser ?? chrome;
const { settings } = await api.storage.local.get('settings');
await api.storage.local.set({ settings: { ...settings, debug: true } });
```

**Run.** Open a few YouTube watch pages that show ads (pre-roll, mid-roll, a pod if you get
one, and a live stream). In the page console, filter for `[AdSpeeder:youtube]`. Each page logs
`player root bound; selector health` and, when you navigate away, `selector health`. Both carry
`{ selectorsVersion, chainIndices }`. An index of 0 is the primary selector; anything above 0
is a fallback (selector drift). Three drifting pages in a row log `selector-drift`.

Record one row per browser. `—` = that chain never matched on the pages visited.

| Date | Browser + version | SELECTORS_VERSION | playerRoot | video | adModule | adOverlay | adPreview | skipContainer | adBadgeText | adCountdown | liveIndicator | Notes |
| ---- | ----------------- | ----------------- | ---------- | ----- | -------- | --------- | --------- | ------------- | ----------- | ----------- | ------------- | ----- |
|      | Chrome            |                   |            |       |          |           |           |               |             |             |               |       |
|      | Firefox           |                   |            |       |          |           |           |               |             |             |               |       |

Also note: did the boost start promptly, did the pod keep one boost, was your speed and mute
state restored, and did the badge text parse into "Ad N of M"?

## 2. Real playbackRate limits (`tests/fixtures/rate-probe.html`)

Open `tests/fixtures/rate-probe.html` straight from disk in each browser, click **Run probe**
and paste the Markdown row it prints. "capped (x)" means the write didn't throw but read back
as x; the engine treats that as a rejection and steps down the ladder (D5).

| Date       | User agent                                                            | Clip           | 16       | 8        | 4        | 2        | Out of range                   |
| ---------- | --------------------------------------------------------------------- | -------------- | -------- | -------- | -------- | -------- | ------------------------------ |
| 2026-10-28 | HeadlessChrome/156.0.8078.4 (Playwright Chromium, Windows; by Claude) | media/clip.mp4 | accepted | accepted | accepted | accepted | 32: rejected, 0.0625: accepted |
|            | Firefox (manual)                                                      |                |          |          |          |          |                                |
|            | Safari (manual)                                                       |                |          |          |          |          |                                |
