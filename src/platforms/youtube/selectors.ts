import type { SelectorChain } from '../PlatformAdapter';

/**
 * Bump on every selector change and note it in CHANGELOG.md (Appendix). Reported through
 * getDiagnostics() in rate-contested / detection-lost / selector-drift logs.
 */
export const SELECTORS_VERSION = '2026.10.28-1';

/**
 * Fallback chains for the YouTube player (§2.3), tried in order; index > 0 means a fallback
 * matched (selector drift). The only place YouTube markup is named, apart from the class
 * names below.
 */
export interface YouTubeSelectors {
  playerRoot: SelectorChain;
  /** Searched inside the player root, then the document. */
  video: SelectorChain;
  adModule: SelectorChain;
  adOverlay: SelectorChain;
  adPreview: SelectorChain;
  skipContainer: SelectorChain;
  adBadgeText: SelectorChain;
  adCountdown: SelectorChain;
  /** Matched against the player root itself (`root.matches`). */
  liveIndicator: SelectorChain;
}

export const SELECTORS: YouTubeSelectors = {
  playerRoot: ['#movie_player', '.html5-video-player'],
  video: ['video.html5-main-video', 'video'],
  adModule: ['.video-ads.ytp-ad-module', '.ytp-ad-module', '.video-ads'],
  adOverlay: [
    '.ytp-ad-player-overlay-layout',
    '.ytp-ad-player-overlay',
    '.ytp-ad-player-overlay-instream-info',
  ],
  adPreview: ['.ytp-ad-preview-container', '.ytp-preview-ad', '.ytp-ad-preview-text-modern'],
  skipContainer: ['.ytp-skip-ad', '.ytp-ad-skip-button-container', '.ytp-ad-skip-button-slot'],
  adBadgeText: ['.ytp-ad-badge__text', '.ytp-ad-simple-ad-badge', '.ytp-ad-badge'],
  adCountdown: ['.ytp-ad-duration-remaining', '.ytp-ad-preview-text', '.ytp-ad-text'],
  liveIndicator: ['.ytp-live'],
};

/** Player-root classes for Y1 / Y2 (§2.3). */
export const ROOT_CLASSES = {
  adShowing: 'ad-showing',
  adInterrupting: 'ad-interrupting',
} as const;
