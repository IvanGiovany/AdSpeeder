import type { SelectorChain } from '../PlatformAdapter';

/** Bump on every selector change and note it in CHANGELOG.md (Appendix). */
export const SELECTORS_VERSION = '0';

/**
 * Fallback chains for the Netflix player (§2.4). Filled in Phase 4 from the DOM capture
 * recorded on an ad-tier account; no selector here is trusted before then.
 */
export interface NetflixSelectors {
  playerRoot: SelectorChain;
  adBreak: SelectorChain;
  adCountdown: SelectorChain;
  skipIntro: SelectorChain;
  skipRecap: SelectorChain;
  nextEpisode: SelectorChain;
}

export const SELECTORS: NetflixSelectors = {
  playerRoot: [],
  adBreak: [],
  adCountdown: [],
  skipIntro: [],
  skipRecap: [],
  nextEpisode: [],
};
