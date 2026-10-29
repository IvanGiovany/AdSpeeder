import { onMessage, sendMessage, type TabStatus, type DebugEvent } from './shared/messaging';
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
  let status: TabStatus | null = null;
  const events: DebugEvent[] = [];
  const log = createLogger(id, {
    isDebug: () => settings.debug,
    onEvent: (level, args) => {
      if (!settings.debug) return;
      events.push({
        at: Date.now(),
        scope: id,
        level,
        message: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
      });
      if (events.length > 50) events.shift();
    },
  });
  onMessage({ 'get-status': () => status, 'get-debug': () => [...events] }, { signal: ctx.signal });
  const controller = new Controller({
    adapter: def(id).create(),
    settings,
    log,
    signal: ctx.signal,
    reportStatus: (next) => {
      status = next;
      void sendMessage({ type: 'tab-status', status: next }).catch(() => undefined);
    },
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
