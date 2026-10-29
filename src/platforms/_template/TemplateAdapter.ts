import {
  BaseAdapter,
  type AdapterCapabilities,
  type AdapterContext,
  type PlatformId,
} from '../PlatformAdapter';
import type { AdSignal } from '../signals';

/**
 * Copy-me skeleton for a new platform (Â§2.2). Phase 4 expands this with per-method TODOs and
 * docs/ADDING_A_PLATFORM.md. The id is a constructor argument only so the template compiles
 * without being registered; a real adapter declares `readonly id = '<id>'`.
 */
export class TemplateAdapter extends BaseAdapter {
  constructor(
    readonly id: PlatformId,
    readonly displayName: string,
  ) {
    super();
  }

  isWatchContext(_url: URL): boolean {
    // TODO: restrict to supported player URLs.
    return false;
  }

  getCapabilities(): AdapterCapabilities {
    // TODO: enable only capabilities verified on the target player.
    return { allowRateBoost: false, allowMute: false, rateEnforcement: 'none' };
  }

  protected collectSignals(): AdSignal[] {
    // TODO: read versioned selector chains and return raw weighted signals (D8).
    return [];
  }

  protected findVideo(): HTMLVideoElement | null {
    // TODO: use pickActiveVideo with candidates from selectors.ts.
    return null;
  }

  protected installWatchers(_ctx: AdapterContext): void {
    // TODO: observe the player root, invalidate on changes, report navigation;
    // bind every listener/observer to ctx.signal and abort owned resources on destroy.
  }
}
