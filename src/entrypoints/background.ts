import { defineBackground } from 'wxt/utils/define-background';
import { browser } from '../shared/browser';
import { createLogger } from '../shared/logger';
import { onMessage, type TabStatus } from '../shared/messaging';
import { defaultSettings, migrateStoredSettings, STORAGE_KEY } from '../shared/settings';
import { getStatsSummary, recordStatsBatch, resetStats } from '../shared/stats';

const BADGE_COLOR = '#d32f2f';

const log = createLogger('background');

function badgeText(status: TabStatus): string {
  const showsRate = status.phase === 'boosting' || status.phase === 'contested';
  return showsRate && status.rate !== null ? `${String(status.rate)}x` : '';
}

export default defineBackground({
  type: 'module',
  // Listeners are registered synchronously so the MV3 service worker wakes up for them.
  main() {
    browser.runtime.onInstalled.addListener(({ reason }) => {
      const task =
        reason === 'install'
          ? browser.storage.local.set({ [STORAGE_KEY]: defaultSettings() })
          : reason === 'update'
            ? migrateStoredSettings()
            : Promise.resolve();
      task.catch((error: unknown) => {
        log.error(`settings ${reason} failed`, error);
      });
    });

    void browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR });

    onMessage({
      'tab-status': async ({ status }, sender) => {
        const tabId = sender.tab?.id;
        if (tabId === undefined) return;
        await browser.action.setBadgeText({ tabId, text: badgeText(status) });
      },
      'stats-batch': async ({ batch }) => {
        await recordStatsBatch(batch);
      },
      'reset-stats': async () => {
        await resetStats();
        return undefined;
      },
      'get-stats': () => getStatsSummary(),
    });
  },
});
