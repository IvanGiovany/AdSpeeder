import { browser } from '../../shared/browser';
import { sendMessage, sendTabMessage, type DebugEvent } from '../../shared/messaging';
import {
  getSettings,
  setSettings,
  resetSettings,
  subscribeSettings,
  PLATFORM_IDS,
  PROMO_KINDS,
  validThresholds,
  type SettingsPatch,
  type Settings,
} from '../../shared/settings';
import {
  preserveControlFocus,
  createToggle,
  createSelect,
  pageLifetime,
  showError,
} from '../../ui/components';
const signal = pageLifetime();
let controlsLifetime = new AbortController();
signal.addEventListener(
  'abort',
  () => {
    controlsLifetime.abort();
  },
  { once: true },
);
let events: DebugEvent[] = [];
const saved = () => {
  const el = document.getElementById('saved');
  if (el) el.textContent = 'Saved';
};
function change(patch: SettingsPatch) {
  void setSettings(patch).then(saved).catch(showError);
}
function render(s: Settings) {
  const restoreFocus = preserveControlFocus();
  controlsLifetime.abort();
  controlsLifetime = new AbortController();
  const life = controlsLifetime.signal;
  document.getElementById('platforms')?.replaceChildren(
    ...PLATFORM_IDS.map((id) =>
      createToggle({
        label: id === 'netflix' ? 'Netflix · Experimental' : 'YouTube',
        checked: s.platforms[id],
        signal: life,
        onChange: (enabled) => {
          change({ platforms: { [id]: enabled } });
        },
      }),
    ),
  );
  document.getElementById('promos')?.replaceChildren(
    ...PROMO_KINDS.map((kind) =>
      createSelect({
        label: kind.charAt(0).toUpperCase() + kind.slice(1),
        value: s.promoActions[kind],
        signal: life,
        options: [
          { value: 'ignore' as const, label: 'Leave as is' },
          { value: 'speed' as const, label: 'Speed up' },
        ],
        onChange: (value) => {
          change({ promoActions: { [kind]: value } });
        },
      }),
    ),
  );
  document.getElementById('debug')?.replaceChildren(
    createToggle({
      label: 'Debug logging',
      checked: s.debug,
      signal: life,
      onChange: (debug) => {
        change({ debug });
      },
    }),
  );
  restoreFocus();
  const t = s.thresholds ?? { enterThreshold: 0.6, exitThreshold: 0.2, exitDebounceMs: 300 };
  for (const [name, value] of [
    ['enter', t.enterThreshold],
    ['exit', t.exitThreshold],
    ['delay', t.exitDebounceMs],
  ] as const) {
    const input = document.getElementsByName(name)[0];
    if (input instanceof HTMLInputElement) input.value = String(value);
  }
}
document.getElementById('thresholds')?.addEventListener(
  'submit',
  (event) => {
    event.preventDefault();
    if (!(event.currentTarget instanceof HTMLFormElement)) return;
    const data = new FormData(event.currentTarget);
    const thresholds = {
      enterThreshold: Number(data.get('enter')),
      exitThreshold: Number(data.get('exit')),
      exitDebounceMs: Number(data.get('delay')),
    };
    const status = document.getElementById('threshold-status');
    if (!validThresholds(thresholds)) {
      if (status) status.textContent = 'Exit must be below enter; delay must be 100–1000 ms.';
      return;
    }
    change({ thresholds });
    if (status) status.textContent = 'Thresholds saved';
  },
  { signal },
);
async function refreshEvents() {
  const tabs = await browser.tabs.query({ lastFocusedWindow: true });
  const ordered = [...tabs].sort(
    (a, b) => Number(b.active) - Number(a.active) || b.lastAccessed - a.lastAccessed,
  );
  events = [];
  for (const tab of ordered) {
    if (tab.id === undefined) continue;
    const result = await sendTabMessage(tab.id, { type: 'get-debug' }).catch(() => null);
    if (result) {
      events = result;
      break;
    }
  }
  const target = document.getElementById('events');
  if (target) target.textContent = JSON.stringify(events, null, 2);
}
const actions: Record<string, () => Promise<unknown>> = {
  refresh: refreshEvents,
  'reset-stats': async () => {
    await sendMessage({ type: 'reset-stats' });
    saved();
  },
  'reset-settings': async () => {
    await resetSettings();
    saved();
  },
  export: async () => {
    await refreshEvents();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'adspeeder-debug.json';
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  },
};
for (const [id, action] of Object.entries(actions))
  document.getElementById(id)?.addEventListener(
    'click',
    () => {
      void action().catch(showError);
    },
    { signal },
  );
void getSettings().then(render).catch(showError);
subscribeSettings(render, { signal });
