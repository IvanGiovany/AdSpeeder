import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The driver API from tests/fixtures/driver.js. */
export interface FixtureApi {
  log: { t: number; what: string; value?: unknown }[];
  scenario: string;
  steps: [number, string, unknown][];
  actions: Record<string, (arg?: unknown) => unknown>;
  step(i: number): unknown;
}

const FIXTURES = resolve(__dirname, '../../fixtures');

/**
 * Loads a local fixture into the happy-dom document and installs its driver. Scripts in the
 * fixture never run; the driver is evaluated directly. Nothing touches the network.
 */
export function loadFixture(name: string): FixtureApi {
  const html = readFileSync(resolve(FIXTURES, `${name}.html`), 'utf8');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  for (const script of parsed.querySelectorAll('script')) script.remove();
  document.body.replaceWith(document.importNode(parsed.body, true));
  const driver = readFileSync(resolve(FIXTURES, 'driver.js'), 'utf8');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- local fixture driver only
  const runDriver = new Function(driver) as () => void;
  runDriver();
  return (window as unknown as { AdFixture: FixtureApi }).AdFixture;
}

/** Runs fixture steps by action name, in order, without their delays. */
export async function runSteps(
  fixture: FixtureApi,
  until: (action: string, index: number) => boolean = () => false,
  from = 0,
): Promise<number> {
  for (let i = from; i < fixture.steps.length; i++) {
    const step = fixture.steps[i];
    if (!step) break;
    if (until(step[1], i)) return i;
    await fixture.step(i);
  }
  return fixture.steps.length;
}

/** Lets MutationObserver callbacks and coalesced microtask re-scores run. */
export async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
