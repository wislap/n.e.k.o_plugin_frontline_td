import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import {
  downloadBanBlock,
  i18nextJsxBlock,
  networkGlobalsBlock,
  purityZoneBlock,
} from './tooling/eslint-rules';

export default defineConfig(
  {
    ignores: ['node_modules/', 'coverage/', 'tooling/fixtures/'],
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.browser,
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-expect-error': 'allow-with-description',
        },
      ],
    },
  },
  i18nextJsxBlock,
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
  },
  purityZoneBlock,
  downloadBanBlock,
  networkGlobalsBlock,
  {
    files: ['tooling/**', 'eval/**', 'e2e/**', '*.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
);
