# Changelog

## Unreleased

- Netflix (Experimental): if the player re-applies the ad speed shortly after an ad, AdSpeeder
  now puts your speed back (D34). Buffering stalls during a boosted Netflix ad halve the ad
  speed for the rest of that break instead of starving the stream. Unverified on a live account.

- Allow Experimental Netflix ad speed up to 16x at the owner's request, with browser rejection
  fallback preserved. Live Netflix playback at 16x remains unverified.

- Updated Netflix's ad signal to the captured `ads-info-text` label (`Ad`) and added a local
  content-state regression check. Other Netflix selectors and real playback remain unverified.

## 0.2.0 — 2026-10-30 (review candidate)

- Netflix Experimental adapter with `2026-10-30-provisional` selector chains and local fixture;
  every chain is UNVERIFIED pending live DOM capture. Disabled by default; rate hint 4x.
- Minimal popup/options, light/dark themes, subtle motion with reduced-motion support,
  live settings, local stats, debug events/export, thresholds and host-access guidance.
- Added manifest, Netflix, UI, performance and hardening regression checks; release instructions.
- Preserved D22 SSAI handling and D25 two-stage restoration with the Chromium drain allowance.

## 0.1.0

- Initial MV3 scaffold, platform-neutral engine and YouTube adapter (Phases 0–3).
