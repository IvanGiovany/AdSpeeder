import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import {
  BRIDGE_NS,
  BRIDGE_READY_ATTR,
  isBridgeProbe,
  type BridgeProbeResult,
} from '../platforms/youtube/bridgeProtocol';
import { SELECTORS } from '../platforms/youtube/selectors';

/** The undocumented parts of YouTube's player element this probe reads (all optional; §2.3, D21). */
interface PlayerApi {
  getVideoData?: () => { video_id?: unknown; isLive?: unknown } | undefined;
  getAdState?: () => unknown;
}

function findPlayer(): PlayerApi | null {
  for (const selector of SELECTORS.playerRoot) {
    const el = document.querySelector(selector);
    if (el) return el as unknown as PlayerApi;
  }
  return null;
}

/** Every player call is optional and guarded: these methods are undocumented and change. */
function readPlayer(): Pick<BridgeProbeResult, 'videoId' | 'adHint' | 'live'> {
  let videoId: string | null = null;
  let adHint: boolean | null = null;
  let live: boolean | null = null;
  try {
    const player = findPlayer();
    const data = player?.getVideoData?.();
    if (typeof data?.video_id === 'string' && data.video_id) videoId = data.video_id;
    if (typeof data?.isLive === 'boolean') live = data.isLive;
    const state = player?.getAdState?.();
    if (state === 1) adHint = true;
    else if (state === -1 || state === 0) adHint = false;
  } catch {
    // Leave the fields unknown; an absent answer is never a negative signal.
  }
  return { videoId, adHint, live };
}

/**
 * MAIN-world player-API probe (§2.3). Built to /youtube-bridge.js and registered both as a
 * `world: "MAIN"` content script and as a web-accessible resource for the <script src>
 * fallback (D1). It polls nothing: it answers probes from the isolated script.
 */
export default defineUnlistedScript(() => {
  const root = document.documentElement;
  if (root.hasAttribute(BRIDGE_READY_ATTR)) return; // already running (MAIN + fallback)
  root.setAttribute(BRIDGE_READY_ATTR, '');
  window.addEventListener('message', (event) => {
    if (!isBridgeProbe(event)) return;
    const result: BridgeProbeResult = {
      ns: BRIDGE_NS,
      type: 'probe-result',
      nonce: event.data.nonce,
      ...readPlayer(),
    };
    window.postMessage(result, location.origin);
  });
});
