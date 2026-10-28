import { BaseAdapter, type AdapterCapabilities, type AdapterContext } from '../PlatformAdapter';
import type { AdSignal } from '../signals';

/** Ad, intro, recap and promo signals (§2.4). Implemented in Phase 4 after DOM discovery. */
export class NetflixAdapter extends BaseAdapter {
  readonly id = 'netflix';
  readonly displayName = 'Netflix';

  isWatchContext(_url: URL): boolean {
    throw new Error('not implemented');
  }

  getCapabilities(): AdapterCapabilities {
    throw new Error('not implemented');
  }

  protected collectSignals(): AdSignal[] {
    throw new Error('not implemented');
  }

  protected findVideo(): HTMLVideoElement | null {
    throw new Error('not implemented');
  }

  protected installWatchers(_ctx: AdapterContext): void {
    throw new Error('not implemented');
  }
}
