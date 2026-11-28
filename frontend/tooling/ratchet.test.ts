import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { longFileWarnings, measure, run } from './ratchet.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ratchet-'));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  mkdirSync(path.join(root, 'tooling'), { recursive: true });
  writeBaseline({ asAny: 0, tsIgnore: 0, tsExpectError: 0, eslintDisable: 0, longFiles: 0 });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeBaseline(metrics: Record<string, number>) {
  writeFileSync(path.join(root, 'ratchet.json'), JSON.stringify(metrics));
}

const AS_ANY = 'as' + ' any';
const TS_IGNORE = '@ts-' + 'ignore';
const ESLINT_DISABLE_LINE = 'eslint-' + 'disable-line';

describe('measure', () => {
  it('counts each metric and skips fixtures', () => {
    writeFileSync(
      path.join(root, 'src', 'a.ts'),
      `const x = 1 ${AS_ANY};\n// ${ESLINT_DISABLE_LINE}\n`,
    );
    mkdirSync(path.join(root, 'tooling', 'fixtures'), { recursive: true });
    writeFileSync(path.join(root, 'tooling', 'fixtures', 'f.ts'), `${AS_ANY} ${TS_IGNORE}\n`);
    const metrics = measure(root);
    expect(metrics.asAny).toBe(1);
    expect(metrics.eslintDisable).toBe(1);
    expect(metrics.tsIgnore).toBe(0);
  });

  const lines = (n: number): string => new Array(n).fill('// x').join('\n');

  it('counts only files over the 800-line red line', () => {
    writeFileSync(path.join(root, 'src', 'red.ts'), lines(801));
    writeFileSync(path.join(root, 'src', 'yellow.ts'), lines(700));
    const metrics = measure(root);
    expect(metrics.longFiles).toBe(1);
  });

  it('does not let trailing newline or CRLF inflate line counts', () => {
    const exact800Crlf = `${new Array(800).fill('// x').join('\r\n')}\r\n`;
    writeFileSync(path.join(root, 'src', 'exact800.ts'), exact800Crlf);
    const metrics = measure(root);
    expect(metrics.longFiles).toBe(0);
    expect(longFileWarnings(root)).toEqual([`${path.join('src', 'exact800.ts')}: 800 lines`]);
  });

  it('exempts tests, test-world, and kernel testing scaffolding', () => {
    writeFileSync(path.join(root, 'src', 'a.test.ts'), lines(900));
    writeFileSync(path.join(root, 'src', 'test-world.ts'), lines(900));
    mkdirSync(path.join(root, 'src', 'kernel', 'testing'), { recursive: true });
    writeFileSync(path.join(root, 'src', 'kernel', 'testing', 'harness.ts'), lines(900));
    const metrics = measure(root);
    expect(metrics.longFiles).toBe(0);
    expect(longFileWarnings(root)).toEqual([]);
  });
});

describe('longFileWarnings', () => {
  const lines = (n: number): string => new Array(n).fill('// x').join('\n');

  it('lists files in the yellow band without failing the run', () => {
    writeFileSync(path.join(root, 'src', 'yellow.ts'), lines(700));
    expect(longFileWarnings(root)).toEqual([`${path.join('src', 'yellow.ts')}: 700 lines`]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(run([], root)).toBe(0);
    expect(warn.mock.calls.flat().join('\n')).toMatch('yellow.ts');
    warn.mockRestore();
  });

  it('ignores exempt files and red-line files in warnings', () => {
    writeFileSync(path.join(root, 'src', 'a.test.ts'), lines(700));
    writeFileSync(path.join(root, 'src', 'red.ts'), lines(900));
    expect(longFileWarnings(root)).toEqual([]);
  });
});

describe('run', () => {
  it('fails when a metric regresses', () => {
    writeFileSync(path.join(root, 'src', 'a.ts'), `const x = 1 ${AS_ANY};\n`);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(run([], root)).toBe(1);
    expect(err.mock.calls.flat().join('\n')).toMatch('asAny');
    err.mockRestore();
  });

  it('fails when a metric improved but baseline was not updated', () => {
    writeBaseline({ asAny: 1, tsIgnore: 0, tsExpectError: 0, eslintDisable: 0, longFiles: 0 });
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(run([], root)).toBe(1);
    expect(err.mock.calls.flat().join('\n')).toMatch('ratchet:update');
    err.mockRestore();
  });

  it('update refuses to raise a baseline without --allow-increase', () => {
    writeFileSync(path.join(root, 'src', 'a.ts'), `const x = 1 ${AS_ANY};\n`);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(run(['--update'], root)).toBe(1);
    expect(run(['--update', '--allow-increase'], root)).toBe(0);
    const written = JSON.parse(readFileSync(path.join(root, 'ratchet.json'), 'utf8')) as {
      asAny: number;
    };
    expect(written.asAny).toBe(1);
  });
});
