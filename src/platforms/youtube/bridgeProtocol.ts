/** postMessage schema between the isolated content script and the MAIN-world bridge (§2.3). */
export const BRIDGE_NS = 'adspeeder';

/** Set on document.documentElement by the MAIN-world script once it is running (§4.2). */
export const BRIDGE_READY_ATTR = 'data-adspeeder-bridge';

export interface BridgeProbe {
  ns: typeof BRIDGE_NS;
  type: 'probe';
  nonce: string;
}

export interface BridgeProbeResult {
  ns: typeof BRIDGE_NS;
  type: 'probe-result';
  nonce: string;
  videoId: string | null;
  adHint: boolean | null;
}

export type BridgeMessage = BridgeProbe | BridgeProbeResult;

/** Accepts only same-window messages in our namespace that carry the session nonce. */
export function isValidBridgeMessage(
  _event: MessageEvent,
  _expectedNonce: string,
): _event is MessageEvent<BridgeMessage> {
  throw new Error('not implemented');
}
