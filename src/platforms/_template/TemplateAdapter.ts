import {
  BaseAdapter,
  type AdapterCapabilities,
  type AdapterContext,
  type PlatformId,
} from '../PlatformAdapter';
import type { AdSignal } from '../signals';

/**
 * Copy-me skeleton for a new platform (§2.2). Phase 4 expands this with per-method TODOs and
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
