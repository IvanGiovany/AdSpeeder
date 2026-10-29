import { browser } from '../../shared/browser';
import { sendMessage, sendTabMessage, type TabStatus } from '../../shared/messaging';
import {
  getSettings,
  setSettings,
  subscribeSettings,
  SPEED_OPTIONS,
  type Settings,
} from '../../shared/settings';
import {
  preserveControlFocus,
  createToggle,
  createSelect,
  pageLifetime,
  showError,
} from '../../ui/components';
import { formatCount, formatDuration, formatRate, formatStatus } from '../../ui/format';
const signal = pageLifetime();
const controls = document.getElementById('controls');
let settings: Settings;
let status: TabStatus | null = null;
let controlsLifetime = new AbortController();
signal.addEventListener(
  'abort',
  () => {
    controlsLifetime.abort();
  },
  { once: true },
);
function render() {
  if (!controls) return;
  const restoreFocus = preserveControlFocus();
  controlsLifetime.abort();
  controlsLifetime = new AbortController();
  const change = (patch: Parameters<typeof setSettings>[0]) => {
    void setSettings(patch).catch(showError);
  };
  const life = controlsLifetime.signal;
  controls.replaceChildren(
    createToggle({
      label: 'AdSpeeder on',
      checked: settings.enabled,
      onChange: (enabled) => {
        change({ enabled });
      },
      signal: life,
    }),
    createSelect({
      label: 'Ad speed',
      value: settings.speed,
      options: SPEED_OPTIONS.map((value) => ({
        value,
        label: formatRate(value),
        disabled: status?.maxRate != null && value > status.maxRate,
        title: 'Limited by this player or browser',
      })),
      onChange: (speed) => {
        change({ speed });
      },
      signal: life,
    }),
    createToggle({
      label: 'Mute during ads',
      checked: settings.mute,
      onChange: (mute) => {
        change({ mute });
      },
      signal: life,
    }),
  );
  restoreFocus();
  const limit = document.getElementById('limit');
  if (limit)
    limit.textContent =
      status?.maxRate != null
        ? `Current player ceiling: ${formatRate(status.maxRate)}. Speed is checked when an ad starts.`
        : 'Speed is checked when an ad starts.';
}
let origins: string[] = [];
const grant = document.getElementById('grant');
grant?.addEventListener(
  'click',
  () => {
    if (origins.length > 0)
      void browser.permissions
        .request({ origins })
        .then(() => refresh())
        .catch(showError);
  },
  { signal },
);
async function refresh() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  let next: TabStatus | null = null;
  let access = true;
  origins = [];
  if (tab?.url) {
    const url = new URL(tab.url);
    if (
      ['www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'www.netflix.com'].includes(
        url.hostname,
      )
    ) {
      origins = [`*://${url.hostname}/*`];
      access = await browser.permissions.contains({ origins });
    }
  }
  if (!tab?.url) {
    const manifest: unknown = browser.runtime.getManifest();
    const raw =
      typeof manifest === 'object' && manifest !== null && 'host_permissions' in manifest
        ? manifest.host_permissions
        : [];
    const declared = Array.isArray(raw)
      ? raw.filter((v: unknown): v is string => typeof v === 'string')
      : [];
    access = await browser.permissions.contains({ origins: declared });
    if (!access) origins = declared;
  }
  if (tab?.id !== undefined && access)
    next = await sendTabMessage(tab.id, { type: 'get-status' }).catch(() => null);
  if (next?.maxRate !== status?.maxRate) {
    status = next;
    render();
  } else status = next;
  const label = document.getElementById('status');
  if (label)
    label.textContent = !settings.enabled
      ? 'AdSpeeder is off'
      : !access
        ? 'Access needed · grant access or enable this site in Safari settings'
        : formatStatus(status);
  if (grant) grant.hidden = access;
  const stats = await sendMessage({ type: 'get-stats' });
  const target = document.getElementById('stats');
  if (target) {
    target.replaceChildren();
    for (const [label, value] of [
      ['Today', stats.today],
      ['All time', stats.allTime],
    ] as const) {
      const cell = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = formatDuration(value.secondsSaved);
      cell.append(label, strong, `${formatCount(value.adsSeen)} ads sped up`);
      target.append(cell);
    }
  }
}
async function start() {
  settings = await getSettings();
  render();
  subscribeSettings(
    (next) => {
      settings = next;
      render();
      void refresh().catch(showError);
    },
    { signal },
  );
  await refresh();
  const timer = setInterval(() => {
    void refresh().catch(showError);
  }, 500);
  signal.addEventListener(
    'abort',
    () => {
      clearInterval(timer);
    },
    { once: true },
  );
}
void start().catch(showError);
