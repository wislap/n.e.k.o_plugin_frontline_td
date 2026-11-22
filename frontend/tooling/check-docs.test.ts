import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkDesignSection,
  checkFeatureReadmeSize,
  checkDocs,
  checkFeatureReadme,
  FEATURE_README_HEADINGS,
} from './check-docs.ts';

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

  it('flags a feature directory without a README', () => {
    mkdirSync(path.join(root, 'frontend', 'src', 'features', 'demo'), { recursive: true });
    expect(checkDocs(root).join('\n')).toMatch('features/demo: missing README.md');
  });

  it('flags a feature README with wrong or missing sections', () => {
    mkdirSync(path.join(root, 'frontend', 'src', 'features', 'demo'), { recursive: true });
    writeFileSync(
      path.join(root, 'frontend', 'src', 'features', 'demo', 'README.md'),
      '# demo\n\n## 职责\n\nx\n\n## 规则\n',
    );
    const errors = checkDocs(root).join('\n');
    expect(errors).toMatch('features/demo/README.md');
    expect(errors).toMatch('## 公开接口');
  });
});

describe('checkFeatureReadme', () => {
  it('accepts the exact five sections in order', () => {
    const text = `# f\n\n${FEATURE_README_HEADINGS.join('\n\nx\n\n')}\n`;
    expect(checkFeatureReadme(text)).toBeNull();
  });

  it('rejects an extra section and an out-of-order section', () => {
    expect(checkFeatureReadme('# f\n\n## 职责\n\n## 公开接口\n')).toMatch('expected 5');
    const wrongOrder = `# f\n\n## 职责\n\n## 拥有的组件\n\n## 公开接口\n\n## 不变量\n\n## 对应设计\n`;
    expect(checkFeatureReadme(wrongOrder)).toMatch('## 公开接口');
  });
});

describe('checkDesignSection', () => {
  it('accepts Markdown links to ADRs and design docs', () => {
    const text = `## 对应设计
- [ADR 0038](../../../../docs/adr/0038-outposts-ruins-capture-exclusion.md)
- [architecture.md §6.8](../../../../docs/design/architecture.md)
`;
    expect(checkDesignSection(text)).toBeNull();
  });

  it('flags a bare ADR reference', () => {
    const text = `## 对应设计
- 见 ADR 0038 与 ADR 0029。
`;
    expect(checkDesignSection(text)).toMatch('ADR');
  });

  it('flags bare docs/ paths and design doc names', () => {
    expect(checkDesignSection('## 对应设计\n- docs/design/architecture.md §6\n')).toMatch('docs/');
    expect(checkDesignSection('## 对应设计\n- architecture.md §6.8\n')).toMatch('architecture.md');
  });

  it('ignores bare references outside 对应设计', () => {
    const text = `## 不变量
- ADR 0038 在正文里提及不检查。
`;
    expect(checkDesignSection(text)).toBeNull();
  });
});

describe('checkFeatureReadmeSize', () => {
  it('accepts a short README', () => {
    const text = ['# x', '', 'short lines', ''].join('\n');
    expect(checkFeatureReadmeSize(text)).toBeNull();
  });

  it('flags a README over 80 lines', () => {
    const text = ['# x', ...Array.from({ length: 80 }, () => 'y'), ''].join('\n');
    expect(checkFeatureReadmeSize(text)).toMatch('lines');
  });

  it('flags a single line over 200 characters', () => {
    const text = ['# x', 'z'.repeat(201), ''].join('\n');
    expect(checkFeatureReadmeSize(text)).toMatch('line 2');
  });

  it('counts characters, not bytes, for CJK text', () => {
    const text = '汉'.repeat(199) + '\n';
    expect(checkFeatureReadmeSize(text)).toBeNull();
  });
});
