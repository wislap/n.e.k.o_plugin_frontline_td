import path from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { beforeAll, describe, expect, it } from 'vitest';
import { i18nextJsxBlock, purityZoneBlock } from './eslint-rules.ts';

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
      },
      purityZoneBlock,
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
});

describe('i18next literal strings', () => {
  it('flags a JSX literal in a .tsx file', async () => {
    const code = 'const c = () => <p>Hello world</p>;\nexport default c;\n';
    const ruleIds = await ruleIdsFor('src/x.tsx', code);
    expect(ruleIds).toContain('i18next/no-literal-string');
  });
});
