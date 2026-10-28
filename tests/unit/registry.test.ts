import { describe, expect, it } from 'vitest';
import { ADAPTERS, def } from '../../src/platforms/registry';
import { defaultSettings, PLATFORM_IDS } from '../../src/shared/settings';

describe('registry', () => {
  it('registers exactly the platforms the settings schema knows', () => {
    expect(ADAPTERS.map((a) => a.id).sort()).toEqual([...PLATFORM_IDS].sort());
  });

  it('agrees with settings defaults on which platforms are enabled', () => {
    const defaults = defaultSettings().platforms;
    for (const a of ADAPTERS) expect(a.defaultEnabled, a.id).toBe(defaults[a.id]);
  });

  it('ships Netflix disabled and experimental', () => {
    expect(def('netflix')).toMatchObject({ defaultEnabled: false, experimental: true });
  });

  it('creates adapters whose id matches their entry', () => {
    for (const a of ADAPTERS) expect(a.create().id).toBe(a.id);
  });
});
