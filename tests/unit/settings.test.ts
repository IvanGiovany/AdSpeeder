import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  applyPatch,
  defaultSettings,
  getSettings,
  migrate,
  migrateStoredSettings,
  resetSettings,
  SCHEMA_VERSION,
  setSettings,
  STORAGE_KEY,
  subscribeSettings,
  type Settings,
} from '../../src/shared/settings';

beforeEach(() => {
  fakeBrowser.reset();
});

const stored = async (): Promise<unknown> =>
  (await fakeBrowser.storage.local.get(STORAGE_KEY))[STORAGE_KEY];

describe('defaults', () => {
  it('match the §5 Phase 1 schema', () => {
    expect(defaultSettings()).toEqual<Settings>({
      schemaVersion: SCHEMA_VERSION,
      enabled: true,
      speed: 16,
      mute: true,
      platforms: { youtube: true, netflix: false },
      promoActions: { intro: 'ignore', recap: 'ignore', promo: 'ignore' },
      debug: false,
    });
  });

  it('ship Netflix disabled', () => {
    expect(defaultSettings().platforms.netflix).toBe(false);
  });

  it('return a fresh object each time', () => {
    const a = defaultSettings();
    a.platforms.youtube = false;
    expect(defaultSettings().platforms.youtube).toBe(true);
  });

  it('are what getSettings() returns when storage is empty', async () => {
    await expect(getSettings()).resolves.toEqual(defaultSettings());
  });
});

describe('migrate', () => {
  it('migrates v0 (pre-schemaVersion) data to the current schema, keeping valid fields', () => {
    const v0 = { enabled: false, speed: 8, platforms: { netflix: true } };
    expect(migrate(v0)).toEqual<Settings>({
      ...defaultSettings(),
      enabled: false,
      speed: 8,
      platforms: { youtube: true, netflix: true },
    });
  });

  it('stamps the current schemaVersion', () => {
    expect(migrate({}).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it.each([undefined, null, 'garbage', 42, ['array']])('returns defaults for %j', (input) => {
    expect(migrate(input)).toEqual(defaultSettings());
  });

  it('replaces invalid field values with defaults', () => {
    const bad = {
      schemaVersion: 1,
      enabled: 'yes',
      speed: 3,
      mute: null,
      platforms: { youtube: 'on' },
      promoActions: { intro: 'speed', recap: 'skip' },
      debug: 1,
    };
    expect(migrate(bad)).toEqual<Settings>({
      ...defaultSettings(),
      promoActions: { intro: 'speed', recap: 'ignore', promo: 'ignore' },
    });
  });

  it('keeps known fields from a newer schema (downgrade)', () => {
    const future = { ...defaultSettings(), schemaVersion: SCHEMA_VERSION + 1, speed: 4, extra: 1 };
    expect(migrate(future)).toEqual({ ...defaultSettings(), speed: 4 });
  });

  it('migrateStoredSettings() writes v0 data back in the current schema', async () => {
    await fakeBrowser.storage.local.set({ [STORAGE_KEY]: { mute: false } });
    const result = await migrateStoredSettings();
    expect(result).toEqual({ ...defaultSettings(), mute: false });
    expect(await stored()).toEqual(result);
  });

  it('migrateStoredSettings() leaves newer-schema data untouched', async () => {
    const future = { ...defaultSettings(), schemaVersion: SCHEMA_VERSION + 1, extra: 'x' };
    await fakeBrowser.storage.local.set({ [STORAGE_KEY]: future });
    await migrateStoredSettings();
    expect(await stored()).toEqual(future);
  });
});

describe('get / set / subscribe', () => {
  it('setSettings() merges nested patches and persists', async () => {
    await setSettings({ platforms: { netflix: true } });
    const next = await setSettings({ speed: 4, promoActions: { recap: 'speed' } });
    expect(next).toEqual<Settings>({
      ...defaultSettings(),
      speed: 4,
      platforms: { youtube: true, netflix: true },
      promoActions: { intro: 'ignore', recap: 'speed', promo: 'ignore' },
    });
    await expect(getSettings()).resolves.toEqual(next);
  });

  it('applyPatch() does not mutate its input', () => {
    const current = defaultSettings();
    applyPatch(current, { platforms: { youtube: false } });
    expect(current).toEqual(defaultSettings());
  });

  it('resetSettings() restores defaults', async () => {
    await setSettings({ enabled: false, debug: true });
    await expect(resetSettings()).resolves.toEqual(defaultSettings());
    expect(await stored()).toEqual(defaultSettings());
  });

  it('subscribeSettings() reports migrated next/prev values', async () => {
    const listener = vi.fn();
    subscribeSettings(listener);
    await setSettings({ debug: true });
    await setSettings({ mute: false });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, { ...defaultSettings(), debug: true }, null);
    expect(listener).toHaveBeenNthCalledWith(
      2,
      { ...defaultSettings(), debug: true, mute: false },
      { ...defaultSettings(), debug: true },
    );
  });

  it('subscribeSettings() stops on unsubscribe and on abort', async () => {
    const viaReturn = vi.fn();
    const viaSignal = vi.fn();
    const controller = new AbortController();
    const unsubscribe = subscribeSettings(viaReturn);
    subscribeSettings(viaSignal, { signal: controller.signal });
    unsubscribe();
    controller.abort();
    await setSettings({ debug: true });
    expect(viaReturn).not.toHaveBeenCalled();
    expect(viaSignal).not.toHaveBeenCalled();
  });

  it('subscribeSettings() ignores other keys', async () => {
    const listener = vi.fn();
    subscribeSettings(listener);
    await fakeBrowser.storage.local.set({ somethingElse: 1 });
    expect(listener).not.toHaveBeenCalled();
  });
});
