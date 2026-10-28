import {
  test as base,
  chromium,
  type BrowserContext,
  type Page,
  type Route,
} from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const EXTENSION = resolve(ROOT, '.output/chrome-mv3');
const FIXTURES = resolve(ROOT, 'tests/fixtures');

/** `?v=<scenario>` → fixture file, served as https://www.youtube.com/watch?v=<scenario>. */
const SCENARIOS: Record<string, string> = {
  'ad-pod': 'youtube-ad-pod.html',
  ssai: 'youtube-ssai.html',
  'ssai-preroll': 'youtube-ssai-preroll.html',
  'ssai-preroll-nobridge': 'youtube-ssai-preroll-nobridge.html',
  live: 'youtube-live.html',
};

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
};

export interface LogEntry {
  t: number;
  what: string;
  value?: unknown;
}

/**
 * Serves local fixtures for www.youtube.com and aborts everything else. Combined with the
 * host-resolver rule below, no request can reach a real server (CLAUDE.md: tests never
 * contact youtube.com or netflix.com).
 */
function serve(route: Route, blocked: string[]): Promise<void> {
  const url = new URL(route.request().url());
  if (url.hostname !== 'www.youtube.com') {
    blocked.push(url.href);
    return route.abort('blockedbyclient');
  }
  let file: string | null = null;
  if (url.pathname === '/watch') {
    const name = SCENARIOS[url.searchParams.get('v') ?? ''];
    if (name) file = resolve(FIXTURES, name);
  } else if (url.pathname.startsWith('/__fixtures/')) {
    const candidate = resolve(
      FIXTURES,
      decodeURIComponent(url.pathname.slice('/__fixtures/'.length)),
    );
    if (candidate.startsWith(FIXTURES + sep)) file = candidate;
  }
  if (!file || !existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
  return route.fulfill({
    status: 200,
    contentType: TYPES[extname(file)] ?? 'application/octet-stream',
    body: readFileSync(file),
  });
}

export const test = base.extend<{ context: BrowserContext; blocked: string[] }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures require the destructuring
  blocked: async ({}, use) => {
    await use([]);
  },
  context: async ({ blocked }, use) => {
    if (!existsSync(resolve(EXTENSION, 'manifest.json'))) {
      throw new Error('No Chromium build found: run `npm run build:chrome` first.');
    }
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', // new headless mode, which supports extensions
      headless: true,
      args: [
        `--disable-extensions-except=${EXTENSION}`,
        `--load-extension=${EXTENSION}`,
        '--autoplay-policy=no-user-gesture-required',
        '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost',
      ],
    });
    await context.route('**/*', (route) => serve(route, blocked));
    if (context.serviceWorkers().length === 0) await context.waitForEvent('serviceworker');
    await use(context);
    await context.close();
  },
});

export { expect } from '@playwright/test';

/** Opens a scenario and waits until the extension's MAIN-world bridge has announced itself. */
export async function openScenario(context: BrowserContext, scenario: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`https://www.youtube.com/watch?v=${scenario}`);
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-adspeeder-bridge'));
  // Give the isolated content script time to read settings and bind the player.
  await page.waitForTimeout(300);
  return page;
}

/** Plays the fixture timeline in real time and returns its event log. */
export function runScenario(page: Page): Promise<LogEntry[]> {
  return page.evaluate(() =>
    (window as unknown as { AdFixture: { run(): Promise<LogEntry[]> } }).AdFixture.run(),
  );
}

/** Time of the first entry matching `what` (and `value`, if given) at or after `after`. */
export function at(log: LogEntry[], what: string, value?: unknown, after = 0): number {
  const entry = log.find(
    (e) => e.t >= after && e.what === what && (value === undefined || e.value === value),
  );
  if (!entry) {
    const suffix = value === undefined ? '' : ` = ${JSON.stringify(value)}`;
    throw new Error(`no '${what}'${suffix} in log`);
  }
  return entry.t;
}
