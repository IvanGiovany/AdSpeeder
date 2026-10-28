import { getSettings } from '../../shared/settings';

// Phase 1 placeholder: shows stored settings so a loaded build can be sanity-checked.
// The real popup (§5, Phase 5) replaces this.
const summary = document.getElementById('summary');

getSettings().then(
  (s) => {
    if (!summary) return;
    const netflix = s.platforms.netflix ? 'on' : 'off';
    summary.textContent =
      `${s.enabled ? 'On' : 'Off'} · speed ${String(s.speed)}x · mute ${s.mute ? 'on' : 'off'} · ` +
      `YouTube ${s.platforms.youtube ? 'on' : 'off'} · Netflix ${netflix} (Experimental)`;
  },
  (error: unknown) => {
    if (summary) summary.textContent = `Could not read settings: ${String(error)}`;
  },
);
