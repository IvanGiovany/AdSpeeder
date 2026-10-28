export interface ChainMatch<E extends Element = Element> {
  element: E;
  /** Position in the fallback chain that matched; > 0 means selector drift (§2.3). */
  index: number;
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
