import { defineContentScript } from 'wxt/utils/define-content-script';
import { bootstrap } from '../bootstrap';
import { def } from '../platforms/registry';
import { getSettings, subscribeSettings } from '../shared/settings';

export default defineContentScript({
  matches: [...def('netflix').matches],
  runAt: 'document_idle',
  // §4.1: declared statically but exits at once unless the user enabled Netflix.
  main: async (ctx) => {
    let started = false;
    const start = async () => {
      if (started || ctx.signal.aborted) return;
      started = true;
      await bootstrap('netflix', ctx);
    };
    subscribeSettings(
      (next) => {
        if (next.platforms.netflix) void start();
      },
      { signal: ctx.signal },
    );
    if ((await getSettings()).platforms.netflix) await start();
  },
});
