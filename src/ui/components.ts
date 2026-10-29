export interface ToggleOptions {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  signal: AbortSignal;
}
export function createToggle(options: ToggleOptions): HTMLElement {
  const label = document.createElement('label');
  label.className = 'control';
  const text = document.createElement('span');
  text.textContent = options.label;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = options.checked;
  input.addEventListener(
    'change',
    () => {
      options.onChange(input.checked);
    },
    { signal: options.signal },
  );
  label.append(text, input);
  return label;
}
export interface SelectOptions<T extends string | number> {
  label: string;
  value: T;
  options: readonly { value: T; label: string; disabled?: boolean; title?: string }[];
  onChange: (value: T) => void;
  signal: AbortSignal;
}
export function createSelect<T extends string | number>(options: SelectOptions<T>): HTMLElement {
  const label = document.createElement('label');
  label.className = 'control';
  const text = document.createElement('span');
  text.textContent = options.label;
  const select = document.createElement('select');
  for (const item of options.options) {
    const option = document.createElement('option');
    option.value = String(item.value);
    option.textContent = item.label;
    option.disabled = item.disabled ?? false;
    option.title = item.title ?? '';
    select.append(option);
  }
  select.value = String(options.value);
  select.addEventListener(
    'change',
    () => {
      const item = options.options.find((o) => String(o.value) === select.value);
      if (item) options.onChange(item.value);
    },
    { signal: options.signal },
  );
  label.append(text, select);
  return label;
}
export function pageLifetime(): AbortSignal {
  const lifetime = new AbortController();
  window.addEventListener(
    'pagehide',
    () => {
      lifetime.abort();
    },
    { once: true, signal: lifetime.signal },
  );
  return lifetime.signal;
}
export function showError(error: unknown): void {
  const target = document.getElementById('error');
  if (target) target.textContent = `Could not save or load: ${String(error)}`;
}

export function preserveControlFocus(): () => void {
  const active = document.activeElement;
  const label = active?.parentElement;
  const name = label?.tagName === 'LABEL' ? label.firstElementChild?.textContent : null;
  return () => {
    if (!name) return;
    for (const item of document.getElementsByTagName('label')) {
      if (item.firstElementChild?.textContent !== name) continue;
      const control = item.lastElementChild;
      if (control instanceof HTMLElement) control.focus();
    }
  };
}
