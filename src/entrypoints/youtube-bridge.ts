import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

/**
 * MAIN-world player-API probe (§2.3). Built to /youtube-bridge.js and registered both as a
 * `world: "MAIN"` content script and as a web-accessible resource (wxt.config.ts).
 *
 * Phase 1 scaffold: inert, so it never throws in the page's own world. Phase 3 implements the
 * protocol from platforms/youtube/bridgeProtocol.ts.
 */
export default defineUnlistedScript(() => undefined);
