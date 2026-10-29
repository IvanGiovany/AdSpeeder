# AdSpeeder

A Manifest V3 extension that speeds up and optionally mutes video ads, then restores the
user's playback settings. No network blocking and no runtime dependencies beyond WXT.

**0.2.0 is a review candidate.** Netflix is Experimental, disabled by default, and uses
unverified provisional selectors. Read [tomorrow’s review](docs/REVIEW-TOMORROW.md) before use.

## Build and check

Use Node 24 and npm. From the repository root:

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

For e2e, install bundled Chromium with `npx playwright install chromium` if needed.
Tests use local fixtures and deny real site network requests. Load `.output/chrome-mv3` or
`.output/edge-mv3` unpacked for manual testing. Firefox and Safari steps are in
[RELEASE.md](docs/RELEASE.md). Buildable source archives contain the application and lockfile;
the Git checkout also supplies all tests and fixtures.

Start with [AGENTS.md](AGENTS.md), [HANDOFF.md](docs/HANDOFF.md), then the source of truth,
[BUILD_PLAN.md](docs/BUILD_PLAN.md). [Privacy](docs/PRIVACY.md).
