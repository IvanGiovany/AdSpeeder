// WXT ≥ 0.20 ships its own promise-based `browser` (Chrome's native `chrome.*` or Firefox's
// `browser.*`) in place of webextension-polyfill, so this re-exports that (§1, §4).
export { browser } from 'wxt/browser';
export type { Browser } from 'wxt/browser';
