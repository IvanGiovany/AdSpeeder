import { defineContentScript } from 'wxt/utils/define-content-script';
import { bootstrap } from '../bootstrap';
import { def } from '../platforms/registry';

export default defineContentScript({
  matches: [...def('netflix').matches],
  runAt: 'document_idle',
  main: () => bootstrap('netflix'),
});
