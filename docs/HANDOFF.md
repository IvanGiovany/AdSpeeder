# Handoff — project status and what's next

Last updated 2026-10-30, after the D25 fix ("fix: two-stage exit (D25)"). Read `AGENTS.md`
first for the rules, then this file, then `docs/BUILD_PLAN.md` for the spec.

## Where we are

| Phase (§5)                          | Status                                         | Commit(s)                       |
| ----------------------------------- | ---------------------------------------------- | ------------------------------- |
| 0 — project memory                  | Done                                           | `cb154fc`                       |
| 1 — scaffold, MV3 manifests         | Done                                           | `718fb74`                       |
| 2 — core engine                     | Done                                           | `ac9b964`, `df780b0`, `cb83eb2` |
| 3 — YouTube adapter                 | Done in code; **manual real-site run pending** | `2e7174f`, `d222a0d`            |
| Fix — two-stage exit (D25)          | Done                                           | "fix: two-stage exit (D25)"     |
| 4 — Netflix adapter & extensibility | **Next.** Not started; has a hard stop         | —                               |
| 5 — popup & options UI              | Not started (placeholders only)                | —                               |
| 6 — hardening, testing, packaging   | Not started                                    | —                               |

Roughly half the plan is done: phases 0–3 plus D25, out of 0–6. The engine and the YouTube
path, which are the hardest parts, are built and tested. What's left is Netflix, which depends on
a real ad-tier DOM capture, plus the UI, then hardening and packaging.

**Gate status at handoff:** typecheck, lint and Prettier are clean, all 288 unit tests pass,
and the e2e suite passes (7 Chromium specs). Coverage: core about 99% lines, YouTube adapter
about 99.5%.

### What works today

- **Core engine (`src/core/`):**
  - A five-state reducer: IDLE, BOOSTING, EXIT_PENDING, CONTESTED, RESTORING (§3.1).
  - `VideoEngine` is the only module that writes media state. It keeps a snapshot plus a crash
    marker, probes the rate with read-back retry (D5), restores in two stages (D25), and verifies
    the restore after 500 ms.
  - `RateGuard` uses a token bucket with backoff. `MediaTracker` handles node swaps.
    `StatsMeter` tracks stats.
  - Segment caps are 90 s boosted and 300 s muted-only (D9, D19).
  - Trusted user input respects overrides (D14–D16), and selector drift is detected (D17).
- **YouTube (`src/platforms/youtube/`):**
  - Signals Y1–Y5 are reported raw (§2.3), with versioned selector fallback chains.
  - A MAIN-world bridge talks over postMessage with a namespace and nonce, with a
    `<script src>` fallback.
  - SSAI rules, including stitched pre-rolls via the bridge's video ID (D22).
  - Live streams get mute only, plus SPA navigation handling.
- **Plumbing:**
  - Settings with migration, the logger, typed messaging, stats aggregation in the
    background (daily buckets, 30 days).
  - Manifests are generated for Chrome, Edge and Firefox. Safari is configured but not built.
- **Tests:**
  - Vitest unit tests on fakes and HTML fixtures.
  - Playwright e2e loads the real Chromium build against fixtures served as
    `https://www.youtube.com/watch?v=<scenario>`, with all real network access blocked.
  - Scenarios: `ad-pod`, `ssai`, `ssai-preroll`, `ssai-preroll-nobridge`, `live`.

### Placeholders, not real yet

- `src/platforms/netflix/*` and `tests/fixtures/netflix-ad-break.html`: these are stubs that
  wait for the Phase 4 capture.
- `src/platforms/_template/TemplateAdapter.ts`: a stub, to be finished in Phase 4 step 4.
- `src/entrypoints/popup/*`, `src/entrypoints/options/*` and `src/ui/*`: minimal shells for
  Phase 5.

## Waiting on the user

1. **Manual real-YouTube run (the last Phase 3 "Done when" item).** The user is doing this
   now, in Chrome and Firefox. Results go in `docs/selector-log.md`, in the "Manual run" table
   (D24) and the chain-index table. **Phase 4 starts only after the user sends those results.**
   When they arrive:
   - If any chain index is above 0, update `src/platforms/youtube/selectors.ts`, bump
     `SELECTORS_VERSION`, and check that the fixtures still match.
   - **Known risk to check (D22):** if YouTube's `getVideoData().video_id` returns the content's
     ID during a normal (client-side) pre-roll, every pre-roll will be treated as SSAI. Its
     100 ms exit then beats the 1 s pod debounce, so a pod could restore between ads (the "pod"
     rows would show it). If that happens, the Y4 ID-mismatch rule in §2.3 needs rethinking
     too. Ask the user before changing it.
2. **Rate-probe results in Firefox and Safari.** The user opens `tests/fixtures/rate-probe.html`
   from disk and pastes the row into `docs/selector-log.md` §2. Only the Chromium row exists.
3. **Phase 4 Netflix DOM capture.** See below.

## What's next: Phase 4 (only after "next phase")

From §5 Phase 4 and §2.4:

1. Write `docs/netflix-discovery.md`. It needs a checklist and a console snippet the user runs
   on an ad-tier account, which logs class and `data-uia` changes on the player root during an ad
   break, an intro and a recap, and dumps them as JSON.
2. **Stop and wait** for the user to paste that JSON. Don't guess Netflix selectors.
3. Then:
   - Fill `platforms/netflix/selectors.ts` from the capture.
   - Implement `NetflixAdapter`: ad, intro, recap and promo signals, `maxRateHint` 4,
     `rateEnforcement: 'guard'`.
   - Keep `netflix.content.ts` exiting unless `settings.platforms.netflix` is on (it already
     does).
   - Build a fixture from the capture, extend `tests/e2e/harness.ts` to serve it for
     www.netflix.com, and add unit and e2e specs.
4. Finish `platforms/_template/TemplateAdapter.ts`, with TODOs per method, and write
   `docs/ADDING_A_PLATFORM.md` with the four steps in §2.2.
5. Add a registry test that fails if any adapter's `matches` are missing from the generated
   manifest.

"Done when": the Netflix fixture passes, the user's real-account test confirms playback doesn't
stall at the chosen `maxRateHint`, and the template compiles.

Then Phase 5 (UI) and Phase 6 (hardening and packaging) as written in §5. The Appendix release
checklist is the finish line.

## Open questions and known caveats

- **Chromium drain after a rate drop (D25 note).** After lowering `playbackRate` from 16x,
  Chromium's media clock stalls about 30 ms, then jumps 0.55–0.83 s of media while queued
  audio drains. AdSpeeder writes the rate within about 2 ms and can't prevent the rest. The
  SSAI e2e check uses a named allowance, `CHROMIUM_RATE_DROP_DRAIN_S = 1.0`, which the user
  approved. Firefox and Safari behaviour hasn't been measured.
- **Pod e2e overrun is weak in headless Chromium.** The content src needs about 230 ms to reach
  `playing`, so only about 75 ms of content falls inside the 300 ms window. The spec asserts that
  content did start playing inside the window.
- **Rate changes during EXIT_PENDING aren't treated as user overrides.** The final `restore()`
  rewrites the snapshot rate if a load reset it, and the 500 ms verification then accepts a
  site or user rate that isn't 1.0. The window is 100–1000 ms.
- **Fixture media** (`tests/fixtures/media/clip.mp4`, about 2.94 s, looping) was generated in
  the browser with MediaRecorder, because ffmpeg wasn't available.
- **Firefox e2e isn't automated** (that's Phase 6). Firefox builds are linted with web-ext:
  0 errors, 0 warnings, 0 notices.

## Map of the code

```text
src/
  bootstrap.ts               content-script bootstrap: settings → adapter → Controller
  core/                      platform-neutral engine (never imports platforms/*/)
    Controller.ts            wires snapshots → AdStateMachine → VideoEngine; owns timers
    AdStateMachine.ts        pure reducer, effects list (D25: restore-rate / reboost)
    VideoEngine.ts           ONLY writer of playbackRate/muted; boost/restoreRate/restore
    RateGuard.ts RateProbe.ts SessionSnapshot.ts MediaTracker.ts StatsMeter.ts
  platforms/
    PlatformAdapter.ts       contract + BaseAdapter (§2.1)
    signals.ts registry.ts
    youtube/                 YouTubeAdapter.ts, selectors.ts, bridgeProtocol.ts
    netflix/ _template/      Phase 4
  shared/                    settings, messaging, stats, logger, dom helpers, browser
  entrypoints/               background, youtube/netflix content scripts, youtube-bridge
                             (MAIN world), popup/options (Phase 5)
tests/
  unit/                      Vitest; helpers/ has FakeVideo, FakeAdapter, fixture loader
  e2e/                       Playwright harness + youtube.spec.ts
  fixtures/                  HTML player fixtures + driver.js timeline + media + rate-probe
docs/
  BUILD_PLAN.md              spec + Resolved decisions D1–D25
  selector-log.md            manual real-site results (user-filled)
  HANDOFF.md                 this file
```

## Commands

```sh
npm ci                                   # install (runs wxt prepare)
npm run typecheck && npm run lint && npm test   # the gate, required after every task
npm run build:chrome && npm run test:e2e        # e2e against the Chromium build
npm run test:coverage                    # core must stay ≥ 90% lines
npm run build                            # chrome + firefox + edge into .output/
npm run dev                              # WXT dev mode (Chrome)
```

Keep this file current: update "Where we are" and "Waiting on the user" at the end of every
phase.
