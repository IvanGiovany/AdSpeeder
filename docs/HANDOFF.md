# Handoff — 2026-10-30 review candidate

Read AGENTS.md, this file, then BUILD_PLAN.md (§1–§5 and decisions). The owner's overrides
applied only to this run: Phases 4–6 proceeded without pauses and ambiguities were provisional.
AGENTS.md remains unchanged. Future work returns to its normal rules.

## Where we are

| Phase       | Status                                                                                                   | Commit / evidence                                      |
| ----------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 0–3 and D25 | Existing implementation retained; live YouTube still pending                                             | Through `12762b4`, handoff `dee045d`                   |
| 4           | Provisional Netflix adapter, fixture, discovery guide, template and registry check implemented           | `a195fca`; 292 unit, 7 e2e pass                        |
| 5           | Minimal popup/options, light/dark, subtle motion, reduced-motion support, live controls and debug export | `2c15ab2`; 294 unit, 8 e2e pass                        |
| 6           | Hardening, release docs, version 0.2.0 and archives implemented; manual release gates remain             | Phase 6 commit; 299 unit, 8 e2e pass; core lines 99.2% |

Baseline `npm ci` found no vulnerabilities. Baseline gates passed 288 unit and **5** e2e tests
(the previous handoff's 7 was inaccurate). Latest typecheck/lint, Chrome/Firefox/Edge builds,
unit/e2e and coverage pass. Firefox web-ext lint: 0 errors/warnings/notices. Browser zips and
AMO source archive are in `.output/`. Safari assets build, but Windows has no `xcrun`:
Xcode project generation/signing/submission are not done. CI configuration exists; no remote
CI run is claimed.

See REVIEW-TOMORROW.md for exact phase files, criteria, provisional alternatives and manual
checks. RELEASE.md gives install, packaging, Firefox fallback and Safari signing steps.

## Waiting on the user

1. **Netflix DOM capture first:** run netflix-discovery.md with an ad-tier account. Every chain
   is UNVERIFIED, version `2026-10-30-provisional`; the fixture is built from the same guesses.
   Confirm playback tolerates 2x/4x before treating Netflix as working. It remains off by default
   and labelled Experimental.
2. Confirm provisional D26–D30 and review the minimal UI and motion. Review live thresholds,
   memory-only debug events, and Netflix's settings-only listener before opt-in.
3. Run the real YouTube/Netflix matrix in Chrome, Edge, Firefox and Safari, plus Firefox/Safari
   rate-probe fixtures. Record results and selector chain indices in selector-log.md.
4. Run keyboard-only and full WCAG AA checks, browser permission revoke/grant, real popup
   layout/zoom and reduced-motion checks. Representative Chromium keyboard checks pass.
5. Complete current store-policy review, listing contact/privacy URL/screenshots, Safari
   generation/signing and eventual submission. Nothing has been published.

## Known caveats and risks

- **D22 pod risk:** if YouTube reports the content ID during a client-side pre-roll, SSAI's
  100 ms exit can beat the 1 s pod debounce and restore between ads. Not changed without real
  evidence. Record pod behavior and reconsider Y4/SSAI semantics with the owner.
- **D25 Chromium drain:** after lowering a high rate, the clock can stall ~30 ms then jump
  0.55–0.83 s while queued media drains. The engine writes the lower rate promptly but cannot
  undo this. Existing SSAI tests retain `CHROMIUM_RATE_DROP_DRAIN_S = 1.0`; Firefox/Safari
  behavior is unmeasured. The headless pod content-overrun check remains weak because the
  content source takes ~230 ms to reach playing in its 300 ms window.
- Rate changes during EXIT_PENDING are not treated as user overrides; final restore can
  rewrite the snapshot rate. The 500 ms verification accepts a differing non-1.0 site rate.
- Netflix's guessed next-episode marker can be ordinary post-play UI rather than a promo.
  Promo actions default to ignore. DRM/stall behavior and live selectors are unverified.
- D29: microtask coalescing passes synchronous 500-mutation bursts, not a universal frame cap
  across separate asynchronous mutation deliveries. No observer targets document.body subtree.
- Popup ceiling is the probe's candidate ceiling until a boost tests it. A lower requested
  speed does not prove higher rates work. Native control rendering/grants vary by browser.
- Debug events are per page, capped at 50 and disappear on reload. Options chooses the active
  or most recently accessed supported tab. Concurrent settings edits in separate extension
  pages still use read-modify-write storage and may race; avoid simultaneous edits tomorrow.

## Code and commands

`src/bootstrap.ts` connects adapters to the controller. Only `core/VideoEngine.ts` writes
media state. Platform selector chains remain in each `selectors.ts`. `shared/` owns typed
settings/messaging/stats; `ui/` owns small native-control helpers and formatting.
`tests/e2e/harness.ts` allows bundled extension resources and local site fixtures, denying all
real network requests. Existing tests were preserved.

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run test:coverage
npm run zip
```

All detailed release/manual work is in RELEASE.md and REVIEW-TOMORROW.md.
