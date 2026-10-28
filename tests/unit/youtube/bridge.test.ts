/**
 * @vitest-environment-options {"url": "https://www.youtube.com/watch?v=abc"}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bridgeScript from '../../../src/entrypoints/youtube-bridge';
import {
  BRIDGE_NS,
  BRIDGE_READY_ATTR,
  createNonce,
  isBridgeProbe,
  isValidBridgeMessage,
  type BridgeProbeResult,
} from '../../../src/platforms/youtube/bridgeProtocol';

afterEach(() => {
  document.documentElement.removeAttribute(BRIDGE_READY_ATTR);
  document.body.replaceChildren();
});

const event = (data: unknown, source: Window | null = window) =>
  new MessageEvent('message', { data, source });

describe('bridge protocol validation', () => {
  const nonce = createNonce();
  const result: BridgeProbeResult = {
    ns: BRIDGE_NS,
    type: 'probe-result',
    nonce,
    videoId: 'x',
    adHint: null,
    live: false,
  };

  it('accepts a well-formed same-window result with the session nonce', () => {
    expect(isValidBridgeMessage(event(result), nonce)).toBe(true);
  });

  it.each([
    ['another source', event(result, null)],
    ['wrong nonce', event({ ...result, nonce: 'x' })],
    ['other namespace', event({ ...result, ns: 'evil' })],
    ['a probe', event({ ns: BRIDGE_NS, type: 'probe', nonce })],
    ['bad videoId', event({ ...result, videoId: 5 })],
    ['bad adHint', event({ ...result, adHint: 'yes' })],
    ['bad live', event({ ...result, live: 1 })],
    ['not an object', event('hello')],
  ])('rejects %s', (_name, e) => {
    expect(isValidBridgeMessage(e, nonce)).toBe(false);
  });

  it('isBridgeProbe accepts only same-window namespaced probes with a nonce', () => {
    expect(isBridgeProbe(event({ ns: BRIDGE_NS, type: 'probe', nonce }))).toBe(true);
    expect(isBridgeProbe(event({ ns: BRIDGE_NS, type: 'probe', nonce: '' }))).toBe(false);
    expect(isBridgeProbe(event({ ns: BRIDGE_NS, type: 'probe', nonce }, null))).toBe(false);
    expect(isBridgeProbe(event(result))).toBe(false);
  });

  it('creates distinct 128-bit hex nonces', () => {
    expect(createNonce()).toMatch(/^[0-9a-f]{32}$/);
    expect(createNonce()).not.toBe(createNonce());
  });
});

describe('MAIN-world bridge script', () => {
  const main = (bridgeScript as unknown as { main: () => void }).main;

  // happy-dom's postMessage doesn't set event.source to the window; browsers do (e2e covers it).
  beforeEach(() => {
    vi.spyOn(window, 'postMessage').mockImplementation((data: unknown) => {
      queueMicrotask(() =>
        window.dispatchEvent(new MessageEvent('message', { data, source: window })),
      );
    });
  });

  async function probe(nonce: string): Promise<BridgeProbeResult> {
    return new Promise((resolve) => {
      const onMessage = (e: MessageEvent) => {
        if (isValidBridgeMessage(e, nonce)) {
          window.removeEventListener('message', onMessage);
          resolve(e.data);
        }
      };
      window.addEventListener('message', onMessage);
      window.dispatchEvent(event({ ns: BRIDGE_NS, type: 'probe', nonce }));
    });
  }

  it('announces itself and answers probes from the player API, guarded', async () => {
    const player = Object.assign(document.createElement('div'), { id: 'movie_player' });
    Object.assign(player, {
      getVideoData: () => ({ video_id: 'ad123', isLive: false }),
      getAdState: () => 1,
    });
    document.body.append(player);
    main();
    expect(document.documentElement.hasAttribute(BRIDGE_READY_ATTR)).toBe(true);
    const nonce = createNonce();
    await expect(probe(nonce)).resolves.toMatchObject({
      nonce,
      videoId: 'ad123',
      adHint: true,
      live: false,
    });
  });

  it('reports unknowns when the player API is missing or throws', async () => {
    const player = Object.assign(document.createElement('div'), { id: 'movie_player' });
    Object.assign(player, {
      getVideoData: () => {
        throw new Error('changed');
      },
    });
    document.body.append(player);
    main();
    await expect(probe(createNonce())).resolves.toMatchObject({
      videoId: null,
      adHint: null,
      live: null,
    });
  });

  it('does not install twice', () => {
    document.documentElement.setAttribute(BRIDGE_READY_ATTR, '');
    const before = document.documentElement.attributes.length;
    main();
    expect(document.documentElement.attributes.length).toBe(before);
  });
});
