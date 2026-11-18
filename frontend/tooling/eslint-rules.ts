/**
 * Shared ESLint config blocks, imported by eslint.config.ts and exercised
 * directly by tooling/eslint-rules.test.ts.
 */
import type { Linter } from 'eslint';
import i18next from 'eslint-plugin-i18next';

const PURITY_ZONES = [
  'src/core/**/*.{ts,tsx}',
  'src/kernel/**/*.{ts,tsx}',
  'src/content/**/*.{ts,tsx}',
  'src/protocol/**/*.{ts,tsx}',
  'src/features/*/sim/**/*.{ts,tsx}',
  'src/features/*/rules/**/*.{ts,tsx}',
  'src/modes/*/**/*.{ts,tsx}',
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
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'importScripts',
  'localStorage',
  'sessionStorage',
  'crypto',
];

const ID_LITERAL_MESSAGE =
  'Branch on components or named behaviours, never on content or mode ids (ADR 0014/0019).';
const DOWNLOAD_BAN_MESSAGE = 'Runtime code download/execution is forbidden (ADR 0023).';

// Namespaced-id literals ('pack:name') may be defined and compared via
// helpers, but never branched on directly (ADR 0014/0019).
const ID_LITERAL_SYNTAX = [
  {
    selector:
      'BinaryExpression[operator=/^(===|!==|==|!=)$/] > Literal[value=/^[a-z][a-z0-9_.]*:[a-z][a-z0-9_.]*$/]',
    message: ID_LITERAL_MESSAGE,
  },
  {
    selector: 'SwitchCase > Literal[value=/^[a-z][a-z0-9_.]*:[a-z][a-z0-9_.]*$/]',
    message: ID_LITERAL_MESSAGE,
  },
];

// Runtime code download ban (ADR 0023): shared by the purity block and the
// non-purity src block so both carry the full selector list.
const DOWNLOAD_BAN_SYNTAX = [
  {
    selector: 'ImportExpression[source.type!="Literal"]',
    message: DOWNLOAD_BAN_MESSAGE,
  },
  {
    selector: 'ImportExpression > Literal[value=/^(https?:)?\\/\\//]',
    message: DOWNLOAD_BAN_MESSAGE,
  },
];

// Mode UI is client-side: excluded from the purity zone but still under
// the download/network bans (the bans re-include it via a negated ignore).
const MODE_UI = 'src/modes/*/ui/**/*.{ts,tsx}';

export const purityZoneBlock: Linter.Config = {
  files: PURITY_ZONES,
  ignores: [MODE_UI],
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
      ...ID_LITERAL_SYNTAX,
      ...DOWNLOAD_BAN_SYNTAX,
    ],
    'no-restricted-globals': [
      'error',
      ...FORBIDDEN_GLOBALS.map((name) => ({ name, message: FORBIDDEN_GLOBAL_MESSAGE })),
    ],
    'no-eval': 'error',
    'no-new-func': 'error',
    'no-implied-eval': 'error',
  },
};

// Non-purity src gets the same download ban; purity zones already carry it.
export const downloadBanBlock: Linter.Config = {
  files: ['src/**/*.{ts,tsx}'],
  ignores: [...PURITY_ZONES, `!${MODE_UI}`],
  rules: {
    'no-eval': 'error',
    'no-new-func': 'error',
    'no-implied-eval': 'error',
    'no-restricted-syntax': ['error', ...DOWNLOAD_BAN_SYNTAX],
  },
};

// Only host/ may talk to the network (ADR 0023); purity zones already ban
// these globals entirely.
export const networkGlobalsBlock: Linter.Config = {
  files: ['src/**/*.{ts,tsx}'],
  ignores: [...PURITY_ZONES, `!${MODE_UI}`, 'src/host/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-globals': [
      'error',
      { name: 'fetch', message: 'Network access is allowed only in src/host/ (ADR 0023).' },
      {
        name: 'XMLHttpRequest',
        message: 'Network access is allowed only in src/host/ (ADR 0023).',
      },
      { name: 'WebSocket', message: 'Network access is allowed only in src/host/ (ADR 0023).' },
      { name: 'EventSource', message: 'Network access is allowed only in src/host/ (ADR 0023).' },
      {
        name: 'importScripts',
        message: 'Network access is allowed only in src/host/ (ADR 0023).',
      },
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
