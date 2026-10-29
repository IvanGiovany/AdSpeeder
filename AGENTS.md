# AdSpeeder — instructions for coding agents (Codex and others)

Start here, then read **`docs/HANDOFF.md`** (where the project is and what's next) and
**`docs/BUILD_PLAN.md`** (the spec). These rules are the same as `CLAUDE.md`; follow them
exactly.

AdSpeeder is a cross-browser Manifest V3 extension. While a video platform shows an ad, it
speeds the `<video>` up to the highest `playbackRate` the browser accepts and mutes it. When the
ad ends it restores the user's exact previous rate and mute state. It never blocks network
requests.

## How to work

- `docs/BUILD_PLAN.md` is the source of truth. Cite its section numbers (§1–§5, Appendix) and
  decision IDs (D1–D25, "Resolved decisions" at the end). Don't invent architecture that
  contradicts it.
- If the spec is ambiguous or seems wrong, **stop and ask the user** instead of guessing.
  Record every resolved question as a new decision (D26, D27, …) in the log and update the
  sections it touches.
- One phase at a time (§5). Don't start the next phase until the user says "next phase".
  **Phase 4 has a hard stop:** after writing `docs/netflix-discovery.md`, wait for the user to
  paste the captured DOM JSON before implementing `NetflixAdapter`.
- After each task run `npm run typecheck && npm run lint && npm test` and fix every failure
  before reporting done. Also run `npm run build:chrome && npm run test:e2e` when you touch
  `src/` or the fixtures (CI runs it).
- At the end of each phase report: files created/changed, which "Done when" criteria pass and
  how each was checked, and anything assumed or unverified. Then commit as
  `phase N: <summary>`. Commit only when asked or at phase end; never commit the PDF in the
  repo root.

## Hard rules

- TypeScript strict mode, ES2022, no `any` (explicit or implicit).
- WXT with `manifestVersion: 3` and `srcDir: 'src'`. WXT is pinned (0.21.4); commit the
  lockfile. No runtime dependencies besides WXT's. TypeScript stays on ~6.0 (typescript-eslint
  doesn't support 7).
- Layering: entrypoints → core / platforms → shared. `platforms/` never imports `core/`;
  `core/` never imports any specific platform (`platforms/*/`); `shared/` imports neither.
  ESLint enforces this.
- Only `src/core/VideoEngine.ts` writes `playbackRate` or `muted`. A grep for
  `playbackRate =` / `muted =` outside that file must find nothing (test fixtures excepted).
  ESLint enforces this.
- Selectors live only in `src/platforms/<id>/selectors.ts`, as versioned fallback chains.
- Every DOM listener and observer is registered with an `AbortSignal` and torn down when the
  extension unloads (adapter/controller destroy).
- Never hard-code 16x. Probe the highest supported rate per video element (`RateProbe`).
- Manifest permissions are exactly `"storage"` plus the target hosts (derived from
  `src/platforms/registry.ts`). No `tabs`, `scripting`, `webRequest`,
  `declarativeNetRequest`.
- Netflix ships disabled by default and labelled "Experimental".
- Tests use the local fixtures in `tests/fixtures`. They never contact youtube.com or
  netflix.com (the e2e harness blocks all real network access).

## Environment notes

- Windows dev machine; Git Bash heredocs that contain backticks or template literals are
  fragile, so write scripts to a temp file and run them from there.
- `npm test` = Vitest (happy-dom + WXT fake browser). `npm run test:e2e` = Playwright with the
  bundled Chromium, loading `.output/chrome-mv3` (build it first).
- Prettier: single quotes, print width 100, LF line endings. `npm run lint` checks it.
