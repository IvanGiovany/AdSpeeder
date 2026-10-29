import type { TabStatus } from '../shared/messaging';
export function formatDuration(seconds: number): string {
  const n = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  if (n >= 3600)
    return `${String(Math.floor(n / 3600))}h ${String(Math.floor((n % 3600) / 60)).padStart(2, '0')}m`;
  if (n >= 60) return `${String(Math.floor(n / 60))}m ${String(n % 60).padStart(2, '0')}s`;
  return `${String(n)}s`;
}
export function formatCount(n: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.max(0, n));
}
export function formatRate(rate: number): string {
  return `${String(rate)}×`;
}
export function formatStatus(status: TabStatus | null): string {
  if (!status) return 'Not a supported page';
  if (status.phase === 'inactive') return 'Paused on this page';
  if (status.phase === 'watching') return 'Watching for ads';
  if (status.phase === 'contested') return 'Player controls speed · ad muted';
  const pod = status.pod ? ` ${String(status.pod.index)} of ${String(status.pod.total)}` : '';
  return status.rate === null
    ? `Muting ad${pod}`
    : `Boosting ad${pod} at ${formatRate(status.rate)}`;
}
