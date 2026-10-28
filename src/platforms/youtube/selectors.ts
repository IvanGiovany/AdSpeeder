import type { SelectorChain } from '../PlatformAdapter';

/** Bump on every selector change and note it in CHANGELOG.md (Appendix). */
export const SELECTORS_VERSION = 0;

/** Fallback chains for the YouTube player (§2.3). Filled in Phase 3. */
export interface YouTubeSelectors {
  playerRoot: SelectorChain;
  adModule: SelectorChain;
  adOverlay: SelectorChain;
  adPreview: SelectorChain;
  skipContainer: SelectorChain;
  adBadgeText: SelectorChain;
  liveIndicator: SelectorChain;
}

export const SELECTORS: YouTubeSelectors = {
  playerRoot: [],
  adModule: [],
  adOverlay: [],
  adPreview: [],
  skipContainer: [],
  adBadgeText: [],
  liveIndicator: [],
};
