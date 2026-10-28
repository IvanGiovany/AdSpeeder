import { browser } from '../../shared/browser';
import {
  childController,
  pickActiveVideo,
  queryAllChain,
  queryChain,
  throttle,
  waitForElement,
} from '../../shared/dom';
import {
  BaseAdapter,
  type AdapterCapabilities,
  type AdapterContext,
  type AdapterDiagnostics,
} from '../PlatformAdapter';
import type { AdSignal, AdStateSnapshot, PodInfo } from '../signals';
import {
  BRIDGE_NS,
  BRIDGE_READY_ATTR,
  createNonce,
  isValidBridgeMessage,
  type BridgeProbe,
} from './bridgeProtocol';
import { ROOT_CLASSES, SELECTORS, SELECTORS_VERSION, type YouTubeSelectors } from './selectors';

/** Page-wide YouTube media shortcuts that count as user input on <body>/<html> (D15). */
export const YOUTUBE_MEDIA_SHORTCUT_KEYS: readonly string[] = ['m', 'M', '<', '>'];

/** Signal weights from §2.3 (Y1/Y2 0.6, Y3 0.3, Y4 0.5, Y5 0.1). */
export const WEIGHTS = { playerClass: 0.6, adUi: 0.3, bridge: 0.5, media: 0.1 } as const;

/** §4.2: inject the bridge via <script src> if the MAIN-world script hasn't announced itself. */
export const BRIDGE_FALLBACK_MS = 1000;
/** §2.3: last-resort location.href poll. */
export const HREF_POLL_MS = 1000;
const PROBE_THROTTLE_MS = 250;
/** Y5: an ad's duration is "far below" the content's when under half of it. */
const SHORT_DURATION_RATIO = 0.5;
/** The content src is learned only once playback is clearly content, not a loading pre-roll. */
const CONTENT_MIN_TIME_S = 1;

/**
 * §2.3 pod parsing: locale-agnostic, first two numbers of the badge text, accepted only when
 * 1 ≤ index ≤ total ≤ 10. Anything else yields no pod info.
 */
export function parsePod(text: string | null | undefined): PodInfo | null {
  const match = /(\d+)\D+(\d+)/.exec(text ?? '');
  if (!match) return null;
  const index = Number(match[1]);
  const total = Number(match[2]);
  return index >= 1 && index <= total && total <= 10 ? { index, total } : null;
}

/** Seconds left on an ad countdown ("0:05", "Ad · 1:02"); the last m:ss in the text wins. */
export function parseCountdown(text: string | null | undefined): number | null {
  const last = [...(text ?? '').matchAll(/(\d+):(\d{2})/g)].at(-1);
  return last ? Number(last[1]) * 60 + Number(last[2]) : null;
}

/** §2.3: true only on /watch, /live/ and music player routes. Shorts and embeds are out. */
export function isYouTubeWatchUrl(url: URL): boolean {
  if (url.hostname === 'music.youtube.com') return url.pathname === '/watch';
  if (url.hostname !== 'www.youtube.com' && url.hostname !== 'm.youtube.com') return false;
  return url.pathname === '/watch' || url.pathname.startsWith('/live/');
}

function mediaSrc(v: HTMLVideoElement): string {
  return v.currentSrc || v.src;
}

/** Hidden by the `hidden` attribute or display:none anywhere between `el` and `boundary`. */
function isShown(el: Element, boundary: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node instanceof HTMLElement && node.hidden) return false;
    if (getComputedStyle(node).display === 'none') return false;
    if (node === boundary) break;
  }
  return true;
}

interface AdUi {
  visible: boolean;
  overlay: boolean;
  pod: PodInfo | null;
  skippable: boolean;
  countdown: number | null;
}

const NO_AD_UI: AdUi = {
  visible: false,
  overlay: false,
  pod: null,
  skippable: false,
  countdown: null,
};

interface Facts {
  y1: boolean;
  y3: boolean;
  overlay: boolean;
  countdown: number | null;
  srcChanged: boolean;
  idMismatch: boolean;
  anyAdSignal: boolean;
}

/** YouTube: five independent signal families Y1–Y5 (§2.3), reported raw (D8). */
export class YouTubeAdapter extends BaseAdapter {
  readonly id = 'youtube';
  readonly displayName = 'YouTube';

  private root: Element | null = null;
  private rootBinding: AbortController | null = null;
  private adModule: Element | null = null;
  private adModuleBinding: AbortController | null = null;
  private videoBinding: AbortController | null = null;
  private readonly chainIndices: Record<string, number> = {};
  private readonly nonce = createNonce();
  private bridge: { videoId: string | null; adHint: boolean | null; live: boolean | null } | null =
    null;
  private requestProbe: () => void = () => undefined;
  private lastHref = '';
  private contentSrc: string | null = null;
  private contentDuration: number | null = null;
  private facts: Facts | null = null;
  /** What this ad segment has shown so far, for the SSAI exit rule. */
  private segment: { y1Seen: boolean; overlaySeen: boolean } | null = null;

  isWatchContext(url: URL): boolean {
    return isYouTubeWatchUrl(url);
  }

  /** Live streams get mute only: a live edge cannot be outrun (§2.3). */
  getCapabilities(): AdapterCapabilities {
    return { allowRateBoost: !this.isLive(), allowMute: true, rateEnforcement: 'guard' };
  }

  /** D14: trusted input counts only inside the player. */
  getInteractionRoot(): Element | null {
    return this.root;
  }

  getMediaShortcutKeys(): readonly string[] {
    return YOUTUBE_MEDIA_SHORTCUT_KEYS;
  }

  getDiagnostics(): AdapterDiagnostics {
    return { selectorsVersion: SELECTORS_VERSION, chainIndices: { ...this.chainIndices } };
  }

  protected installWatchers(ctx: AdapterContext): void {
    const { signal } = ctx;
    this.lastHref = location.href;
    this.requestProbe = throttle(
      () => {
        this.sendProbe();
      },
      PROBE_THROTTLE_MS,
      signal,
    );

    // §2.3 navigation: yt-navigate-finish, popstate, and a 1 s href poll as a last resort.
    const onUrl = () => {
      this.reportNavigation();
    };
    document.addEventListener('yt-navigate-finish', onUrl, { signal });
    window.addEventListener('popstate', onUrl, { signal });
    const poll = setInterval(() => {
      this.reportNavigation();
      this.ensureRoot();
      this.requestProbe();
    }, HREF_POLL_MS);
    signal.addEventListener(
      'abort',
      () => {
        clearInterval(poll);
      },
      { once: true },
    );

    window.addEventListener(
      'message',
      (event) => {
        this.onBridgeMessage(event);
      },
      { signal },
    );
    this.scheduleBridgeFallback(signal);

    this.ensureRoot();
    if (!this.root) {
      void waitForElement(SELECTORS.playerRoot, { signal }).then(() => {
        this.ensureRoot();
      });
    }
  }

  protected override reportNavigation(): void {
    if (location.href !== this.lastHref) {
      // Logged as the page is left: the chain indices it used (§2.3 health check).
      this.ctx?.log.debug('selector health', this.getDiagnostics());
      this.lastHref = location.href;
      this.bridge = null;
      this.contentSrc = null;
      this.contentDuration = null;
      this.segment = null;
      this.ensureRoot();
      this.requestProbe();
    }
    super.reportNavigation();
  }

  protected findVideo(): HTMLVideoElement | null {
    const match =
      (this.root && queryAllChain(this.root, SELECTORS.video)) ??
      queryAllChain(document, SELECTORS.video);
    if (!match) return null;
    this.chainIndices.video = match.index;
    const videos = match.elements.filter((el) => el instanceof HTMLVideoElement);
    return pickActiveVideo(videos, this.root);
  }

  protected override onVideoChanged(video: HTMLVideoElement | null): void {
    this.videoBinding?.abort();
    this.videoBinding = null;
    const signal = this.ctx?.signal;
    if (!video || !signal) return;
    const binding = childController(signal);
    this.videoBinding = binding;
    const opts = { signal: binding.signal };
    // Y5 media corroboration (§2.3).
    for (const type of ['loadstart', 'loadedmetadata', 'durationchange', 'emptied']) {
      video.addEventListener(
        type,
        () => {
          this.invalidate();
        },
        opts,
      );
    }
    video.addEventListener(
      'timeupdate',
      () => {
        this.learnContent(video);
      },
      opts,
    );
  }

  protected collectSignals(): AdSignal[] {
    const at = performance.now();
    const root = this.root;
    const y1 = root?.classList.contains(ROOT_CLASSES.adShowing) ?? false;
    const y2 = root?.classList.contains(ROOT_CLASSES.adInterrupting) ?? false;
    const ui = this.readAdUi();
    const idMismatch = this.bridgeIdMismatch();
    const y4 = this.bridge?.adHint === true || idMismatch;
    const anyAdSignal = y1 || y2 || ui.visible || y4;

    const v = this.getVideoElement();
    const src = v ? mediaSrc(v) : '';
    const srcChanged =
      anyAdSignal && this.contentSrc !== null && src !== '' && src !== this.contentSrc;
    const shortDuration =
      anyAdSignal &&
      v !== null &&
      this.contentDuration !== null &&
      Number.isFinite(v.duration) &&
      v.duration > 0 &&
      v.duration < this.contentDuration * SHORT_DURATION_RATIO;

    this.facts = {
      y1,
      y3: ui.visible,
      overlay: ui.overlay,
      countdown: ui.countdown,
      srcChanged,
      idMismatch,
      anyAdSignal,
    };
    const signal = (source: string, active: boolean, weight: number): AdSignal => ({
      source,
      active,
      weight,
      kind: 'ad',
      at,
    });
    return [
      signal('yt.playerClass.ad-showing', y1, WEIGHTS.playerClass),
      signal('yt.playerClass.ad-interrupting', y2, WEIGHTS.playerClass),
      {
        ...signal('yt.adUi', ui.visible, WEIGHTS.adUi),
        skippable: ui.skippable,
        ...(ui.pod && { pod: ui.pod }),
      },
      signal('yt.bridge', y4, WEIGHTS.bridge),
      signal('yt.media', anyAdSignal && (srcChanged || shortDuration), WEIGHTS.media),
    ];
  }

  /**
   * §2.3 SSAI rule. ssaiSuspected = Y1 or Y3 active, but no src change against the known
   * content src and no video-id mismatch. While suspected, exit at the earliest of: Y1 cleared,
   * the overlay removed, or the countdown reaching 0, by reporting confidence 0.
   */
  protected override decorate(snapshot: AdStateSnapshot): AdStateSnapshot {
    const f = this.facts;
    if (!f?.anyAdSignal) {
      this.segment = null;
      return snapshot;
    }
    const segment = (this.segment ??= { y1Seen: false, overlaySeen: false });
    segment.y1Seen ||= f.y1;
    segment.overlaySeen ||= f.overlay;
    const ssaiSuspected =
      (f.y1 || f.y3) && this.contentSrc !== null && !f.srcChanged && !f.idMismatch;
    if (!ssaiSuspected) return { ...snapshot, ssaiSuspected: false };
    const exit =
      (segment.y1Seen && !f.y1) || (segment.overlaySeen && !f.overlay) || f.countdown === 0;
    if (exit) {
      return { active: false, kind: null, confidence: 0, reasons: ['yt.ssai.exit'], ssaiSuspected };
    }
    return { ...snapshot, ssaiSuspected };
  }

  private ensureRoot(): void {
    const match = queryChain(document, SELECTORS.playerRoot);
    if (!match) return;
    this.chainIndices.playerRoot = match.index;
    if (match.element !== this.root) this.bindRoot(match.element);
    this.bindAdModule();
  }

  private bindRoot(root: Element): void {
    const signal = this.ctx?.signal;
    if (!signal) return;
    this.rootBinding?.abort();
    const binding = childController(signal);
    this.rootBinding = binding;
    this.root = root;
    this.adModule = null;
    // Y1/Y2: class changes on the root itself; childList (direct children only) catches the
    // ad module being inserted or replaced. Never a document-wide subtree observer.
    const observer = new MutationObserver((records) => {
      if (records.some((r) => r.type === 'childList')) this.bindAdModule();
      this.onPlayerMutation();
    });
    observer.observe(root, { attributes: true, attributeFilter: ['class'], childList: true });
    binding.signal.addEventListener(
      'abort',
      () => {
        observer.disconnect();
      },
      { once: true },
    );
    this.bindAdModule();
    this.ctx?.log.debug('player root bound; selector health', this.getDiagnostics());
    this.invalidate();
  }

  /** Y3: subtree observer on the ad module only (§2.3). */
  private bindAdModule(): void {
    const root = this.root;
    const parent = this.rootBinding?.signal;
    if (!root || !parent) return;
    const match = queryChain(root, SELECTORS.adModule);
    if (match) this.chainIndices.adModule = match.index;
    const module = match?.element ?? null;
    if (module === this.adModule) return;
    this.adModuleBinding?.abort();
    this.adModule = module;
    if (!module) return;
    const binding = childController(parent);
    this.adModuleBinding = binding;
    const observer = new MutationObserver(() => {
      this.onPlayerMutation();
    });
    observer.observe(module, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden'],
    });
    binding.signal.addEventListener(
      'abort',
      () => {
        observer.disconnect();
      },
      { once: true },
    );
  }

  private onPlayerMutation(): void {
    this.invalidate();
    this.requestProbe();
  }

  private readAdUi(): AdUi {
    const root = this.root;
    if (!root) return NO_AD_UI;
    const scope = this.adModule?.isConnected ? this.adModule : root;
    const shown = (name: keyof YouTubeSelectors): HTMLElement | null => {
      const match = queryChain<HTMLElement>(scope, SELECTORS[name]);
      if (!match) return null;
      this.chainIndices[name] = match.index;
      return isShown(match.element, root) ? match.element : null;
    };
    const overlay = shown('adOverlay');
    const preview = shown('adPreview');
    const skip = shown('skipContainer');
    const badge = shown('adBadgeText');
    const countdown = shown('adCountdown');
    const visible = overlay !== null || preview !== null || skip !== null || badge !== null;
    return {
      visible,
      overlay: overlay !== null,
      pod: parsePod(badge?.textContent),
      skippable: skip !== null,
      countdown: visible ? parseCountdown(countdown?.textContent) : null,
    };
  }

  private isLive(): boolean {
    const root = this.root;
    if (root) {
      for (const [index, selector] of SELECTORS.liveIndicator.entries()) {
        if (root.matches(selector)) {
          this.chainIndices.liveIndicator = index;
          return true;
        }
      }
    }
    return this.bridge?.live === true;
  }

  /** Records the content src/duration while content (not an ad) is clearly playing. */
  private learnContent(v: HTMLVideoElement): void {
    if (this.facts?.anyAdSignal || v.currentTime <= CONTENT_MIN_TIME_S) return;
    const src = mediaSrc(v);
    if (src) this.contentSrc = src;
    if (Number.isFinite(v.duration) && v.duration > 0) this.contentDuration = v.duration;
  }

  private bridgeIdMismatch(): boolean {
    const videoId = this.bridge?.videoId;
    const urlId = new URL(location.href).searchParams.get('v');
    return Boolean(videoId && urlId && videoId !== urlId);
  }

  private sendProbe(): void {
    const probe: BridgeProbe = { ns: BRIDGE_NS, type: 'probe', nonce: this.nonce };
    window.postMessage(probe, location.origin);
  }

  private onBridgeMessage(event: MessageEvent): void {
    if (!isValidBridgeMessage(event, this.nonce)) return;
    const { videoId, adHint, live } = event.data;
    const b = this.bridge;
    if (b?.videoId === videoId && b.adHint === adHint && b.live === live) return;
    this.bridge = { videoId, adHint, live };
    this.invalidate();
  }

  /** §4.2: if the MAIN-world script never announced itself, inject it as <script src>. */
  private scheduleBridgeFallback(signal: AbortSignal): void {
    const timer = setTimeout(() => {
      if (signal.aborted || document.documentElement.hasAttribute(BRIDGE_READY_ATTR)) return;
      const script = document.createElement('script');
      script.src = browser.runtime.getURL('/youtube-bridge.js');
      script.addEventListener(
        'load',
        () => {
          script.remove();
        },
        { once: true, signal },
      );
      document.documentElement.append(script);
      this.ctx?.log.debug('bridge injected via <script src> fallback');
    }, BRIDGE_FALLBACK_MS);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
      },
      { once: true },
    );
  }
}
