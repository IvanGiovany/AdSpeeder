# Review tomorrow — AdSpeeder 0.2.0

2026-10-30. This is a local review candidate, not a published or fully release-qualified build.
Phases 4–6 implementation is complete within this run's overrides. External/manual gates remain
open. AGENTS.md and all existing test assertions were preserved. The root PDF is not committed.

## 1. Phase results and changed files

### Phase 4 — Netflix and extensibility (`a195fca`)

| Done when (§5)                             | Result          | Evidence                                                                                                                              |
| ------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Netflix fixture passes                     | **PASS**        | Four adapter tests and Chromium e2e: visible ad → capped 4x + mute → exact 1.5x/unmuted restore; intro/recap/promo ignored by default |
| Real account does not stall at maxRateHint | **MANUAL-ONLY** | No ad-tier capture/account run available; `maxRateHint: 4` is unverified                                                              |
| Template compiles                          | **PASS**        | Strict typecheck; safe inert methods with TODOs and four-step adding-platform guide                                                   |

Phase gate: typecheck/lint, **292 unit tests**, **7 e2e**, and Chrome/Firefox/Edge builds passed.
Generated-manifest e2e asserts registry matches and exactly storage + target hosts.

Files created/changed:

```text
docs/ADDING_A_PLATFORM.md
docs/BUILD_PLAN.md
docs/HANDOFF.md
docs/netflix-discovery.md
src/platforms/_template/TemplateAdapter.ts
src/platforms/netflix/NetflixAdapter.ts
src/platforms/netflix/selectors.ts
tests/e2e/harness.ts
tests/e2e/manifest.spec.ts
tests/e2e/netflix.spec.ts
tests/fixtures/netflix-ad-break.html
tests/unit/netflix.test.ts
```

### Phase 5 — minimal popup and options (`2c15ab2`)

The owner's style direction was incorporated: whitespace, restrained blue accent, native
controls, rounded surfaces, light/dark themes and subtle entrance/interaction motion.
`prefers-reduced-motion` suppresses animation; diagnostics are collapsed by default.

| Done when (§5)                            | Result                                                                        | Evidence                                                                                                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Controls round-trip through storage       | **PASS**                                                                      | Unit round-trip of every setting field; e2e reload confirms Netflix, speed and mute controls; settings subscribe live                                                              |
| Open-tab effect within 1 s without reload | **PASS** for tested paths; **MANUAL-ONLY** full browser matrix                | e2e enables Netflix in an existing tab and disables mid-ad within 1 s; Controller unit tests cover speed changes, thresholds and restore. Full real-site effects remain unverified |
| Keyboard-only use works                   | **PASS** representative Chromium path; **MANUAL-ONLY** full audit             | Space toggles Netflix and focus survives storage re-render; native labels/selects/buttons and visible focus rings. Test every control tomorrow                                     |
| WCAG AA contrast                          | **PASS** measured palette; **MANUAL-ONLY** full rendered/native-control audit | Main, secondary, links and error text pairs exceed 4.5:1; strengthened control borders exceed 3:1. Native browser controls, zoom and all states still need review                  |

Phase gate: typecheck/lint, **294 unit tests**, **8 e2e**, all three builds passed.
Light popup and dark options screenshots were visually inspected. E2e screenshots are written
to `test-results/popup-light.png` and `test-results/options-dark.png` (ignored build artifacts).
The popup screenshot is an extension page, so its status correctly says unsupported there;
check the actual action popup over a supported page tomorrow.

Files created/changed:

```text
docs/BUILD_PLAN.md
docs/HANDOFF.md
src/bootstrap.ts
src/core/Controller.ts
src/entrypoints/background.ts
src/entrypoints/netflix.content.ts
src/entrypoints/options/index.html
src/entrypoints/options/main.ts
src/entrypoints/options/options.css
src/entrypoints/popup/index.html
src/entrypoints/popup/main.ts
src/entrypoints/popup/popup.css
src/shared/logger.ts
src/shared/messaging.ts
src/shared/settings.ts
src/ui/components.ts
src/ui/format.ts
tests/e2e/harness.ts
tests/e2e/ui.spec.ts
tests/unit/ui.test.ts
```

### Phase 6 — hardening and packaging

Phase gate: typecheck/lint, **299 unit tests**, **8 e2e**, all three builds passed.
Coverage: **99.2% core lines** (required ≥90%), 99.18% overall measured core/shared lines.
Firefox `web-ext lint`: **0 errors / 0 warnings / 0 notices**. Version bumped to **0.2.0**.
`npm run zip` produced Chrome, Edge, Firefox and AMO source archives in `.output/`.
`npm run build:safari` built Safari web assets then failed at Windows' missing `xcrun`;
Xcode project generation is **MANUAL-ONLY**, not reported as a successful full Safari build.

Phase 6's "Done when" is the Appendix checklist. It is **not fully ticked** because the
manual release gates have not been run:

| Appendix release criterion          | Result                                  | Evidence / remaining work                                                         |
| ----------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------- |
| typecheck/lint/unit/e2e green in CI | **PASS locally; MANUAL-ONLY remote CI** | All local gates pass; CI now also enforces coverage; no pushed/remote run claimed |
| Manual matrix on all four browsers  | **MANUAL-ONLY**                         | Record results in selector-log.md                                                 |
| No media writes outside VideoEngine | **PASS**                                | ESLint and `rg` found playbackRate/muted assignments only in VideoEngine.ts       |
| Exactly storage + target hosts      | **PASS**                                | Manifest test and generated browser manifest inspection                           |
| Netflix disabled and Experimental   | **PASS**                                | Settings/registry unit tests, actual options labels and live opt-in e2e           |
| Store policies reviewed             | **MANUAL-ONLY**                         | Owner must review current policies/terms before publishing                        |
| Privacy statement: data stays local | **PASS**                                | docs/PRIVACY.md; no telemetry/runtime service added                               |
| Version + zips + AMO sources        | **PASS**                                | package/lock 0.2.0; WXT archives built and inspected                              |
| Safari signed/submitted             | **MANUAL-ONLY**                         | macOS/Xcode/team credentials and owner submission required                        |

Hardening evidence: Controller tests cover disabled/platform-off mid-ad, orphan/runtime loss,
crash-marker recovery, hidden-tab cap checks, seeked, node replacement mid-pod, trusted speed
keys, boosted/mute-only caps and speed above browser maximum. The new tests also cover live
thresholds/status. Adapter tests exercise 500 watched mutations with one coalesced evaluation,
no body subtree observation, and Netflix disconnect after destroy. D29's caveat still applies.
Many edge paths are unit-tested, not full browser e2e. No existing tests were weakened or removed.

Files created/changed in Phase 6:

```text
.github/workflows/ci.yml
CHANGELOG.md
README.md
docs/BUILD_PLAN.md
docs/HANDOFF.md
docs/PRIVACY.md
docs/RELEASE.md
docs/REVIEW-TOMORROW.md
docs/STORE-LISTING.md
package.json
package-lock.json
src/entrypoints/options/options.css
src/entrypoints/popup/popup.css
tests/unit/core/Controller.test.ts
tests/unit/netflix.test.ts
tests/unit/youtube/YouTubeAdapter.test.ts
wxt.config.ts
```

`public/_locales/en/messages.json` already existed; the English localization was retained and
verified in all generated packages. AGENTS.md was not edited. No runtime dependency was added.

## 2. PROVISIONAL decisions to confirm

All are marked **PROVISIONAL — confirm with user** in BUILD_PLAN.md:

| ID / sections                    | Choice                                                                                                                                                 | Alternative rejected                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| D26 (§2.4, §5 Phase 4)           | Guess versioned chains/fixture, ad overlay 0.6 + countdown 0.3, separate promo signals, ad precedence; narrow-root observer plus 250 ms discovery poll | Wait for capture (overridden), trust countdown alone, combine unrelated promo confidence, or observe body permanently |
| D27 (§4.1, §5 Phase 5)           | Netflix off installs only a settings listener; adapter starts after live opt-in                                                                        | Permanent startup exit that requires reload and conflicts with Phase 5                                                |
| D28 (§2.1, §5 Phase 5)           | Memory-only 50-event per-page debug buffer; optional validated thresholds; candidate speed ceiling until ad-time probing                               | Persistent browsing logs, unbounded thresholds, or rate probing during content playback                               |
| D29 (§2.1, §5 Phase 6)           | Retain microtask coalescing and test a synchronous 500-mutation burst                                                                                  | Frame-only scheduling that changes the explicit contract and may pause in hidden tabs                                 |
| D30 (§4.3, §5 Phase 6, Appendix) | 0.2.0 internal candidate with buildable archives and explicit manual release gates                                                                     | Claim full release approval, Safari signing or store submission without evidence                                      |

## 3. Everything unverified

1. **Netflix selectors first:** every chain is `UNVERIFIED — replace from capture`, with
   `SELECTORS_VERSION = '2026-10-30-provisional'`. The fixture is self-consistent with guesses,
   not evidence of Netflix support. Real ad/intro/recap/promo DOM, fallback chains, player
   replacement, localization and 4x DRM tolerance remain unverified.
2. Real YouTube timing, Y4/getVideoData assumptions, D22 pod behavior, selector chain indices,
   live, SSAI and real reload behavior across browsers. No live account/site was contacted by tests.
3. Firefox and Safari playback/probe results, host-grant/revoke UI, fallback bridge and native
   controls; Edge real playback. Firefox lint only validates the package, not runtime behavior.
4. Full keyboard-only, zoom/large-text and WCAG AA audit. Palette measurements are not an
   accessibility certification. Native select/checkbox rendering is browser/OS dependent.
5. Safari Xcode conversion, signing, distribution and store submission; current store-policy
   compliance, final listing assets/support/privacy URL; remote CI execution.
6. A universal one-evaluation-per-frame ceiling across separate asynchronous mutations is not
   enforced (D29). The specified synchronous burst test passes; background CPU on real pages
   should be profiled. Source archive rebuild on a clean machine remains a manual reproducibility check.

## 4. Tomorrow's manual checklist

Record browser/version, scenario, start/restore result, selector version/indices, debug events
and notes in `docs/selector-log.md`. Use RELEASE.md for installation and signing commands.

### Real YouTube (Chrome, Edge, Firefox; Safari after Mac setup)

- [ ] Enable debug; start at 1.5x, unmuted, with a known volume. Try a single pre-roll,
      skippable ad, pod of 2–3, mid-roll, SSAI when seen, live mid-roll and SPA navigation mid-ad.
- [ ] Confirm boost starts promptly; mute works; volume is unchanged; speed restores promptly,
      then mute restores at segment end. Live playback must never accelerate.
- [ ] Watch the **D22 pod risk**: record whether ordinary pre-rolls are flagged SSAI and
      whether mute/snapshot restoration happens between pod ads.
- [ ] Unmute during an ad and use the actual speed shortcut keys; verify overrides are respected.
      Try seeking, hiding the tab, returning after a long break and changing video/title.
- [ ] Disable the master/platform toggle mid-ad. Reload the extension mid-ad; check orphan
      recovery and then reload the page to check crash-marker cleanup. Watch for stuck mute/rate.
- [ ] Log selector drift/contested/detection-lost events and fallback indices >0. Do not alter
      Y4/D22 semantics based only on our guessed Netflix fixture.

### Real Netflix (ad-tier account)

- [ ] With Netflix off, capture ad, intro, recap, promo and content using netflix-discovery.md.
- [ ] Replace guessed selectors and fixture from capture; bump version and changelog; rerun gates.
- [ ] Explicitly opt into Experimental Netflix. Start at 2x then 4x; check buffering/stalls,
      title/video replacement, navigation, and exact speed/mute restoration. Keep it disabled if unsafe.
- [ ] Test each promo action separately: ignore leaves playback untouched; speed affects only
      the intended segment. In particular, inspect whether next-episode UI is really a promo signal.

### Firefox and Safari

- [ ] Follow RELEASE.md's web-ext/temporary-addon Firefox fallback and macOS Safari steps.
- [ ] Run local `tests/fixtures/rate-probe.html`; paste Firefox/Safari results into selector-log.md.
- [ ] Revoke access, open popup, grant access (or enable the site in Safari settings), and check
      that detection starts. Record any required page reload. Confirm no extra permissions appear.
- [ ] Run the same live matrix and inspect browser-specific high-rate drain/stall behavior.

### Popup, options, keyboard and contrast

- [ ] Open the real popup on supported, unsupported and access-denied pages. Confirm live
      watching/boosting/pod/contested state and actual rate. Change speed and mute during an ad.
- [ ] Confirm Netflix defaults off/Experimental, each platform and promo setting persists,
      reset settings restores defaults, and reset statistics clears today's/all-time counters.
- [ ] Enable debug, cause transitions, inspect the last 50 events, export JSON and open it
      locally. Test valid/invalid thresholds and confirm effects without reload.
- [ ] Use only Tab/Shift+Tab, Space, Enter and arrow keys for every control, disclosure,
      link and button. No lost focus, trap or hidden focus indicator; labels announced clearly.
- [ ] Check both themes and 200% zoom, narrow viewport, all focus/hover/disabled/error states.
      Verify text ≥4.5:1 and control/focus boundaries ≥3:1 with a contrast tool.
- [ ] Enable OS reduced motion; page entrance/transitions must stop. With motion enabled,
      verify the subtle animation feels unobtrusive and does not delay interaction.

Measured palette examples: light main 16.10:1, secondary on card 6.65:1, links 6.51:1;
dark main 13.36:1, secondary on card 7.19:1, links 9.36:1. Borders use #80868b.

## 5. Known bugs and risks

- **D22 pod risk:** bridge content-ID matches during client-side pre-rolls may falsely select
  the 100 ms SSAI exit over the 1 s pod debounce. Preserved pending real evidence.
- **Chromium drain (D25):** after a high-rate drop, ~30 ms stall then 0.55–0.83 s queued media
  advance has been observed. Tests retain the approved named 1.0 s allowance. The extension
  cannot retract that media; Firefox/Safari are unmeasured.
- The headless pod overrun check has a short actual content-playing window (~75 ms) because
  source loading takes ~230 ms of the 300 ms debounce.
- User speed changes in EXIT_PENDING are not registered as overrides; final restore may
  rewrite the prior rate before the 500 ms verification accepts a non-1.0 site preference.
- Guessed Netflix promo markers may be ordinary post-play UI. Defaults are conservative.
- Candidate probe ceilings can overstate support before the first attempted boost; requested
  lower speeds do not prove the browser supports higher ones. Popup explains ad-time checking.
- Separate extension pages can race concurrent settings read-modify-write edits. Edit from
  one UI at a time during review. Debug buffers are page-local and disappear on reload.
- Manual host permission grants may require browser reinjection/reload; not verified here.
- Palette checks and a representative keyboard test do not establish complete WCAG compliance.

No confirmed failures remain in the local automated gates. The unrun manual gates above
are deliberately not presented as passing. Nothing was signed, uploaded or submitted.
