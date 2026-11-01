import { childController, pickActiveVideo, queryChain } from '../../shared/dom';
import { BaseAdapter, type AdapterCapabilities, type AdapterContext } from '../PlatformAdapter';
import type { AdSignal, SegmentKind } from '../signals';
import { SELECTORS, SELECTORS_VERSION } from './selectors';

/** Provisional DOM facts only; the engine owns all media writes and hysteresis (§2.4). */
export class NetflixAdapter extends BaseAdapter {
  readonly id = 'netflix';
  readonly displayName = 'Netflix';
  private lifetime: AbortController | null = null;
  private root: Element | null = null;
  private observer: MutationObserver | null = null;
  private indices: Record<string, number> = {};

  isWatchContext(url: URL): boolean {
    return url.hostname === 'www.netflix.com' && /^\/watch\/[^/]+/.test(url.pathname);
  }
  getCapabilities(): AdapterCapabilities {
    return {
      allowRateBoost: true,
      allowMute: true,
      rateEnforcement: 'guard',
      maxRateHint: 16,
      // D34: Netflix's DRM stream can't download ads at 16x; back off instead of stalling.
      lowerRateOnStall: true,
    };
  }
  getInteractionRoot(): Element | null {
    return this.root;
  }
  getDiagnostics() {
    return { selectorsVersion: SELECTORS_VERSION, chainIndices: { ...this.indices } };
  }

  private match(key: keyof typeof SELECTORS, root: ParentNode): Element | null {
    const match = queryChain(root, SELECTORS[key]);
    this.indices[key] = match?.index ?? -1;
    return match?.element ?? null;
  }
  private visible(key: keyof typeof SELECTORS): boolean {
    const el = this.root && this.match(key, this.root);
    if (!el) return false;
    if (key === 'adBreak' && el.textContent.trim() !== 'Ad') return false;
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hasAttribute('hidden') || style.display === 'none' || style.visibility === 'hidden')
        return false;
      if (node === this.root) break;
    }
    return true;
  }
  protected collectSignals(): AdSignal[] {
    if (!this.isWatchContext(new URL(location.href))) return [];
    const signal = (key: keyof typeof SELECTORS, kind: SegmentKind, weight: number): AdSignal => ({
      source: `netflix.${key}`,
      active: this.visible(key),
      kind,
      weight,
      at: performance.now(),
    });
    const ads = [signal('adBreak', 'ad', 0.6), signal('countdown', 'ad', 0.3)];
    // Do not combine unrelated promo hints with an ad countdown to manufacture confidence.
    if (ads.some((s) => s.active)) return ads;
    for (const kind of ['intro', 'recap', 'promo'] as const) {
      const item = signal(kind, kind, 0.6);
      if (item.active) return [item];
    }
    return [];
  }
  protected findVideo(): HTMLVideoElement | null {
    this.bindRoot();
    if (!this.root) return null;
    return pickActiveVideo(
      this.root.querySelectorAll<HTMLVideoElement>(SELECTORS.video[0]),
      this.root,
    );
  }
  private bindRoot(): void {
    const root = this.match('playerRoot', document);
    if (root === this.root) return;
    this.observer?.disconnect();
    this.root = root;
    if (!root || this.lifetime?.signal.aborted) return;
    this.observer = new MutationObserver(() => {
      this.invalidate();
    });
    this.observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-uia', 'hidden', 'style'],
      characterData: true,
    });
  }
  protected installWatchers(ctx: AdapterContext): void {
    this.lifetime = childController(ctx.signal);
    const { signal } = this.lifetime;
    this.bindRoot();
    window.addEventListener(
      'popstate',
      () => {
        this.reportNavigation();
      },
      { signal },
    );
    // Narrow-root observation; polling discovers late/replaced roots without a body observer.
    const timer = setInterval(() => {
      this.reportNavigation();
      this.bindRoot();
      this.invalidate();
    }, 250);
    signal.addEventListener(
      'abort',
      () => {
        clearInterval(timer);
        this.observer?.disconnect();
      },
      { once: true },
    );
  }
  override destroy(): void {
    this.lifetime?.abort();
    super.destroy();
  }
}
