import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { ADAPTERS } from '../../src/platforms/registry';
test('generated manifest includes every registered adapter and only allowed permissions', () => {
  const manifest = JSON.parse(readFileSync('.output/chrome-mv3/manifest.json', 'utf8')) as {
    permissions: string[];
    host_permissions: string[];
    content_scripts: { matches: string[] }[];
  };
  expect(manifest.permissions).toEqual(['storage']);
  expect(manifest.host_permissions.sort()).toEqual(ADAPTERS.flatMap((a) => [...a.matches]).sort());
  for (const adapter of ADAPTERS)
    for (const match of adapter.matches) {
      expect(manifest.content_scripts.some((script) => script.matches.includes(match))).toBe(true);
    }
});
