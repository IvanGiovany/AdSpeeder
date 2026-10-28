import { browser, type Browser } from './browser';

export const PLATFORM_IDS = ['youtube', 'netflix'] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export const PROMO_KINDS = ['intro', 'recap', 'promo'] as const;
export type PromoKind = (typeof PROMO_KINDS)[number];

export const PROMO_ACTIONS = ['ignore', 'speed'] as const;
export type PromoAction = (typeof PROMO_ACTIONS)[number];

/** Requested ad speed. The engine clamps it to the per-element probed maximum (§3.2). */
export const SPEED_OPTIONS = [2, 4, 8, 16] as const;
export type Speed = (typeof SPEED_OPTIONS)[number];

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'settings';

export interface Settings {
  schemaVersion: number;
  enabled: boolean;
  speed: Speed;
  mute: boolean;
  platforms: Record<PlatformId, boolean>;
  promoActions: Record<PromoKind, PromoAction>;
  debug: boolean;
}

export interface SettingsPatch {
  enabled?: boolean;
  speed?: Speed;
  mute?: boolean;
  platforms?: Partial<Record<PlatformId, boolean>>;
  promoActions?: Partial<Record<PromoKind, PromoAction>>;
  debug?: boolean;
}

export function defaultSettings(): Settings {
  return {
    schemaVersion: SCHEMA_VERSION,
    enabled: true,
    speed: 16,
    mute: true,
    // Netflix ships disabled and experimental (Overview, §2.4).
    platforms: { youtube: true, netflix: false },
    promoActions: { intro: 'ignore', recap: 'ignore', promo: 'ignore' },
    debug: false,
  };
}

type RawSettings = Record<string, unknown>;
type Migration = (raw: RawSettings) => RawSettings;

/**
 * Keyed by the version being migrated *from*. Each step returns data at version key + 1;
 * `sanitize()` then fills defaults and drops invalid values, so steps only move or rename.
 */
const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // v0 is anything stored before schemaVersion existed (e.g. a partial object). Field names
  // are unchanged in v1, so the step only stamps the version; sanitize() does the rest.
  0: (raw) => ({ ...raw, schemaVersion: 1 }),
};

function isRecord(value: unknown): value is RawSettings {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string | number>(options: readonly T[], value: unknown): value is T {
  return (options as readonly unknown[]).includes(value);
}

function readVersion(raw: RawSettings): number {
  const v = raw.schemaVersion;
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0;
}

function sanitize(raw: RawSettings): Settings {
  const d = defaultSettings();
  const bool = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback;
  const platforms = isRecord(raw.platforms) ? raw.platforms : {};
  const promoActions = isRecord(raw.promoActions) ? raw.promoActions : {};
  const promo = (kind: PromoKind): PromoAction => {
    const value = promoActions[kind];
    return isOneOf(PROMO_ACTIONS, value) ? value : d.promoActions[kind];
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    enabled: bool(raw.enabled, d.enabled),
    speed: isOneOf(SPEED_OPTIONS, raw.speed) ? raw.speed : d.speed,
    mute: bool(raw.mute, d.mute),
    platforms: {
      youtube: bool(platforms.youtube, d.platforms.youtube),
      netflix: bool(platforms.netflix, d.platforms.netflix),
    },
    promoActions: { intro: promo('intro'), recap: promo('recap'), promo: promo('promo') },
    debug: bool(raw.debug, d.debug),
  };
}

/**
 * Brings any stored value up to the current schema. Never throws: unknown or corrupt input
 * yields defaults, and data from a newer schema (after a downgrade) keeps every field this
 * version understands.
 */
export function migrate(stored: unknown): Settings {
  if (!isRecord(stored)) return defaultSettings();
  let raw = stored;
  for (let v = readVersion(raw); v < SCHEMA_VERSION; v = readVersion(raw)) {
    const step = MIGRATIONS[v];
    if (!step) return sanitize(raw);
    raw = step(raw);
  }
  return sanitize(raw);
}

/** True when the stored value was written by a newer schema than this build understands. */
export function isFromNewerSchema(stored: unknown): boolean {
  return isRecord(stored) && readVersion(stored) > SCHEMA_VERSION;
}

export function applyPatch(current: Settings, patch: SettingsPatch): Settings {
  return sanitize({
    ...current,
    ...patch,
    platforms: { ...current.platforms, ...patch.platforms },
    promoActions: { ...current.promoActions, ...patch.promoActions },
  });
}

async function readStored(): Promise<unknown> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY];
}

export async function getSettings(): Promise<Settings> {
  return migrate(await readStored());
}

export async function setSettings(patch: SettingsPatch): Promise<Settings> {
  const next = applyPatch(await getSettings(), patch);
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export async function resetSettings(): Promise<Settings> {
  const next = defaultSettings();
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

/**
 * Re-writes stored settings in the current schema (run on extension update). Data from a
 * newer schema is left untouched so a later upgrade doesn't lose it.
 */
export async function migrateStoredSettings(): Promise<Settings> {
  const stored = await readStored();
  const settings = migrate(stored);
  if (!isFromNewerSchema(stored)) await browser.storage.local.set({ [STORAGE_KEY]: settings });
  return settings;
}

export type SettingsListener = (next: Settings, prev: Settings | null) => void;

export function subscribeSettings(
  listener: SettingsListener,
  options: { signal?: AbortSignal } = {},
): () => void {
  const { signal } = options;
  if (signal?.aborted) return () => undefined;
  const onChanged = (changes: Record<string, Browser.storage.StorageChange>, area: string) => {
    const change = changes[STORAGE_KEY];
    if (area !== 'local' || !change) return;
    // Browsers omit oldValue for a first write; some implementations send null instead.
    const prev = change.oldValue === undefined || change.oldValue === null ? null : change.oldValue;
    listener(migrate(change.newValue), prev === null ? null : migrate(prev));
  };
  browser.storage.onChanged.addListener(onChanged);
  const unsubscribe = () => {
    browser.storage.onChanged.removeListener(onChanged);
  };
  signal?.addEventListener('abort', unsubscribe, { once: true });
  return unsubscribe;
}
