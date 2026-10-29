import type { SelectorChain } from '../PlatformAdapter';

export const SELECTORS_VERSION = '2026-10-30-capture-1';
export const SELECTORS = {
  // UNVERIFIED — replace from capture
  playerRoot: ['.watch-video', '[data-uia="player"]'],
  // UNVERIFIED — replace from capture
  video: ['video'],
  // Live capture: Netflix shows the exact label "Ad" during the break.
  adBreak: ['[data-uia="ads-info-text"]'],
  // UNVERIFIED — replace from capture
  countdown: ['[data-uia="ad-countdown"]', '.ad-countdown'],
  // UNVERIFIED — replace from capture
  intro: ['[data-uia="player-skip-intro"]', '[data-uia="skip-intro"]'],
  // UNVERIFIED — replace from capture
  recap: ['[data-uia="player-skip-recap"]', '[data-uia="skip-recap"]'],
  // UNVERIFIED — replace from capture
  promo: ['[data-uia="next-episode-seamless-button"]', '[data-uia="next-episode"]'],
} as const satisfies Record<string, SelectorChain>;
