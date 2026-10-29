# AdSpeeder

A Manifest V3 extension that speeds up and optionally mutes video ads, then restores your
previous playback speed and mute state. Built with TypeScript and WXT for Firefox, Chrome,
and Edge. It does not block network requests. Settings and statistics stay local.

## Try it yourself

These steps let reviewers build and test the project from source. No API key or developer
account is required. Version 0.2.0 is a review candidate installed locally rather than from a
browser store. Netflix is **Experimental** and disabled by default.

### 1. Download and install dependencies

Install **Node.js 24** (includes npm). Download this repository with GitHub's
**Code → Download ZIP**, then extract it. Alternatively, clone it:

```sh
git clone https://github.com/IvanGiovany/AdSpeeder.git
cd AdSpeeder
```

Open a terminal in the project folder containing `package.json` and run:

```sh
npm ci
```

Run the commands below separately; they also work in Windows PowerShell.

### 2. Build and load your browser version

**Firefox (desktop version 140 or newer)**

```sh
npm run build:firefox
```

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on**.
3. Select `.output/firefox-mv3/manifest.json` inside the project folder. The build generates
   `.output`; it is not included in the downloaded source.
4. Grant access to supported sites if requested. Open AdSpeeder from the browser's extensions
   menu, and pin it to the toolbar if desired.

Firefox removes temporary add-ons when the browser closes. Load the same manifest again
when starting a new session.

**Chrome**

```sh
npm run build:chrome
```

Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select
`.output/chrome-mv3` inside the project folder.

**Edge**

```sh
npm run build:edge
```

Open `edge://extensions`, enable **Developer mode**, click **Load unpacked**, and select
`.output/edge-mv3` inside the project folder.

### 3. Test a real video ad

1. Open or refresh a YouTube watch page after loading AdSpeeder. YouTube is enabled by
   default. Use an account that receives ads; Premium or another ad blocker can prevent ads
   from appearing. No particular video guarantees an ad.
2. Open AdSpeeder's popup. Confirm **AdSpeeder on** and **Mute during ads** are enabled.
   Choose an **Ad speed**, such as **16×**.
3. During ordinary content, choose a recognizable player speed, such as 1.5×, and leave
   sound unmuted. Wait for an ad naturally. A new video's pre-roll also works; it uses the
   playback state available when the ad starts.
4. During a detected ad, expect the popup to report boosting, the ad to play faster, and
   sound to be muted. The browser may accept a lower speed than requested.
5. When the ad ends, confirm your previous speed and mute state return. AdSpeeder changes
   playback; it does not remove the ad or click Skip.
6. Optional: switch **AdSpeeder on** off during an ad. The saved speed and mute state should
   return. Turn it on again to continue testing.

**Netflix:** use your own account on a plan that shows ads. In the popup, click **Settings**,
turn on **Netflix · Experimental**, then open or refresh a Netflix watch page. Repeat the
checks above. Netflix can attempt up to **16×**, with fallback if the browser rejects a
rate. Detection uses the English **Ad** label observed in a user capture. Other languages
and smooth real Netflix playback at 16× remain unverified. If playback stalls, select a
lower speed or turn Netflix off in Settings.

### 4. Run repeatable checks without an account

The automated browser tests exercise local YouTube and Netflix player fixtures, including
Netflix boosting to 16×, restoration, and settings. They need no accounts or live ads. The
harness blocks real site network requests. These tests run in bundled Chromium; they do not
verify Firefox playback or Netflix DRM compatibility.

```sh
npx playwright install chromium
npm run build:chrome
npm run test:e2e
```

The browser runs in the background. The terminal prints the result for each scenario.

## Troubleshooting

| Symptom                             | What to try                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm` is missing or the build fails | Install Node.js 24, reopen the terminal, and check `node --version` and `npm --version`. Run `npm ci` in the folder containing `package.json`.                                       |
| Cannot find the manifest            | Build your browser version first. Firefox loads the manifest file; Chrome and Edge load the output folder.                                                                           |
| Popup says access is needed         | Grant site access in the popup or browser extension settings, then refresh the video page.                                                                                           |
| Netflix does nothing                | Enable **Netflix · Experimental** in Settings. Check that an ad is playing and the interface shows the English **Ad** label.                                                         |
| No ads appear                       | Use an account that receives ads and temporarily disable other ad blockers. Ad availability depends on the service and account. Use the local automated demo for a repeatable check. |
| Changes do not appear               | Rebuild for your browser, reload AdSpeeder on the browser's extensions/debugging page, then refresh the video tab.                                                                   |
| Firefox extension disappeared       | Load the temporary add-on again after restarting Firefox.                                                                                                                            |

For a useful bug report, include the browser/version, platform, selected speed, whether
boosting started, and whether speed and sound restored. In **Settings**, enable debug logging
and export events after reproducing the issue. Review the exported JSON before sharing it.

## Development and verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run test:coverage
npm run zip
```

`npm test` runs unit tests. `npm run build` builds Chrome, Firefox, and Edge. End-to-end tests
need the Chrome build and Playwright's bundled Chromium, as described above. Firefox
extension playback is checked manually. Safari requires macOS and Xcode; see the
[release instructions](docs/RELEASE.md).

The code separates entrypoints, a platform-independent playback engine, platform adapters,
shared utilities, and a vanilla TypeScript UI. See the [build plan](docs/BUILD_PLAN.md),
[handoff and known limitations](docs/HANDOFF.md), [selector log](docs/selector-log.md),
[privacy statement](docs/PRIVACY.md), and [agent instructions](AGENTS.md).
