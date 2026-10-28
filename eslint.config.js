import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Import-path regexes for the layering rules in CLAUDE.md / §1. */
const layer = (regex, message) => ({ regex, message });
const CORE = layer('(^|/)core(/|$)', 'Only entrypoints may import core/.');
const PLATFORMS = layer('(^|/)platforms(/|$)', 'Only entrypoints and core may import platforms/.');
const SPECIFIC_PLATFORM = layer(
  '(^|/)platforms/(registry$|[^/]+/)',
  'core/ must not depend on a specific platform; use the PlatformAdapter contract.',
);
const UPWARD = layer(
  '(^|/)(entrypoints|bootstrap|ui)(/|$)',
  'Lower layers must not import upward.',
);

const restrictImports = (...patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
});

export default defineConfig(
  {
    ignores: [
      '.output/',
      '.wxt/',
      'node_modules/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      'safari/',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Layering (§1): entrypoints → core / platforms → shared.
  { files: ['src/shared/**'], rules: restrictImports(CORE, PLATFORMS, UPWARD) },
  { files: ['src/platforms/**'], rules: restrictImports(CORE, UPWARD) },
  { files: ['src/core/**'], rules: restrictImports(SPECIFIC_PLATFORM, UPWARD) },
  { files: ['src/ui/**'], rules: restrictImports(CORE, PLATFORMS, UPWARD) },
  {
    // Popup/options talk to content scripts only through shared/messaging.ts.
    files: ['src/entrypoints/popup/**', 'src/entrypoints/options/**'],
    rules: restrictImports(CORE, PLATFORMS),
  },

  // Only VideoEngine.ts writes playbackRate or muted (CLAUDE.md, §3.2).
  {
    files: ['src/**/*.ts'],
    ignores: ['src/core/VideoEngine.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'AssignmentExpression > MemberExpression.left[property.name=/^(playbackRate|muted)$/]',
          message: 'Only src/core/VideoEngine.ts may write playbackRate or muted.',
        },
        {
          selector:
            'AssignmentExpression > MemberExpression.left[property.value=/^(playbackRate|muted)$/]',
          message: 'Only src/core/VideoEngine.ts may write playbackRate or muted.',
        },
      ],
    },
  },

  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
);
