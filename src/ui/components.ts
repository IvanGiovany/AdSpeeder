/** Tiny vanilla UI helpers for popup and options (Phase 5). */

export interface ToggleOptions {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  signal: AbortSignal;
}

export function createToggle(_options: ToggleOptions): HTMLElement {
  throw new Error('not implemented');
}

export interface SelectOptions<T extends string | number> {
  label: string;
  value: T;
  options: readonly { value: T; label: string; disabled?: boolean; title?: string }[];
  onChange: (value: T) => void;
  signal: AbortSignal;
}

export function createSelect<T extends string | number>(_options: SelectOptions<T>): HTMLElement {
  throw new Error('not implemented');
}
