import { defineConfig } from 'wxt';
import { ADAPTERS, def } from './src/platforms/registry';

// §4.1: one file serves both the MAIN-world content script and the <script src> fallback
// (§4.2), so it is built once at the root by src/entrypoints/youtube-bridge.ts.
const BRIDGE_FILE = 'youtube-bridge.js';

// Firefox requires an explicit add-on id (§4.2). Change before the first AMO submission only.
const GECKO_ID = '{3d61e7dc-3366-453e-aa30-a80805d29ed4}';
// `world: "MAIN"` content scripts need Firefox 128+; `data_collection_permissions` (required
// by AMO for new add-ons) needs 140+ on desktop and 142+ on Android.
const GECKO_MIN_VERSION = '140.0';
const GECKO_ANDROID_MIN_VERSION = '142.0';

const hostPermissions = [...new Set(ADAPTERS.flatMap((a) => a.matches))];
const youtubeMatches = [...def('youtube').matches];

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  imports: false,
  zip: {
    // Explicit allow-list: never package the owner's PDF, local agent files or test output.
    includeSources: [
      'src/**',
      'public/**',
      'docs/**',
      'package.json',
      'package-lock.json',
      'wxt.config.ts',
      'tsconfig.json',
      'eslint.config.js',
      'vitest.config.ts',
      'playwright.config.ts',
      'README.md',
      'CHANGELOG.md',
      'AGENTS.md',
      'CLAUDE.md',
      '.prettierrc*',
      '.prettierignore',
      '.gitignore',
      '.github/**',
    ],
    dotSources: true,
  },
  manifest: ({ browser }) => ({
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
    action: { default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' } },
    permissions: ['storage'],
    host_permissions: hostPermissions,
    web_accessible_resources: [{ resources: [BRIDGE_FILE], matches: youtubeMatches }],
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: GECKO_ID,
          strict_min_version: GECKO_MIN_VERSION,
          data_collection_permissions: { required: ['none'] },
        },
        gecko_android: { strict_min_version: GECKO_ANDROID_MIN_VERSION },
      },
    }),
  }),
  hooks: {
    'build:manifestGenerated': (wxt, manifest) => {
      // §4.2: Safari has no MAIN-world content scripts; it uses the <script src> fallback only.
      if (wxt.config.browser === 'safari') return;
      const scripts = (manifest.content_scripts ??= []);
      // WXT's manifest typings predate `world`; the wider type keeps the literal checked.
      const bridge: (typeof scripts)[number] & { world: 'MAIN' } = {
        matches: youtubeMatches,
        js: [BRIDGE_FILE],
        run_at: 'document_start',
        world: 'MAIN',
      };
      const youtubeIndex = scripts.findIndex((s) => s.js?.includes('content-scripts/youtube.js'));
      scripts.splice(youtubeIndex + 1, 0, bridge);
    },
  },
});
