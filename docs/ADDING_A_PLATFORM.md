# Adding a platform (§2.2)

1. Copy `_template/` into `src/platforms/<id>/`; implement URL checks, capabilities,
   raw signal collection, video lookup and abortable watchers. Keep all selector chains in
   `selectors.ts`, version them, and implement diagnostics. Never import core or write media.
2. Add the ID to shared settings and its defaults/migration, then add an `ADAPTERS` entry
   with exact host matches, default enable state and experimental label.
3. Add a small `<id>.content.ts` that calls `bootstrap(id, ctx)`. Choose the documented
   runAt timing. No detection logic belongs in the entrypoint.
4. Add local fixtures, adapter unit tests and blocked-network e2e scenarios. Run typecheck,
   lint, unit tests, all builds and e2e. The generated-manifest test checks registry matches.

Use the template TODOs; keep platform-specific details out of the engine (§1).
