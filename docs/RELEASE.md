# Release procedure — 0.2.0 review candidate

Do not submit this candidate until the manual gates below pass. No store submissions or
signing occurred in this run. The authoritative checklist is BUILD_PLAN.md Appendix.

## Reproduce and package

Use Node 24 and the committed lockfile. Run these separately in PowerShell (or chain with
`&&` in a shell that supports it):

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run test:coverage
npm run zip
npx web-ext lint --source-dir .output/firefox-mv3
```

Expected outputs in `.output/`: `adspeeder-0.2.0-chrome.zip`, `adspeeder-0.2.0-edge.zip`,
`adspeeder-0.2.0-firefox.zip`, and `adspeeder-0.2.0-sources.zip`. WXT's AMO source archive
contains application source, public assets, configuration, lockfile and documentation. WXT
excludes unit/e2e test files by default; use the Git checkout to run the test suite. Unzip
sources into a fresh directory and run `npm ci` then `npm run build` to reproduce artifacts.
The source allow-list deliberately excludes the owner's root PDF and local agent data.

Inspect every generated manifest: MV3, `permissions: ["storage"]`, exactly the registry's
host patterns, correct background kind, and Firefox's no-data-collection declaration.
Compare zip contents and version with `package.json`; never upload test-results or credentials.
CI runs the normal gates and builds/zips. A green local run is not proof CI has run remotely.

## Chrome and Edge — manual

1. Open the browser's extensions page, enable developer mode, choose Load unpacked and
   select `.output/chrome-mv3` or `.output/edge-mv3`.
2. Open the action popup. Confirm defaults: enabled, mute on, YouTube on, Netflix off.
3. Follow REVIEW-TOMORROW.md's live-site, state-restoration and keyboard checks.
4. Reload the extension during an ad. Observe old-context restore within 5 seconds and
   startup crash-marker cleanup on the next injection. Check both old and new tabs.
5. Record browser version, selectors, timings and failures in selector-log.md.

## Firefox — manual fallback

Playwright's extension harness supports Chromium persistent contexts, so Firefox extension
execution is manual here ([official Playwright documentation](https://playwright.dev/docs/chrome-extensions)).
`web-ext lint` completed with **0 errors, 0 warnings, 0 notices**; it does not test playback.

```sh
npm run build:firefox
npx web-ext lint --source-dir .output/firefox-mv3
npx web-ext run --source-dir .output/firefox-mv3 --firefox=firefox
```

Alternatively, in a disposable Firefox profile open `about:debugging#/runtime/this-firefox`,
choose Load Temporary Add-on and select `.output/firefox-mv3/manifest.json`.
Grant the declared site access, then run the manual real-site checklist (not automated tests).
Revoke site access and verify the popup's Grant access path; re-grant and reload the page if
Firefox requires reinjection. Record behavior instead of assuming Chromium parity.
Run `tests/fixtures/rate-probe.html` from disk and record the accepted/rejected/capped ladder
in selector-log.md. Test trusted speed keys, unmute, navigation and extension reload mid-ad.

## Safari — macOS/Xcode required

On Windows, `npm run build:safari` built `.output/safari-mv3` but failed at `xcrun` (not installed).
No Xcode project, signing identity, signed app or submission was produced.
On a Mac with Xcode and command-line tools:

```sh
npm ci
npm run build:safari
```

This runs WXT and `xcrun safari-web-extension-converter .output/safari-mv3 --project-location
safari --app-name AdSpeeder --no-open --force`. Use a clean generated `safari/` directory;
`--force` replaces generated output. Open the generated Xcode project, select your development
team and unique app/extension bundle identifiers for each target, resolve signing, then build
and run locally. Enable AdSpeeder in Safari Settings → Extensions and grant each intended site.
Verify the fallback bridge, rate probe, state restoration and the whole manual matrix.
Use Xcode's Archive/Validate workflow only after those checks; distribute through App Store
Connect using the owner's account. Signing and submission remain owner tasks.

## Store preparation — manual-only

- Review current Chrome Web Store, Edge Add-ons, AMO and Apple policies and platform terms;
  record dated findings and any restrictions. No policy approval is asserted by this build.
- Review STORE-LISTING.md and PRIVACY.md. Supply real support/contact details and a hosted
  privacy URL. Add screenshots of both themes; do not claim verified Netflix compatibility.
- Confirm D26–D30, capture Netflix DOM, replace chains and bump selector version/CHANGELOG.
- Re-run all gates and the live matrix after refinements. Obtain owner approval before
  publishing or uploading signed packages.
