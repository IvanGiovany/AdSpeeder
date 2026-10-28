import { BaseAdapter, type AdapterCapabilities, type AdapterContext } from '../PlatformAdapter';
import type { AdSignal } from '../signals';

/** Signals Y1–Y5 (§2.3). Implemented in Phase 3. */
export class YouTubeAdapter extends BaseAdapter {
  readonly id = 'youtube';
  readonly displayName = 'YouTube';

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
