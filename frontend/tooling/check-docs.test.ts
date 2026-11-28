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
  checkFeatureReadmeRefs,
  FEATURE_README_HEADINGS,
  headingSlugs,
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

  it('flags a markdown file outside the whitelist (including docs/guides)', () => {
    stage('NOTES.md', '# notes\n');
    stage('docs/guides/guide.md', '# guide\n');
    const errors = checkDocs(root).join('\n');
    expect(errors).toMatch('NOTES.md: markdown file outside the whitelist');
    expect(errors).toMatch('docs/guides/guide.md: markdown file outside the whitelist');
  });

  it('flags a broken relative link', () => {
    stage('docs/design/x.md', '[missing](./nope.md)\n');
    expect(checkDocs(root).join('\n')).toMatch('broken link');
  });

  it('accepts existing links, anchors, directory links and external links', () => {
    stage(
      'docs/design/x.md',
      '## s\n\n[ok](./y.md) [anchor](#s) [dir](../../docs/adr/) [web](https://a.b/c) [mail](mailto:a@b.c)\n',
    );
    stage('docs/design/y.md', '# y\n');
    stage('docs/adr/0001-a.md', '# 0001\n');
    expect(checkDocs(root)).toEqual([]);
  });

  it('validates same-file and cross-file heading anchors and rejects directory fragments', () => {
    stage(
      'docs/design/x.md',
      [
        '## s',
        '## s',
        '[ok1](#s) [ok2](#s-1) [bad-self](#missing)',
        '[cross-ok](./y.md#1-visualsilhouette--visualglyph-内容字段)',
        '[cross-bad](./y.md#nope)',
        '[dir-frag](../../docs/adr/#s)',
      ].join('\n'),
    );
    stage('docs/design/y.md', '### 1. `visual.silhouette` / `visual.glyph` 内容字段\n');
    stage('docs/adr/0001-a.md', '# 0001\n');
    const errors = checkDocs(root).join('\n');
    expect(errors).toMatch('#missing');
    expect(errors).toMatch('./y.md#nope');
    expect(errors).toMatch('../../docs/adr/#s');
    expect(errors).not.toMatch('#s-1');
    expect(errors).not.toMatch('#1-visualsilhouette');
  });

  it('rejects links that escape the repository root even if target exists', () => {
    const outside = path.join(path.dirname(root), 'outside-secret.md');
    writeFileSync(outside, '# outside\n');
    try {
      stage('docs/design/x.md', '[escape](../../../outside-secret.md)\n');
      expect(checkDocs(root).join('\n')).toMatch('broken link');
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it('ignores links and headings inside fenced code blocks and inline code', () => {
    stage(
      'docs/design/x.md',
      [
        '## real',
        '',
        'Inline `[not-a-link](./missing.md)` and `[real](#real)`.',
        '',
        '```md',
        '# fake heading',
        '[also-not-a-link](./missing2.md)',
        '```',
        '',
        '[to-fake](#fake-heading)',
      ].join('\n'),
    );
    const errors = checkDocs(root).join('\n');
    expect(errors).not.toMatch('missing.md');
    expect(errors).not.toMatch('missing2.md');
    expect(errors).toMatch('#fake-heading');
  });

  it('flags AGENTS.md over 150 lines without counting trailing CRLF', () => {
    writeFileSync(
      path.join(root, 'AGENTS.md'),
      `${Array.from({ length: 150 }, () => 'x').join('\r\n')}\r\n`,
    );
    execFileSync('git', ['add', 'AGENTS.md'], { cwd: root });
    expect(checkDocs(root)).toEqual([]);

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

  it('catches unlinked ADRs bundled into another link text or chained after a link', () => {
    expect(
      checkDesignSection('## 对应设计\n- [ADR 0038 & ADR 0099](../../../../docs/adr/0038-x.md)\n'),
    ).toMatch('0099');
    expect(
      checkDesignSection('## 对应设计\n- [ADR 0038](../../../../docs/adr/0038-x.md)、0039\n'),
    ).toMatch('0039');
    expect(
      checkDesignSection('## 对应设计\n- [ADR 0038](../../../../docs/adr/0038-x.md)/0039\n'),
    ).toMatch('0039');
    expect(
      checkDesignSection(
        '## 对应设计\n- [ADR 0038](../../../../docs/adr/0038-x.md)、[0039](../../../../docs/adr/0039-y.md)\n',
      ),
    ).toBeNull();
  });
});

describe('checkFeatureReadmeRefs', () => {
  const valid = `# demo
## 职责
x
## 公开接口
- 全表见 [exports.md](../../../../docs/generated/exports.md)。
## 拥有的组件
- C（ADR 0047）。
## 不变量
- I（ADR 0040）。
## 对应设计
- [ADR 0040](../../../../docs/adr/0040-x.md)、[ADR 0047](../../../../docs/adr/0047-y.md)
`;

  it('passes when all mentioned ADRs are linked in 对应设计 and exports.md is linked in 公开接口', () => {
    expect(checkFeatureReadmeRefs(valid)).toBeNull();
  });

  it('requires exports.md link in 公开接口', () => {
    const missing = valid.replace(
      '[exports.md](../../../../docs/generated/exports.md)',
      '`exports.md`',
    );
    expect(checkFeatureReadmeRefs(missing)).toMatch('exports.md');
  });

  it('flags ADR mentions missing from 对应设计 links and ignores code blocks', () => {
    const missingAdr = valid.replace('、[ADR 0047](../../../../docs/adr/0047-y.md)', '');
    expect(checkFeatureReadmeRefs(missingAdr)).toMatch('ADR 0047');

    const withCode = `${valid}\n\`\`\`md\nADR 9999\n\`\`\`\n\`ADR 9998\`\n`;
    expect(checkFeatureReadmeRefs(withCode)).toBeNull();
  });
});

describe('headingSlugs', () => {
  it('matches GitHub slugs for CJK, punctuation, inline code, and duplicates', () => {
    const slugs = headingSlugs(
      [
        '### 1. `visual.silhouette` / `visual.glyph` 内容字段与程序化网格 / 离线屋顶图标',
        '### 4.5 物流与补给（整个游戏的主轴）',
        '## Repeat',
        '## Repeat',
      ].join('\n'),
    );
    expect(slugs.has('1-visualsilhouette--visualglyph-内容字段与程序化网格--离线屋顶图标')).toBe(
      true,
    );
    expect(slugs.has('45-物流与补给整个游戏的主轴')).toBe(true);
    expect(slugs.has('repeat')).toBe(true);
    expect(slugs.has('repeat-1')).toBe(true);
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

  it('counts characters, not bytes, for CJK text and normalizes trailing CRLF', () => {
    const text = '汉'.repeat(199) + '\n';
    expect(checkFeatureReadmeSize(text)).toBeNull();
    const exact80 = `${Array.from({ length: 80 }, () => 'y').join('\r\n')}\r\n`;
    expect(checkFeatureReadmeSize(exact80)).toBeNull();
  });
});
