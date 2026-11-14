/**
 * Shared ESLint config blocks, imported by eslint.config.ts and exercised
 * directly by tooling/eslint-rules.test.ts.
 */
import type { Linter } from 'eslint';
import i18next from 'eslint-plugin-i18next';

export const PURITY_ZONES = [
  'src/core/**/*.{ts,tsx}',
  'src/kernel/**/*.{ts,tsx}',
  'src/content/**/*.{ts,tsx}',
  'src/protocol/**/*.{ts,tsx}',
  'src/features/*/sim/**/*.{ts,tsx}',
  'src/features/*/rules/**/*.{ts,tsx}',
  'src/features/*/content.ts',
  'src/features/*/protocol.ts',
];

const DETERMINISTIC_MATH_MESSAGE =
  'Non-deterministic math is forbidden in the simulation layer; use core deterministic math / seeded RNG (ADR 0006).';
const FORBIDDEN_GLOBAL_MESSAGE =
  'This global is forbidden in the simulation layer; use core deterministic math / seeded RNG (ADR 0006).';

const FORBIDDEN_MATH = [
  'random',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'exp',
  'expm1',
  'log',
  'log1p',
  'log2',
  'log10',
  'pow',
  'cbrt',
  'hypot',
];

const FORBIDDEN_GLOBALS = [
  'Date',
  'performance',
  'window',
  'document',
  'navigator',
  'self',
  'globalThis',
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
  'fetch',
  'localStorage',
  'sessionStorage',
  'crypto',
];

export const purityZoneBlock: Linter.Config = {
  files: PURITY_ZONES,
  rules: {
    'no-restricted-properties': [
      'error',
      ...FORBIDDEN_MATH.map((property) => ({
        object: 'Math',
        property,
        message: DETERMINISTIC_MATH_MESSAGE,
      })),
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector: 'BinaryExpression[operator="**"]',
        message: DETERMINISTIC_MATH_MESSAGE,
      },
      {
        selector: 'AssignmentExpression[operator="**="]',
        message: DETERMINISTIC_MATH_MESSAGE,
      },
    ],
    'no-restricted-globals': [
      'error',
      ...FORBIDDEN_GLOBALS.map((name) => ({ name, message: FORBIDDEN_GLOBAL_MESSAGE })),
    ],
  },
};

export const i18nextJsxBlock: Linter.Config = {
  files: ['src/**/*.tsx'],
  ignores: ['src/**/*.test.tsx'],
  plugins: { i18next },
  rules: {
    'i18next/no-literal-string': ['error', { mode: 'jsx-only' }],
  },
};
