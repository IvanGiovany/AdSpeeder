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
  /** Whether the player reports a live stream; null when unknown (§2.3 live exclusion, D20). */
  live: boolean | null;
}

export type BridgeMessage = BridgeProbe | BridgeProbeResult;

/** A per-session nonce for the isolated script's probes. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const isNullableString = (v: unknown): boolean => v === null || typeof v === 'string';
const isNullableBoolean = (v: unknown): boolean => v === null || typeof v === 'boolean';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Isolated side: accepts only a same-window `probe-result` in our namespace carrying the
 * session nonce, with well-typed fields. Everything else is ignored.
 */
export function isValidBridgeMessage(
  event: MessageEvent,
  expectedNonce: string,
): event is MessageEvent<BridgeProbeResult> {
  if (event.source !== window) return false;
  const data = record(event.data);
  return (
    data !== null &&
    data.ns === BRIDGE_NS &&
    data.type === 'probe-result' &&
    data.nonce === expectedNonce &&
    isNullableString(data.videoId) &&
    isNullableBoolean(data.adHint) &&
    isNullableBoolean(data.live)
  );
}

/** MAIN side: accepts only a same-window `probe` in our namespace with a nonce. */
export function isBridgeProbe(event: MessageEvent): event is MessageEvent<BridgeProbe> {
  if (event.source !== window) return false;
  const data = record(event.data);
  return (
    data !== null &&
    data.ns === BRIDGE_NS &&
    data.type === 'probe' &&
    typeof data.nonce === 'string' &&
    data.nonce.length > 0
  );
}
