import { Controller } from './core/Controller';
import { def } from './platforms/registry';
import { createLogger } from './shared/logger';
import { getSettings, subscribeSettings, type PlatformId } from './shared/settings';

/**
 * Shared body of every `<id>.content.ts` (§2.2, D2): reads settings, picks the adapter from the
 * registry, constructs the Controller and keeps it in sync with settings. Everything hangs off
 * `ctx.signal` (WXT aborts it when the extension context goes away), so it tears down on unload.
 *
 * It runs even while the extension or platform is switched off: the Controller then does
 * nothing, and switching on takes effect without a reload.
 */
export async function bootstrap(id: PlatformId, ctx: { signal: AbortSignal }): Promise<void> {
  let settings = await getSettings();
  if (ctx.signal.aborted) return;
  const log = createLogger(id, { isDebug: () => settings.debug });
  const controller = new Controller({
    adapter: def(id).create(),
    settings,
    log,
    signal: ctx.signal,
  });
  subscribeSettings(
    (next) => {
      settings = next;
      controller.updateSettings(next);
    },
    { signal: ctx.signal },
  );
  await controller.start();
  log.debug('started');
}
