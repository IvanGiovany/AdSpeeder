export interface ChainMatch<E extends Element = Element> {
  element: E;
  /** Position in the fallback chain that matched; > 0 means selector drift (§2.3). */
  index: number;
}

/** An AbortController that also aborts when `parent` does. */
export function childController(parent: AbortSignal): AbortController {
  const child = new AbortController();
  if (parent.aborted) {
    child.abort(parent.reason);
  } else {
    parent.addEventListener(
      'abort',
      () => {
        child.abort(parent.reason);
      },
      { once: true, signal: child.signal },
    );
  }
  return child;
}

/**
 * The §3.6 rule for choosing among several `<video>` elements (previews, miniplayer): the
 * connected one with the largest on-screen area and readyState ≥ 2, preferring elements inside
 * `preferredRoot`. When none has data yet it falls back to connected elements, so a pre-roll
 * that is still loading can be bound early.
 */
export function pickActiveVideo(
  candidates: Iterable<HTMLVideoElement>,
  preferredRoot?: Element | null,
): HTMLVideoElement | null {
  const connected = [...candidates].filter((v) => v.isConnected);
  const ready = connected.filter((v) => v.readyState >= 2);
  const usable = ready.length > 0 ? ready : connected;
  const preferred = preferredRoot ? usable.filter((v) => preferredRoot.contains(v)) : [];
  const pool = preferred.length > 0 ? preferred : usable;
  let best: HTMLVideoElement | null = null;
  let bestArea = -1;
  for (const v of pool) {
    const { width, height } = v.getBoundingClientRect();
    const area = width * height;
    if (area > bestArea) {
      best = v;
      bestArea = area;
    }
  }
  return best;
}

/** Tries each selector in order and returns the first match plus its chain index. */
export function queryChain<E extends Element = Element>(
  root: ParentNode,
  chain: readonly string[],
): ChainMatch<E> | null {
  for (const [index, selector] of chain.entries()) {
    try {
      const element = root.querySelector<E>(selector);
      if (element) return { element, index };
    } catch {
      // An invalid selector in a chain must not break the others.
    }
  }
  return null;
}

/** Like queryChain, but returns every element matched by the first selector that matches. */
export function queryAllChain(
  root: ParentNode,
  chain: readonly string[],
): { elements: Element[]; index: number } | null {
  for (const [index, selector] of chain.entries()) {
    try {
      const elements = [...root.querySelectorAll(selector)];
      if (elements.length > 0) return { elements, index };
    } catch {
      // An invalid selector in a chain must not break the others.
    }
  }
  return null;
}

/**
 * Resolves with the first element matching `chain`, or null when `signal` aborts. Watches
 * `root` (default: the document element) only until the element appears.
 */
export function waitForElement<E extends Element = Element>(
  chain: readonly string[],
  options: { root?: ParentNode; signal: AbortSignal },
): Promise<ChainMatch<E> | null> {
  const { signal } = options;
  const root = options.root ?? document;
  const found = queryChain<E>(root, chain);
  if (found || signal.aborted) return Promise.resolve(found);
  return new Promise((resolve) => {
    const target = root instanceof Document ? root.documentElement : root;
    const observer = new MutationObserver(() => {
      const match = queryChain<E>(root, chain);
      if (!match) return;
      observer.disconnect();
      resolve(match);
    });
    observer.observe(target, { childList: true, subtree: true });
    signal.addEventListener(
      'abort',
      () => {
        observer.disconnect();
        resolve(null);
      },
      { once: true },
    );
  });
}

/** Observes attribute changes on `target`; disconnects when `signal` aborts. */
export function observeAttr(
  target: Element,
  attributes: readonly string[],
  onChange: (records: MutationRecord[]) => void,
  signal: AbortSignal,
): void {
  if (signal.aborted) return;
  const observer = new MutationObserver(onChange);
  observer.observe(target, { attributes: true, attributeFilter: [...attributes] });
  signal.addEventListener(
    'abort',
    () => {
      observer.disconnect();
    },
    { once: true },
  );
}

/** Calls `fn` once calls stop for `ms`; a pending call is dropped when `signal` aborts. */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
  signal: AbortSignal,
): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  signal.addEventListener(
    'abort',
    () => {
      if (timer !== null) clearTimeout(timer);
    },
    { once: true },
  );
  return (...args: A) => {
    if (signal.aborted) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
}

/** Calls `fn` at most once per `ms` (leading and trailing); stops when `signal` aborts. */
export function throttle(fn: () => void, ms: number, signal: AbortSignal): () => void {
  let last = Number.NEGATIVE_INFINITY;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  signal.addEventListener(
    'abort',
    () => {
      if (trailing !== null) clearTimeout(trailing);
    },
    { once: true },
  );
  return () => {
    if (signal.aborted || trailing !== null) return;
    const wait = last + ms - Date.now();
    if (wait <= 0) {
      last = Date.now();
      fn();
      return;
    }
    trailing = setTimeout(() => {
      trailing = null;
      last = Date.now();
      if (!signal.aborted) fn();
    }, wait);
  };
}
