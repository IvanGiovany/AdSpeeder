import { browser, type Browser } from './browser';
import type { PlatformId } from './settings';
import type { StatsBatch, StatsSummary } from './stats';

export type TabPhase = 'watching' | 'boosting' | 'contested' | 'inactive';

/** What a content script reports about its tab; drives the badge and popup status line. */
export interface TabStatus {
  platform: PlatformId;
  phase: TabPhase;
  /** Rate currently applied while boosting, else null. */
  rate: number | null;
  maxRate?: number | null;
  pod: { index: number; total: number } | null;
}

/** Every runtime message: its payload (besides `type`) and the handler's response. */
export interface DebugEvent {
  at: number;
  scope: string;
  level: string;
  message: string;
}
export interface MessageMap {
  'get-status': { payload: object; response: TabStatus | null };
  'get-debug': { payload: object; response: DebugEvent[] };
  'reset-stats': { payload: object; response: undefined };
  /** content → background: update this tab's badge. */
  'tab-status': { payload: { status: TabStatus }; response: undefined };
  /** content → background: add a stats batch (§3.7). */
  'stats-batch': { payload: { batch: StatsBatch }; response: undefined };
  /** popup/options → background: today's and all-time stats (D6). */
  'get-stats': { payload: object; response: StatsSummary };
}

export type MessageType = keyof MessageMap;

export const MESSAGE_TYPES: readonly MessageType[] = [
  'tab-status',
  'stats-batch',
  'get-stats',
  'get-status',
  'get-debug',
  'reset-stats',
];

export type Message<T extends MessageType = MessageType> = {
  [K in T]: { type: K } & MessageMap[K]['payload'];
}[T];

export type MessageResponse<T extends MessageType> = MessageMap[T]['response'];

export type MessageSender = Browser.runtime.MessageSender;

export type MessageHandlers = {
  [K in MessageType]?: (
    message: Message<K>,
    sender: MessageSender,
  ) => MessageResponse<K> | Promise<MessageResponse<K>>;
};

/** Wire format of every reply, so a handler error reaches the sender as a rejection. */
type Envelope = { ok: true; value: unknown } | { ok: false; error: string };

export function isMessage(value: unknown): value is Message {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  return (MESSAGE_TYPES as readonly unknown[]).includes(value.type);
}

function isEnvelope(value: unknown): value is Envelope {
  return typeof value === 'object' && value !== null && 'ok' in value;
}

function unwrap<T extends MessageType>(type: T, reply: unknown): MessageResponse<T> {
  if (!isEnvelope(reply)) throw new Error(`No AdSpeeder handler answered '${type}'`);
  if (!reply.ok) throw new Error(reply.error);
  return reply.value as MessageResponse<T>;
}

export async function sendMessage<T extends MessageType>(
  message: Message<T>,
): Promise<MessageResponse<T>> {
  const reply: unknown = await browser.runtime.sendMessage(message);
  return unwrap(message.type, reply);
}

export async function sendTabMessage<T extends MessageType>(
  tabId: number,
  message: Message<T>,
): Promise<MessageResponse<T>> {
  const reply: unknown = await browser.tabs.sendMessage(tabId, message);
  return unwrap(message.type, reply);
}

function dispatch<T extends MessageType>(
  handlers: MessageHandlers,
  message: Message<T>,
  sender: MessageSender,
): Promise<MessageResponse<T>> | null {
  const handler = handlers[message.type];
  if (!handler) return null;
  return Promise.resolve().then(() => handler(message, sender));
}

/**
 * Routes typed messages from this extension to `handlers`. Messages from other extensions,
 * unknown types and types without a handler are ignored, so several routers can coexist.
 */
export function onMessage(
  handlers: MessageHandlers,
  options: { signal?: AbortSignal } = {},
): () => void {
  const { signal } = options;
  if (signal?.aborted) return () => undefined;
  const listener = (
    raw: unknown,
    sender: MessageSender,
    sendResponse: (reply: Envelope) => void,
  ): true | undefined => {
    if (sender.id !== browser.runtime.id || !isMessage(raw)) return undefined;
    const pending = dispatch(handlers, raw, sender);
    if (!pending) return undefined;
    pending.then(
      (value) => {
        sendResponse({ ok: true, value });
      },
      (error: unknown) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      },
    );
    // Keeps the channel open for the async sendResponse (works in Chrome and Firefox).
    return true;
  };
  browser.runtime.onMessage.addListener(listener);
  const remove = () => {
    browser.runtime.onMessage.removeListener(listener);
  };
  signal?.addEventListener('abort', remove, { once: true });
  return remove;
}
