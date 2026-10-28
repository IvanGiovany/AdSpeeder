import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  isMessage,
  onMessage,
  sendMessage,
  type Message,
  type MessageSender,
  type TabStatus,
} from '../../src/shared/messaging';

const status: TabStatus = { platform: 'youtube', phase: 'boosting', rate: 16, pod: null };
const tabStatus: Message<'tab-status'> = { type: 'tab-status', status };

/** Delivers `raw` to the registered listeners as if sent by `sender`; resolves with the reply. */
async function deliver(raw: unknown, sender: MessageSender): Promise<unknown> {
  let reply: unknown = 'no reply';
  let resolveReply = (): void => undefined;
  const replied = new Promise<void>((resolve) => {
    resolveReply = resolve;
  });
  const results: unknown[] = await fakeBrowser.runtime.onMessage.trigger(
    raw,
    sender,
    (value: unknown) => {
      reply = value;
      resolveReply();
    },
  );
  if (results.includes(true)) await replied;
  return reply;
}

const self = (): MessageSender => ({
  id: fakeBrowser.runtime.id,
  tab: { id: 7 } as MessageSender['tab'],
});

beforeEach(() => {
  fakeBrowser.reset();
});

describe('isMessage', () => {
  it('accepts known types only', () => {
    expect(isMessage(tabStatus)).toBe(true);
    expect(isMessage({ type: 'unknown' })).toBe(false);
    expect(isMessage(null)).toBe(false);
    expect(isMessage('tab-status')).toBe(false);
  });
});

describe('onMessage', () => {
  it('routes a message to its typed handler with the sender', async () => {
    const handler = vi.fn();
    onMessage({ 'tab-status': handler });
    const reply = await deliver(tabStatus, self());
    expect(handler).toHaveBeenCalledWith(tabStatus, self());
    expect(reply).toEqual({ ok: true, value: undefined });
  });

  it('reports handler errors in the reply envelope', async () => {
    onMessage({
      'stats-batch': () => {
        throw new Error('boom');
      },
    });
    const batch = { platform: 'youtube', adsSeen: 1, secondsSaved: 5 } as const;
    const reply = await deliver({ type: 'stats-batch', batch }, self());
    expect(reply).toEqual({ ok: false, error: 'boom' });
  });

  it('ignores other extensions, unknown types and unhandled types', async () => {
    const handler = vi.fn();
    onMessage({ 'tab-status': handler });
    await expect(deliver(tabStatus, { id: 'someone-else' })).resolves.toBe('no reply');
    await expect(deliver({ type: 'nope' }, self())).resolves.toBe('no reply');
    await expect(deliver({ type: 'stats-batch' }, self())).resolves.toBe('no reply');
    expect(handler).not.toHaveBeenCalled();
  });

  it('removes the listener on unsubscribe and on abort', () => {
    const controller = new AbortController();
    const off = onMessage({}, {});
    onMessage({}, { signal: controller.signal });
    expect(fakeBrowser.runtime.onMessage.hasListeners()).toBe(true);
    off();
    controller.abort();
    expect(fakeBrowser.runtime.onMessage.hasListeners()).toBe(false);
  });
});

describe('sendMessage', () => {
  it('resolves with the handler value', async () => {
    // fake-browser sends with an empty sender, so route through a pass-through listener.
    fakeBrowser.runtime.onMessage.addListener(
      (raw: unknown, _s: unknown, respond: (r: unknown) => void) => {
        respond({ ok: true, value: isMessage(raw) ? raw.type : null });
        return true;
      },
    );
    await expect(sendMessage(tabStatus)).resolves.toBe('tab-status');
  });

  it('rejects with the handler error', async () => {
    fakeBrowser.runtime.onMessage.addListener(
      (_r: unknown, _s: unknown, respond: (r: unknown) => void) => {
        respond({ ok: false, error: 'nope' });
        return true;
      },
    );
    await expect(sendMessage(tabStatus)).rejects.toThrow('nope');
  });

  it('rejects when nobody answers', async () => {
    fakeBrowser.runtime.onMessage.addListener(() => undefined);
    await expect(sendMessage(tabStatus)).rejects.toThrow(
      "No AdSpeeder handler answered 'tab-status'",
    );
  });
});
