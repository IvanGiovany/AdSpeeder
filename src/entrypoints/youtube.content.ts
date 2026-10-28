import { defineContentScript } from 'wxt/utils/define-content-script';
import { bootstrap } from '../bootstrap';
import { def } from '../platforms/registry';

export default defineContentScript({
  matches: [...def('youtube').matches],
  runAt: 'document_start',
  allFrames: false,
  main: (ctx) => bootstrap('youtube', ctx),
});
