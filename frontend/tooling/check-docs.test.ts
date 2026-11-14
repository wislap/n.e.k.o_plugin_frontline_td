import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkDocs } from './check-docs.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'check-docs-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(path.join(root, 'AGENTS.md'), '# agents\n');
  mkdirSync(path.join(root, 'docs', 'design'), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function stage(file: string, content: string) {
  const full = path.join(root, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
  execFileSync('git', ['add', file], { cwd: root });
}

describe('checkDocs', () => {
  it('passes a minimal whitelisted repo', () => {
    expect(checkDocs(root)).toEqual([]);
  });

  it('flags a markdown file outside the whitelist', () => {
    stage('NOTES.md', '# notes\n');
    expect(checkDocs(root).join('\n')).toMatch('outside the whitelist');
  });

  it('flags a broken relative link', () => {
    stage('docs/design/x.md', '[missing](./nope.md)\n');
    expect(checkDocs(root).join('\n')).toMatch('broken link');
  });

  it('accepts existing links, anchors and external links', () => {
    stage(
      'docs/design/x.md',
      '[ok](./y.md) [anchor](#s) [web](https://a.b/c) [mail](mailto:a@b.c)\n',
    );
    stage('docs/design/y.md', '# y\n');
    expect(checkDocs(root)).toEqual([]);
  });

  it('flags AGENTS.md over 150 lines', () => {
    writeFileSync(path.join(root, 'AGENTS.md'), 'x\n'.repeat(151));
    execFileSync('git', ['add', 'AGENTS.md'], { cwd: root });
    expect(checkDocs(root).join('\n')).toMatch('150');
  });
});
