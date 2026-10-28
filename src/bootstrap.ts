import { createLogger } from './shared/logger';
import { getSettings, type PlatformId } from './shared/settings';

/**
 * Shared body of every `<id>.content.ts` (§2.2). Lives outside entrypoints/ because WXT treats
 * every file there as an entrypoint; it sits at the entrypoint layer, so it may import core/
 * and platforms/.
 *
 * Phase 1 scaffold: reads settings and exits. It deliberately doesn't throw, so loading the
 * unpacked build doesn't put errors on real pages. Phase 3 constructs `def(id).create()` and a
 * Controller here.
 */
export async function bootstrap(id: PlatformId): Promise<void> {
  const settings = await getSettings();
  const log = createLogger(id, { isDebug: () => settings.debug });
  if (!settings.enabled || !settings.platforms[id]) {
    log.debug('disabled in settings; exiting');
    return;
  }
  log.debug('scaffold only: detection is not implemented yet');
}
