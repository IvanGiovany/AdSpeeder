# AdSpeeder — project rules

AdSpeeder is a cross-browser Manifest V3 extension. While a video platform shows an ad, it
speeds the `<video>` up to the highest `playbackRate` the browser accepts and mutes it. When
the ad ends it restores the user's exact previous rate and mute state. It never blocks network
requests.

## Source of truth

- `docs/HANDOFF.md` says where the project is and what's next; keep it current at the end
  of every phase. `AGENTS.md` mirrors these rules for other coding agents.
- `docs/BUILD_PLAN.md` is the source of truth. Follow its section numbers (1–5, Appendix) and
  cite them when making decisions. Don't invent architecture that contradicts it.
- If the spec is ambiguous or seems wrong, stop and ask instead of guessing.
- Work one phase at a time (section 5). Don't start the next phase until the user says
  "next phase". Phase 4 stops after `docs/netflix-discovery.md` until the user pastes the
  captured DOM JSON.

## Language & tooling

- TypeScript strict mode, ES2022, no `any` (explicit or implicit).
- WXT with `manifestVersion: 3` and `srcDir: 'src'`. Pin the WXT version and commit the
  lockfile.
- No runtime dependencies besides WXT's.

## Architecture rules

- Layering: entrypoints → core / platforms → shared. Each layer imports only from layers
  below it.
  - `platforms/` never imports `core/`.
  - `core/` never imports any specific platform (`platforms/*/`).
  - `shared/` never imports `core/` or `platforms/`.
- Only `src/core/VideoEngine.ts` writes to `playbackRate` or `muted`. A grep for
  `playbackRate =` / `muted =` outside that file must find nothing.
- Selectors live only in `src/platforms/<id>/selectors.ts`, as versioned fallback chains.
- Every DOM listener and observer is registered with an `AbortSignal` and torn down when the
  extension unloads (adapter/controller destroy).
- Never hard-code 16x. Probe the highest supported rate per video element (`RateProbe`).

## Permissions & platforms

- Manifest permissions are exactly `"storage"` plus the target hosts (derived from
  `src/platforms/registry.ts`). No `tabs`, `scripting`, `webRequest`, `declarativeNetRequest`.
- Netflix ships disabled by default and labelled "Experimental".

## Testing

- After each task run `npm run typecheck && npm run lint && npm test` and fix every failure
  before reporting done.
- Tests use the local fixtures in `tests/fixtures`. They never contact youtube.com or
  netflix.com.

## Phase wrap-up

At the end of each phase report: files created/changed, which "Done when" criteria pass and
how each was checked, and anything assumed or unverified. Then commit as
`phase N: <summary>`.
