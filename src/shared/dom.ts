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
  _root: ParentNode,
  _chain: readonly string[],
): ChainMatch<E> | null {
  throw new Error('not implemented');
}

/** Resolves with the first element matching `chain`, or null when `signal` aborts. */
export function waitForElement<E extends Element = Element>(
  _chain: readonly string[],
  _options: { root?: ParentNode; signal: AbortSignal },
): Promise<ChainMatch<E> | null> {
  throw new Error('not implemented');
}

/** Observes attribute changes on `target`; disconnects when `signal` aborts. */
export function observeAttr(
  _target: Element,
  _attributes: readonly string[],
  _onChange: (records: MutationRecord[]) => void,
  _signal: AbortSignal,
): void {
  throw new Error('not implemented');
}

export function debounce<A extends unknown[]>(
  _fn: (...args: A) => void,
  _ms: number,
  _signal: AbortSignal,
): (...args: A) => void {
  throw new Error('not implemented');
}
