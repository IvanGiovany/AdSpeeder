import { defineContentScript } from 'wxt/utils/define-content-script';
import { bootstrap } from '../bootstrap';
import { def } from '../platforms/registry';
import { getSettings } from '../shared/settings';

export default defineContentScript({
  matches: [...def('netflix').matches],
  runAt: 'document_idle',
  // §4.1: declared statically but exits at once unless the user enabled Netflix.
  main: async (ctx) => {
    if (!(await getSettings()).platforms.netflix) return;
    await bootstrap('netflix', ctx);
  },
});
