import type { PlatformAdapter, PlatformId } from './PlatformAdapter';
import { NetflixAdapter } from './netflix/NetflixAdapter';
import { YouTubeAdapter } from './youtube/YouTubeAdapter';

export interface AdapterDefinition {
  id: PlatformId;
  displayName: string;
  // readonly (the spec says string[]) so the `as const` table below satisfies it.
  matches: readonly string[]; // manifest match patterns, also used by the build
  defaultEnabled: boolean;
  experimental: boolean;
  create: () => PlatformAdapter;
}

export const ADAPTERS = [
  {
    id: 'youtube',
    displayName: 'YouTube',
    matches: ['*://www.youtube.com/*', '*://m.youtube.com/*', '*://music.youtube.com/*'],
    defaultEnabled: true,
    experimental: false,
    create: () => new YouTubeAdapter(),
  },
  {
    id: 'netflix',
    displayName: 'Netflix',
    matches: ['*://www.netflix.com/*'],
    defaultEnabled: false,
    experimental: true,
    create: () => new NetflixAdapter(),
  },
] as const satisfies readonly AdapterDefinition[];

export function def(id: PlatformId): AdapterDefinition {
  const found = ADAPTERS.find((a) => a.id === id);
  if (!found) throw new Error(`No adapter registered for '${id}'`);
  return found;
}
