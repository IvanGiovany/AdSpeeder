# Netflix DOM discovery (§2.4, Phase 4)

All shipped Netflix chains are **UNVERIFIED — replace from capture**. The fixture tests our
guesses, not Netflix compatibility. Keep Netflix disabled until reviewing the capture.

1. Use an ad-tier account; leave AdSpeeder disabled for the initial capture.
2. Open DevTools on a title. Confirm the player root below, adjusting it if needed.
3. Paste the snippet. Call `nfCapture.mark('ad')`, `mark('intro')`, `mark('recap')`,
   `mark('promo')`, and `mark('content')` at the relevant boundaries.
4. Call `nfCapture.stop()` and copy the printed JSON. Inspect and redact personal identifiers.
5. Record browser/version, visible labels, fallback chain indices, root/node replacement,
   ad countdown and whether markers remain hidden after the break.
6. After updating selectors and fixture, enable Experimental Netflix. Try 2x then 4x,
   checking audio/mute restoration, buffering, stalls, navigation and title changes.
   Do not raise the hint without measured evidence. Record results in selector-log.md.

```js
(() => {
  const root = document.querySelector('.watch-video, [data-uia="player"]');
  if (!root) throw new Error('Select the player root first');
  const lifetime = new AbortController();
  const rows = [];
  let phase = 'content';
  const record = (el) =>
    rows.push({
      ms: Math.round(performance.now()),
      phase,
      tag: el.tagName,
      class: el.getAttribute('class'),
      uia: el.getAttribute('data-uia'),
      hidden: el.hasAttribute('hidden'),
    });
  record(root);
  root.querySelectorAll('[class], [data-uia]').forEach(record);
  const observer = new MutationObserver((records) => {
    records.forEach((r) => {
      if (r.target instanceof Element) record(r.target);
      r.addedNodes.forEach((n) => {
        if (n instanceof Element) {
          record(n);
          n.querySelectorAll('[class], [data-uia]').forEach(record);
        }
      });
    });
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'data-uia', 'hidden'],
  });
  lifetime.signal.addEventListener('abort', () => observer.disconnect(), { once: true });
  window.addEventListener('pagehide', () => lifetime.abort(), { signal: lifetime.signal });
  window.nfCapture = {
    mark: (label) => {
      phase = label;
      record(root);
    },
    stop: () => {
      lifetime.abort();
      console.log(JSON.stringify(rows, null, 2));
    },
  };
})();
```

The capture intentionally excludes text, URLs and media sources. Repeat if the player root
is replaced. No network requests or media writes are performed by the snippet.
